'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  WATCH_RECORDING_DOC,
  WATCH_STREAM_DOC,
  isStreamState,
  parseDuration,
  parseStreamSource,
} from '@kgc/shared';
import { appendAudit, diff } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { getSession } from '@/lib/data';
import { videoLibraryTicketNames } from '@/lib/streaming';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';

/**
 * Attaching a stream and a recording to one session.
 *
 * ── Why two documents and not two field groups ──────────────────────────────
 *
 * `firestore.rules` filters documents, not fields. A stream sold with one
 * ticket tier and stored on the session document is a stream every attendee can
 * read, because every attendee may read a published session. So the link lives
 * in `sessions/{id}/watch/{stream|recording}`, which the rules gate on its own,
 * and the session keeps only the three facts that are not secret: that a stream
 * exists and how it is running, that a recording exists, and whether either one
 * names ticket types. That is what an agenda row needs to draw a "Live now"
 * pill without a second read, and it is not enough to watch anything.
 *
 * Stream and recording are separate documents because a session may have
 * either, both or neither, and taking a stream down after the talk must not
 * take the recording with it.
 *
 * ── The parsing is not done here ────────────────────────────────────────────
 *
 * `parseStreamSource()` lives in `@kgc/shared` because the app and the website
 * both need the same answer about the same string, and a second parser is a
 * second set of link shapes that happen to work. What is stored is its
 * normalised output; what the organizer typed is kept beside it as `source`,
 * unread, so a bad parse can be diagnosed from the document.
 *
 * ── Clearing has to be explicit ─────────────────────────────────────────────
 *
 * `allowedTicketTypes` is always written as an array, and the session flags are
 * always either written or `FieldValue.delete()`d. Under `merge` an `undefined`
 * writes no key at all (AGENTS.md gotcha 9), so "I removed the restriction" or
 * "I took the stream down" would report success and change nothing — and the
 * second of those leaves a "Live now" pill on the agenda for ever.
 */

const PATH = ROUTES.sessionManager;
const OVERVIEW = ROUTES.streamingSetup;

export interface WatchState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** "A, B and C". A list in a sentence an organizer reads, not a join. */
function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function ticketTypesFrom(formData: FormData): string[] {
  return formData
    .getAll('allowedTicketTypes')
    .map((v) => String(v).trim())
    .filter(Boolean);
}

/**
 * A `datetime-local` value as an instant, read as UTC.
 *
 * The form says UTC beside both boxes. An availability window is a contractual
 * date rather than a moment in the room, and reading it in whatever zone the
 * dashboard process happens to be set to is how two organizers end up with two
 * different answers about when the library closed.
 */
function instantOf(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(`${raw}:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function watchDoc(sessionId: string, docId: string) {
  return db()
    .collection(COLLECTIONS.sessions)
    .doc(sessionId)
    .collection(SUBCOLLECTIONS.watch)
    .doc(docId);
}

export async function saveStreamAction(
  sessionId: string,
  _prev: WatchState,
  formData: FormData,
): Promise<WatchState> {
  const actor = await requireOrganizer();

  const session = await getSession(sessionId);
  if (!session) return { error: 'That session no longer exists.' };

  const provider = String(formData.get('provider') ?? '').trim();
  const source = String(formData.get('source') ?? '').trim();
  const stateRaw = String(formData.get('state') ?? 'scheduled').trim();
  const allowedTicketTypes = ticketTypesFrom(formData);

  const parsed = parseStreamSource(provider, source);
  if (!parsed.ok) return { error: 'Some fields need attention.', fieldErrors: { source: parsed.error } };
  if (!isStreamState(stateRaw)) return { error: 'Pick whether it is on now, coming up or over.' };

  try {
    const ref = watchDoc(sessionId, WATCH_STREAM_DOC);
    const before = await ref.get();

    await ref.set(
      {
        eventId: EVENT_ID,
        sessionId,
        provider: parsed.value.provider,
        source,
        watchUrl: parsed.value.watchUrl,
        embedUrl: parsed.value.embedUrl,
        videoId: parsed.value.videoId ?? FieldValue.delete(),
        embeddable: parsed.value.embeddable,
        state: stateRaw,
        allowedTicketTypes,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await stampSession(sessionId);

    const old = before.exists ? (before.data() as Record<string, unknown>) : {};
    const changed = diff(
      before.exists
        ? {
            provider: String(old.provider ?? ''),
            watchUrl: String(old.watchUrl ?? ''),
            state: String(old.state ?? ''),
            allowedTicketTypes: ((old.allowedTicketTypes as string[]) ?? []).join(', '),
          }
        : {},
      {
        provider: parsed.value.provider,
        watchUrl: parsed.value.watchUrl,
        state: stateRaw,
        allowedTicketTypes: allowedTicketTypes.join(', '),
      },
    );

    await appendAudit({
      actor,
      action: before.exists ? 'session.stream.update' : 'session.stream.create',
      subject: session.title,
      targetPath: `${COLLECTIONS.sessions}/${sessionId}/${SUBCOLLECTIONS.watch}/${WATCH_STREAM_DOC}`,
      targetId: sessionId,
      before: changed.before,
      after: changed.after,
    });

    revalidatePath(`${PATH}/${sessionId}`);
    revalidatePath(OVERVIEW);

    return {
      ok: true,
      message:
        stateRaw === 'live'
          ? 'Saved. The session shows as live now.'
          : stateRaw === 'scheduled'
            ? 'Saved. The session shows as streaming later.'
            : 'Saved. The stream is marked as finished.',
    };
  } catch (err) {
    recordError('session.stream.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the stream.' };
  }
}

/**
 * Take the stream off a session.
 *
 * Returns nothing because it is a `ConfirmButton`, whose form has no result
 * banner to render into: the proof is the panel coming back empty after the
 * revalidate, which is what an organizer is looking at anyway.
 */
export async function removeStreamAction(sessionId: string): Promise<void> {
  const actor = await requireOrganizer();
  try {
    await watchDoc(sessionId, WATCH_STREAM_DOC).delete();
    await stampSession(sessionId);
    await appendAudit({
      actor,
      action: 'session.stream.delete',
      targetPath: `${COLLECTIONS.sessions}/${sessionId}/${SUBCOLLECTIONS.watch}/${WATCH_STREAM_DOC}`,
      targetId: sessionId,
      before: {},
      after: {},
    });
  } catch (err) {
    recordError('session.stream.remove', err);
  }
  revalidatePath(`${PATH}/${sessionId}`);
  revalidatePath(OVERVIEW);
}

export async function saveRecordingAction(
  sessionId: string,
  _prev: WatchState,
  formData: FormData,
): Promise<WatchState> {
  const actor = await requireOrganizer();

  const session = await getSession(sessionId);
  if (!session) return { error: 'That session no longer exists.' };

  const provider = String(formData.get('provider') ?? '').trim();
  const source = String(formData.get('source') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim() || session.title;
  const durationRaw = String(formData.get('duration') ?? '').trim();
  const fromRaw = String(formData.get('availableFromLocal') ?? '').trim();
  const untilRaw = String(formData.get('availableUntilLocal') ?? '').trim();
  const picked = ticketTypesFrom(formData);

  /**
   * Two tiers were sold a video library, and this is where that promise is
   * kept.
   *
   * `includesVideoLibrary` is the machine-readable half of the bullet that says
   * "Three months of the KGC Video Library" — the same flag the website already
   * turns into an entitlement at fulfilment. Restricting a recording to one
   * tier and leaving out another that was sold the library is a refund
   * conversation, and it is not a mistake anybody would see: the organizer ticks
   * the box they were thinking about and nothing on screen objects.
   *
   * So the tiers that promised it are added back. An empty list already means
   * everybody, so this only ever touches a restriction, and only ever widens it.
   * It applies to recordings and not to streams: a live stream is a seat in the
   * room, and no tier's bullets promise one.
   */
  const promised = picked.length > 0 ? await videoLibraryTicketNames() : [];
  const restored = promised.filter((n) => !picked.includes(n));
  const allowedTicketTypes = [...picked, ...restored];

  const fieldErrors: Record<string, string> = {};

  const parsed = parseStreamSource(provider, source);
  if (!parsed.ok) fieldErrors.source = parsed.error;

  const durationSeconds = durationRaw ? parseDuration(durationRaw) : null;
  if (durationRaw && durationSeconds === null) {
    fieldErrors.duration = 'Type the length as 45, 45:30 or 1:05:30. Leave it blank if you do not know it.';
  }

  const from = instantOf(fromRaw);
  const until = instantOf(untilRaw);
  if (fromRaw && !from) fieldErrors.availableFromLocal = 'That is not a date.';
  if (untilRaw && !until) fieldErrors.availableUntilLocal = 'That is not a date.';
  if (from && until && until.getTime() <= from.getTime()) {
    fieldErrors.availableUntilLocal = 'The closing date has to be after the opening one.';
  }

  if (Object.keys(fieldErrors).length > 0 || !parsed.ok) {
    return { error: 'Some fields need attention.', fieldErrors };
  }

  try {
    const ref = watchDoc(sessionId, WATCH_RECORDING_DOC);
    const before = await ref.get();

    await ref.set(
      {
        eventId: EVENT_ID,
        sessionId,
        provider: parsed.value.provider,
        source,
        watchUrl: parsed.value.watchUrl,
        embedUrl: parsed.value.embedUrl,
        videoId: parsed.value.videoId ?? FieldValue.delete(),
        embeddable: parsed.value.embeddable,
        title,
        durationSeconds: durationSeconds ?? FieldValue.delete(),
        availableFrom: from ?? FieldValue.delete(),
        availableUntil: until ?? FieldValue.delete(),
        allowedTicketTypes,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await stampSession(sessionId);

    const old = before.exists ? (before.data() as Record<string, unknown>) : {};
    const changed = diff(
      before.exists
        ? {
            title: String(old.title ?? ''),
            watchUrl: String(old.watchUrl ?? ''),
            allowedTicketTypes: ((old.allowedTicketTypes as string[]) ?? []).join(', '),
          }
        : {},
      {
        title,
        watchUrl: parsed.value.watchUrl,
        allowedTicketTypes: allowedTicketTypes.join(', '),
      },
    );

    await appendAudit({
      actor,
      action: before.exists ? 'session.recording.update' : 'session.recording.create',
      subject: title,
      targetPath: `${COLLECTIONS.sessions}/${sessionId}/${SUBCOLLECTIONS.watch}/${WATCH_RECORDING_DOC}`,
      targetId: sessionId,
      before: changed.before,
      after: changed.after,
    });

    revalidatePath(`${PATH}/${sessionId}`);
    revalidatePath(OVERVIEW);

    return {
      ok: true,
      message: allowedTicketTypes.length
        ? `Saved. Only ${andList(allowedTicketTypes)} can watch it.` +
          (restored.length
            ? ` ${andList(restored)} ${restored.length === 1 ? 'was' : 'were'} added back, because ${restored.length === 1 ? 'that ticket includes' : 'those tickets include'} the video library.`
            : '')
        : 'Saved. Everybody with a ticket can watch it.',
    };
  } catch (err) {
    recordError('session.recording.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the recording.' };
  }
}

/** Take the recording off a session. See `removeStreamAction` for the shape. */
export async function removeRecordingAction(sessionId: string): Promise<void> {
  const actor = await requireOrganizer();
  try {
    await watchDoc(sessionId, WATCH_RECORDING_DOC).delete();
    await stampSession(sessionId);
    await appendAudit({
      actor,
      action: 'session.recording.delete',
      targetPath: `${COLLECTIONS.sessions}/${sessionId}/${SUBCOLLECTIONS.watch}/${WATCH_RECORDING_DOC}`,
      targetId: sessionId,
      before: {},
      after: {},
    });
  } catch (err) {
    recordError('session.recording.remove', err);
  }
  revalidatePath(`${PATH}/${sessionId}`);
  revalidatePath(OVERVIEW);
}

/**
 * Re-derive the public flags on the session from the two watch documents.
 *
 * Read back rather than inferred from what this call just wrote, because the
 * other document is not this call's to reason about: saving a recording must
 * not clear a "live now" pill, and removing a stream must not clear
 * `watchRestricted` when the recording is still restricted. Every field is
 * either written or deleted — never omitted — for the reason in the header.
 *
 * ── What the ticket names are doing out here ────────────────────────────────
 *
 * `streamTicketTypes`, `recordingTicketTypes` and `recordingUntil` are the
 * parts of the two documents that are not secret, and the app needs exactly
 * them: a reader the rules are about to refuse cannot be told which tickets do
 * cover the video by a document they are not allowed to read, and a list of
 * recordings cannot print an expiry per row without one gated read per row.
 * The links stay where they are. See `SessionDoc` for the longer argument, and
 * note that the two name lists are kept apart rather than unioned — a free
 * stream beside a recording sold with the video library is the ordinary case
 * here, and one list would mark that stream as restricted.
 */
async function stampSession(sessionId: string): Promise<void> {
  const ref = db().collection(COLLECTIONS.sessions).doc(sessionId);
  const [stream, recording] = await Promise.all([
    ref.collection(SUBCOLLECTIONS.watch).doc(WATCH_STREAM_DOC).get(),
    ref.collection(SUBCOLLECTIONS.watch).doc(WATCH_RECORDING_DOC).get(),
  ]);

  const streamState = stream.exists ? (stream.data()?.state as string | undefined) : undefined;
  const streamTickets = ((stream.data()?.allowedTicketTypes as string[] | undefined) ?? []).filter(
    Boolean,
  );
  const recordingTickets = (
    (recording.data()?.allowedTicketTypes as string[] | undefined) ?? []
  ).filter(Boolean);
  const restricted = streamTickets.length > 0 || recordingTickets.length > 0;
  const until = recording.exists ? recording.data()?.availableUntil : undefined;

  await ref.set(
    {
      streamState: streamState ?? FieldValue.delete(),
      hasRecording: recording.exists ? true : FieldValue.delete(),
      watchRestricted: restricted ? true : FieldValue.delete(),
      streamTicketTypes: streamTickets.length > 0 ? streamTickets : FieldValue.delete(),
      recordingTicketTypes:
        recordingTickets.length > 0 ? recordingTickets : FieldValue.delete(),
      recordingUntil: until ?? FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
