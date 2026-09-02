'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, TIME_ZONE, type SessionDoc } from '@kgc/shared';
import { sessionId as deriveSessionId, stableGuid } from '@kgc/scripts/src/lib/ids';
import { requireOrganizer } from '@/lib/auth';
import { appendAudit, diff } from '@/lib/audit';
import { db } from '@/lib/firestore';
import { listRooms, listSpeakerOptions, listTrackOptions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { deriveTimes } from '@/lib/time';
import { readCsvUpload, type ProgrammeImportState } from '@/lib/csv-import';
import { commitSessionImport, previewSessionCsv, type SessionImportOutcome } from './import';
import { recordError } from '@/lib/errors';
import { roomChangePush } from '@/lib/push';
import {
  parseSessionForm,
  primaryTrackFor,
  qaDefaultsFor,
  speakerIndexDelta,
  speakerNamesFor,
  type SessionInput,
} from './session-core';

export interface SessionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  changed?: string[];
  /** Set when the seam would have sent a push, so the demo can point at it. */
  pushNote?: string;
  /** Set by a successful create, so the form can offer the new session's page. */
  createdId?: string;
}

/**
 * Create and edit a session.
 *
 * ── The three things that were already right, and stay right ────────────────
 *
 *  1. **One write to the session document.** The attendee app is listening with
 *     `onSnapshot`; a single commit is a single snapshot, delivered in about a
 *     second. Splitting a save across several writes makes a phone flicker
 *     through half-applied states — a session showing its new speakers beside
 *     its old room — and every denormalised cache below is therefore written in
 *     the *same* update as the field it mirrors, never in a follow-up.
 *
 *  2. **The derived time fields are recomputed server-side**, never taken from
 *     the form. `startsAtLocal` is the authoring truth; `startsAt`, `endsAt` and
 *     `day` follow from it through the single `deriveTimes()` in
 *     `scripts/src/lib/time.ts` that the seed and the Whova importer also call.
 *     Create goes through exactly the same function as edit — the only
 *     difference is where the zone comes from (`TIME_ZONE` for a new session,
 *     the stored `timeZone` for an existing one), because a session authored in
 *     one zone must not silently move when the event default changes. A 21:00
 *     reception is 01:00 UTC the next day, and deriving `day` anywhere else puts
 *     it on the wrong tab on every phone.
 *
 *  3. **The audit entry is written after the commit, and cannot block it.**
 *
 * ── There is no delete, and this does not add one ───────────────────────────
 *
 * `firestore.rules:388` is `allow delete: if false`, and retiring a session is
 * `status: 'cancelled'`. Nor does this write `deletedAt`: seven readers filter
 * on that field and **nothing anywhere sets it**, so introducing an
 * eighth half-implementation of soft delete would leave two ways to hide a
 * session that disagree. All three installs already honour it — `apps/web`
 * (`data.ts:392`), the app (`sessions.ts:66`) and five readers in this
 * dashboard — so the earlier version of this comment, which said the app did
 * not, had the count and the asymmetry both wrong. The argument survives it:
 * one mechanism, and it is `status`.
 *
 * ── What this deliberately still does not write ─────────────────────────────
 *
 * `replyCount`, `reactionCount`, `upvoteCount`, poll `tallies` and `totalVotes`
 * are function-owned. `qaEnabled` / `pollsEnabled` are seeded from the format on
 * create and then belong to `session-qanda-manager`, which is their editor.
 * `tags`, `slidesUrl` and `seriesId` get no control: a grep across `app/`,
 * `apps/web/` and `apps/organizer/` finds **no reader** for any of the three, and
 * a control over a field nobody renders is a control that lies about what it
 * does. `tags` is written as `[]` on create only because the model requires it.
 */

// ---------------------------------------------------------------------------
// Reference resolution — the denormalisation contract, at the point of writing
// ---------------------------------------------------------------------------

interface Resolved {
  room?: { id: string; name: string };
  speakerNames: string[];
  primaryTrack?: { name: string; color?: string };
}

/**
 * Turn the ids the form posted into the caches that go beside them.
 *
 * Read outside the transaction on purpose: Firestore requires every read before
 * any write, and none of these three collections is part of the invariant being
 * protected — the session document is. A track renamed between this read and the
 * commit leaves one stale cache, which is precisely what
 * `fanOutTrackChange`/`reconcileSessionCaches` exist to repair; holding them
 * inside the transaction would make every session save contend with every
 * speaker edit for no gain.
 *
 * An id with no document behind it is refused rather than absorbed. These ids
 * came from dropdowns this very request rendered, so an unknown one means the
 * referenced thing was deleted while the form was open, and writing a blank name
 * into `speakerNames` would shift every later name onto the wrong person.
 */
async function resolveReferences(
  input: SessionInput,
): Promise<{ ok: true; value: Resolved } | { ok: false; error: string }> {
  const [rooms, tracks, speakers] = await Promise.all([
    listRooms(),
    listTrackOptions(),
    listSpeakerOptions(),
  ]);

  const room = input.roomId ? rooms.find((r) => r.id === input.roomId) : undefined;
  if (input.roomId && !room) return { ok: false, error: `No room with id "${input.roomId}".` };

  const { names, unknown: unknownSpeakers } = speakerNamesFor(
    input.speakerIds,
    new Map(speakers.map((s) => [s.id, s.name])),
  );
  if (unknownSpeakers.length) {
    return {
      ok: false,
      error: `No speaker with id ${unknownSpeakers.map((id) => `"${id}"`).join(', ')}. Reload the page — the speaker list changed while this form was open.`,
    };
  }

  const { primary, unknown: unknownTracks } = primaryTrackFor(
    input.trackIds,
    new Map(tracks.map((t) => [t.id, t])),
  );
  if (unknownTracks.length) {
    return {
      ok: false,
      error: `No track with id ${unknownTracks.map((id) => `"${id}"`).join(', ')}. Reload the page — the track list changed while this form was open.`,
    };
  }

  return {
    ok: true,
    value: {
      room: room ? { id: room.id, name: room.name } : undefined,
      speakerNames: names,
      primaryTrack: primary ? { name: primary.name, color: primary.color } : undefined,
    },
  };
}

/**
 * `speakers/{id}.sessionIds` is an inverse index with six readers, one of which
 * is the attendee app's speaker page — it is how somebody sees what a speaker is
 * giving. Nothing maintained it outside the CLI importer, because until now
 * nothing could change `speakerIds` at all; the moment this editor ships, a
 * speaker swapped onto a session would appear on the agenda card and be missing
 * from their own profile.
 *
 * Written in the same transaction as the session, so the two directions of the
 * relationship commit together or not at all. `arrayUnion`/`arrayRemove` because
 * this one genuinely *is* a set — every reader uses `.length` or `.includes`,
 * and the billing order lives on the session, where it is displayed.
 */
function applySpeakerIndex(
  tx: FirebaseFirestore.Transaction,
  sessionDocId: string,
  before: string[],
  after: string[],
): void {
  const { added, removed } = speakerIndexDelta(before, after);
  const speakers = db().collection(COLLECTIONS.speakers);
  for (const id of added) {
    tx.update(speakers.doc(id), { sessionIds: FieldValue.arrayUnion(sessionDocId) });
  }
  for (const id of removed) {
    tx.update(speakers.doc(id), { sessionIds: FieldValue.arrayRemove(sessionDocId) });
  }
}

function revalidateAgenda(sessionDocId?: string): void {
  revalidatePath(ROUTES.sessionManager);
  if (sessionDocId) revalidatePath(`${ROUTES.sessionManager}/${sessionDocId}`);
  revalidatePath(ROUTES.conflictCheck);
  revalidatePath(ROUTES.trackManager);
  revalidatePath(ROUTES.speakerManager);
  revalidatePath(ROUTES.warRoom);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Add a session to the programme.
 *
 * ── The id policy ───────────────────────────────────────────────────────────
 *
 * `sessionId(title, startsAtLocal)` from `@kgc/scripts/src/lib/ids` — a slug of
 * the title plus a short hash of `title|startsAtLocal`. This is the same
 * function the seed and the Whova importer use, and using it here rather than a
 * fresh random id is what lets a later re-import of the same programme *update*
 * this session instead of producing a near-duplicate beside it. The house
 * pattern in `exhibitor-manager/actions.ts` is the same shape: an id derived
 * from the source data, and an explicit collision check with a readable message.
 *
 * The collision check is inside the transaction rather than beside it, which is
 * the one place this tightens the exhibitor pattern. A double-submitted form
 * derives the same id twice, and a `get`-then-`set` outside a transaction lets
 * the second one overwrite the first; `tx.get` + `tx.create` makes the second
 * submit fail on a document the first created. That is the same idempotency
 * mechanism `checkIns` uses — the failure *is* the protection.
 *
 * Note what a collision actually means: same title, same start time. That is
 * either a double submit or two genuinely indistinguishable sessions, and both
 * deserve to be refused rather than silently merged.
 */
export async function createSessionAction(
  _prev: SessionState,
  formData: FormData,
): Promise<SessionState> {
  const actor = await requireOrganizer();

  const parsed = parseSessionForm(formData);
  if (!parsed.ok) return { error: parsed.error, fieldErrors: parsed.fieldErrors };
  const input = parsed.value;

  const refs = await resolveReferences(input);
  if (!refs.ok) return { error: refs.error };
  const { room, speakerNames, primaryTrack } = refs.value;

  try {
    /**
     * A new session is authored in the event's zone. `deriveTimes` throws on
     * anything that is not `YYYY-MM-DDTHH:mm`, and on an end at or before the
     * start — so `startsAt`, `endsAt` and `day` below cannot be anything but its
     * output, and the form has no way to supply them.
     */
    const times = deriveTimes(input.startsAtLocal, input.endsAtLocal, TIME_ZONE);
    const docId = deriveSessionId(input.title, times.startsAtLocal);
    const ref = db().collection(COLLECTIONS.sessions).doc(docId);

    await db().runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        const clash = existing.data() as SessionDoc;
        throw new Error(
          `“${clash.title}” already starts at ${times.startsAtLocal.replace('T', ' ')} and holds the id “${docId}”. ` +
            'If this is a second run of the same session, change the time; if you have just pressed Create twice, it is already saved.',
        );
      }

      /**
       * Typed as the whole document minus the two timestamps the server owns,
       * so `tsc` fails if a *required* field is ever forgotten. That check is
       * worth insisting on here and is impossible on the edit path: an update
       * is a partial patch, and `FieldValue.delete()` is a sentinel rather than
       * a value of any modelled field type, so the patch below has to be
       * `Record<string, unknown>`. A create has no such excuse — every required
       * field has to be present or the session is malformed from birth, and the
       * symptom would be a phone rendering a card with no format pill.
       *
       * `...times` supplies `startsAt`, `endsAt`, `startsAtLocal`, `endsAtLocal`,
       * `day` and `timeZone` together, which is the only way they are ever
       * written — six fields from one derivation, so none of them can disagree.
       */
      const modelled: Omit<SessionDoc, 'createdAt' | 'updatedAt'> = {
        eventId: EVENT_ID,
        title: input.title,
        description: input.description,
        ...times,
        roomId: room?.id,
        roomName: room?.name,
        trackIds: input.trackIds,
        primaryTrackName: primaryTrack?.name,
        primaryTrackColor: primaryTrack?.color,
        format: input.format,
        skillLevel: input.skillLevel,
        speakerIds: input.speakerIds,
        speakerNames,
        // Required by the model and read by nothing. See the header.
        tags: [],
        status: input.status,
        capacity: input.capacity,
        // RFC 5545: a brand new event starts at zero and is bumped by reschedules.
        sequence: 0,
        stableGuid: stableGuid(docId),
        ...qaDefaultsFor(input.format),
      };

      tx.create(ref, {
        ...modelled,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      applySpeakerIndex(tx, docId, [], input.speakerIds);
    });

    await appendAudit({
      actor,
      action: 'session.create',
      targetPath: `${COLLECTIONS.sessions}/${docId}`,
      targetId: docId,
      before: {},
      after: {
        title: input.title,
        day: times.day,
        startsAtLocal: times.startsAtLocal,
        endsAtLocal: times.endsAtLocal,
        roomName: room?.name ?? null,
        format: input.format,
        status: input.status,
        speakerNames,
        primaryTrackName: primaryTrack?.name ?? null,
      },
    });

    revalidateAgenda(docId);

    return {
      ok: true,
      createdId: docId,
      message: `Created “${input.title}” as ${docId}.`,
    };
  } catch (err) {
    recordError('session.create', err);
    return { error: err instanceof Error ? err.message : 'Could not create the session.' };
  }
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

/**
 * Edit an existing session.
 *
 * Every optional field is cleared with `FieldValue.delete()` rather than
 * `undefined`: the store runs with `ignoreUndefinedProperties`, so writing
 * `undefined` silently leaves the old value in place — which on
 * `primaryTrackColor` means a session keeps the colour of a track it is no
 * longer in.
 */
export async function saveSessionAction(
  sessionDocId: string,
  _prev: SessionState,
  formData: FormData,
): Promise<SessionState> {
  const actor = await requireOrganizer();

  const parsed = parseSessionForm(formData);
  if (!parsed.ok) return { error: parsed.error, fieldErrors: parsed.fieldErrors };
  const input = parsed.value;

  const refs = await resolveReferences(input);
  if (!refs.ok) return { error: refs.error };
  const { room, speakerNames, primaryTrack } = refs.value;

  const ref = db().collection(COLLECTIONS.sessions).doc(sessionDocId);

  try {
    const outcome = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('That session no longer exists.');
      const before = snap.data() as SessionDoc;

      // Re-derived here, server-side, in the session's **own** zone — not the
      // event default, so a session authored under a previous default does not
      // move when that default changes.
      const times = deriveTimes(input.startsAtLocal, input.endsAtLocal, before.timeZone);
      const rescheduled =
        times.startsAtLocal !== before.startsAtLocal || times.endsAtLocal !== before.endsAtLocal;

      /**
       * Typed loosely on purpose: `FieldValue.delete()` is a sentinel, not a
       * value of the modelled field type, and it is the only correct way to
       * clear an optional field.
       *
       * Every cache sits immediately below the field it mirrors, because they
       * have to be written together — `speakerNames` positionally beside
       * `speakerIds`, `primaryTrack*` beside `trackIds[0]`, `roomName` beside
       * `roomId`. One `tx.update`, so a phone sees them agree.
       */
      const patch: Record<string, unknown> = {
        title: input.title,
        description: input.description ?? FieldValue.delete(),

        startsAt: times.startsAt,
        endsAt: times.endsAt,
        startsAtLocal: times.startsAtLocal,
        endsAtLocal: times.endsAtLocal,
        day: times.day,

        roomId: room ? room.id : FieldValue.delete(),
        roomName: room ? room.name : FieldValue.delete(),

        trackIds: input.trackIds,
        primaryTrackName: primaryTrack ? primaryTrack.name : FieldValue.delete(),
        primaryTrackColor: primaryTrack?.color ?? FieldValue.delete(),

        speakerIds: input.speakerIds,
        speakerNames,

        format: input.format,
        skillLevel: input.skillLevel ?? FieldValue.delete(),
        capacity: input.capacity ?? FieldValue.delete(),
        status: input.status,

        updatedAt: FieldValue.serverTimestamp(),
      };

      // RFC 5545 SEQUENCE: bumping it on a reschedule is what lets an already
      // exported calendar entry update in place instead of appearing twice.
      if (rescheduled) patch.sequence = (before.sequence ?? 0) + 1;

      tx.update(ref, patch);
      applySpeakerIndex(tx, sessionDocId, before.speakerIds ?? [], input.speakerIds);

      const readable = diff(
        {
          title: before.title,
          description: before.description,
          roomId: before.roomId,
          roomName: before.roomName,
          startsAtLocal: before.startsAtLocal,
          endsAtLocal: before.endsAtLocal,
          day: before.day,
          status: before.status,
          format: before.format,
          skillLevel: before.skillLevel,
          capacity: before.capacity,
          speakerIds: before.speakerIds,
          speakerNames: before.speakerNames,
          trackIds: before.trackIds,
          primaryTrackName: before.primaryTrackName,
          primaryTrackColor: before.primaryTrackColor,
        },
        {
          title: input.title,
          description: input.description,
          roomId: room?.id,
          roomName: room?.name,
          startsAtLocal: times.startsAtLocal,
          endsAtLocal: times.endsAtLocal,
          day: times.day,
          status: input.status,
          format: input.format,
          skillLevel: input.skillLevel,
          capacity: input.capacity,
          speakerIds: input.speakerIds,
          speakerNames,
          trackIds: input.trackIds,
          primaryTrackName: primaryTrack?.name,
          primaryTrackColor: primaryTrack?.color,
        },
      );

      return { readable, roomChanged: (before.roomId ?? '') !== (room?.id ?? ''), title: input.title };
    });

    if (outcome.readable.changed.length === 0) {
      return { ok: true, message: 'No changes to save.', changed: [] };
    }

    await appendAudit({
      actor,
      action: 'session.update',
      targetPath: `${COLLECTIONS.sessions}/${sessionDocId}`,
      targetId: sessionDocId,
      before: outcome.readable.before,
      after: outcome.readable.after,
    });

    let pushNote: string | undefined;
    if (outcome.roomChanged) {
      const result = await roomChangePush({
        sessionId: sessionDocId,
        title: outcome.title,
        roomName: room?.name ?? 'no room',
      });
      pushNote = result.detail;
    }

    revalidateAgenda(sessionDocId);

    return {
      ok: true,
      message: `Saved. Changed: ${outcome.readable.changed.join(', ')}.`,
      changed: outcome.readable.changed,
      pushNote,
    };
  } catch (err) {
    recordError(`session.update ${sessionDocId}`, err);
    return { error: err instanceof Error ? err.message : 'Save failed.' };
  }
}

// ---------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------

/** Preview an agenda CSV. Writes nothing. */
export async function previewSessionImportAction(
  _prev: ProgrammeImportState,
  formData: FormData,
): Promise<ProgrammeImportState> {
  await requireOrganizer();

  const csv = await readCsvUpload(formData);
  if (typeof csv !== 'string') return { stage: 'idle', error: csv.error };

  const preview = previewSessionCsv(csv);
  return {
    stage: 'preview',
    csv,
    header: preview.header,
    sample: preview.valid.slice(0, 3),
    validCount: preview.valid.length,
    totalRows: preview.totalRows,
    errors: preview.errors,
  };
}

/**
 * Commit an agenda import.
 *
 * ⚠️ The revalidation list is longer than the other two importers' because a
 * session is the most connected document in the model: it changes the
 * programme, the conflict report, the track counts, the speaker pages and the
 * war-room figures. It also reaches every phone directly — the app listens with
 * `onSnapshot` — which is why `import.ts` writes each session in one commit and
 * why this refuses a file with problems unless the organizer has explicitly
 * said to import the good rows.
 */
export async function commitSessionImportAction(
  _prev: ProgrammeImportState,
  formData: FormData,
): Promise<ProgrammeImportState> {
  const actor = await requireOrganizer();

  const csv = String(formData.get('csv') ?? '');
  if (!csv) return { stage: 'idle', error: 'The file was lost between steps. Upload it again.' };

  let outcome: SessionImportOutcome;
  try {
    outcome = await commitSessionImport({
      text: csv,
      actor,
      allowPartial: formData.get('allowPartial') === 'on',
    });
  } catch (err) {
    recordError('session.import', err);
    return { stage: 'preview', csv, error: err instanceof Error ? err.message : 'The import failed.' };
  }

  const failed = outcome.failed.map((f) => ({ line: f.line, name: f.title, message: f.message }));

  if (outcome.created === 0 && outcome.updated === 0) {
    return {
      stage: 'preview',
      csv,
      error:
        outcome.errors.length > 0 || failed.length > 0
          ? 'Nothing was imported — the file still has problems. Fix them, or tick “import the good rows anyway”.'
          : 'Nothing was imported.',
      errors: outcome.errors,
      failed,
      totalRows: outcome.totalRows,
    };
  }

  revalidateAgenda();

  return {
    stage: 'done',
    errors: outcome.errors,
    failed,
    totalRows: outcome.totalRows,
    message:
      `Imported ${outcome.created} new ${outcome.created === 1 ? 'session' : 'sessions'}` +
      (outcome.updated ? `, updated ${outcome.updated} already on the programme` : '') +
      '. New sessions are drafts until you publish them.',
  };
}
