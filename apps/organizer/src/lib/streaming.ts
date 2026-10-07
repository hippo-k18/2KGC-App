import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  WATCH_RECORDING_DOC,
  WATCH_STREAM_DOC,
  formatDuration,
  recordingWindow,
  tiersPromisedWatching,
  type RecordingWindow,
  type WatchPromiseTier,
  type SessionDoc,
  type SessionRecordingDoc,
  type SessionStreamDoc,
  type StreamProvider,
  type StreamState,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * Reading what is set up to be watched.
 *
 * The documents live one per session under `sessions/{id}/watch`, at two fixed
 * ids. That shape is what lets `firestore.rules` gate them by ticket type —
 * rules filter documents, not fields — and it is why this file reads them one
 * session at a time rather than with a collection-group query: the rules refuse
 * a `list` for the same reason, so a query here would be a query nothing else
 * in the product is allowed to make, and the two would drift.
 *
 * The overview screen needs every session's state at once, which is 72 reads.
 * That is a dashboard screen an organizer opens a handful of times before the
 * event, not an attendee path, and the alternative is a second denormalised
 * copy to keep in step. The flags on the session document (`streamState`,
 * `hasRecording`) exist for the readers that *are* on a hot path.
 */

export interface StreamRow {
  provider: StreamProvider;
  providerLabel: string;
  source: string;
  watchUrl: string;
  embedUrl: string;
  embeddable: boolean;
  state: StreamState;
  allowedTicketTypes: string[];
}

export interface RecordingRow {
  provider: StreamProvider;
  source: string;
  watchUrl: string;
  embedUrl: string;
  embeddable: boolean;
  title: string;
  /** Formatted for a table cell, or '' when nobody typed one. */
  duration: string;
  durationSeconds: number | null;
  /** `YYYY-MM-DDTHH:mm` in UTC, which is what the two date inputs hold. */
  availableFromLocal: string;
  availableUntilLocal: string;
  window: RecordingWindow;
  allowedTicketTypes: string[];
}

export interface SessionWatch {
  stream: StreamRow | null;
  recording: RecordingRow | null;
}

/** What one row of the overview table needs. */
export interface WatchOverviewRow {
  id: string;
  title: string;
  startsAtLocal: string;
  day: string;
  status: SessionDoc['status'];
  roomName: string;
  stream: StreamRow | null;
  recording: RecordingRow | null;
}

const PROVIDER_LABELS: Record<StreamProvider, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  zoom: 'Zoom',
  embed: 'Embed link',
};

/**
 * A stored instant as the `datetime-local` string the editor round-trips.
 *
 * UTC rather than the event's zone, and said so on the form. An availability
 * window is a contractual date — "the library closes on 31 December" — and
 * rendering it in a zone that depends on where the dashboard is running is how
 * two organizers read the same expiry differently.
 */
function localOfInstant(ts: { toDate(): Date } | undefined): string {
  if (!ts) return '';
  return ts.toDate().toISOString().slice(0, 16);
}

function toStreamRow(d: SessionStreamDoc): StreamRow {
  return {
    provider: d.provider,
    providerLabel: PROVIDER_LABELS[d.provider] ?? d.provider,
    source: d.source ?? '',
    watchUrl: d.watchUrl,
    embedUrl: d.embedUrl,
    embeddable: d.embeddable !== false,
    state: d.state,
    allowedTicketTypes: d.allowedTicketTypes ?? [],
  };
}

function toRecordingRow(d: SessionRecordingDoc, nowMs: number): RecordingRow {
  return {
    provider: d.provider,
    source: d.source ?? '',
    watchUrl: d.watchUrl,
    embedUrl: d.embedUrl,
    embeddable: d.embeddable !== false,
    title: d.title,
    duration: d.durationSeconds ? formatDuration(d.durationSeconds) : '',
    durationSeconds: d.durationSeconds ?? null,
    availableFromLocal: localOfInstant(d.availableFrom),
    availableUntilLocal: localOfInstant(d.availableUntil),
    window: recordingWindow(
      {
        availableFromMs: d.availableFrom ? d.availableFrom.toDate().getTime() : null,
        availableUntilMs: d.availableUntil ? d.availableUntil.toDate().getTime() : null,
      },
      nowMs,
    ),
    allowedTicketTypes: d.allowedTicketTypes ?? [],
  };
}

/** The tiers that cannot be excluded from a stream, and from a recording. */
export interface WatchPromises {
  stream: string[];
  recording: string[];
}

/**
 * The tiers that were sold watching, by name and by kind.
 *
 * This used to be one list read off `includesVideoLibrary`, and it got the one
 * tier that is sold on nothing but watching wrong: `Virtual` is $349, is not in
 * the room, carries that flag as false, and its first two bullets promise live
 * streams and on-demand replays. So the question is asked of what each tier
 * actually sells — `tierPromisesWatching()` in `@kgc/shared`, which reads the
 * bullet list the tickets page renders as well as the flag. Both save actions
 * union these back into any restriction an organizer sets, and both forms name
 * them on screen so it is not a surprise.
 *
 * Names rather than ids, because the restriction is expressed in the names
 * `RegistrationDoc.ticketType` carries and `firestore.rules` compares.
 */
export async function watchPromiseTicketNames(): Promise<WatchPromises> {
  const snap = await db()
    .collection(COLLECTIONS.ticketTypes)
    .where('eventId', '==', EVENT_ID)
    .get();
  const tiers = snap.docs.map((d) => d.data() as WatchPromiseTier);
  return {
    stream: tiersPromisedWatching(tiers, 'stream'),
    recording: tiersPromisedWatching(tiers, 'recording'),
  };
}

/**
 * How many active registrations carry each ticket type name.
 *
 * ⚠️ Registrations, not `TicketTypeDoc.quantitySold`. `quantitySold` counts
 * what this system has sold; the gate compares `RegistrationDoc.ticketType`,
 * and on this event those two numbers differ by an order of magnitude because
 * imported attendees, comped speakers and organizer-added guests hold tickets
 * nobody bought here. A screen that asks "who would get access" and answers
 * with orders tells an organizer a tier is empty when twelve people hold it.
 *
 * Cancelled registrations are left out: they do not get in, and counting them
 * would overstate who a restriction admits.
 *
 * One `where('eventId')` query, which is what every read in this app does, and
 * the grouping happens in memory — no composite index, for the reason the
 * header of `apps/web/src/lib/data.ts` gives at length.
 */
export async function ticketHolderCounts(): Promise<Record<string, number>> {
  const snap = await db()
    .collection(COLLECTIONS.registrations)
    .where('eventId', '==', EVENT_ID)
    .get();
  const out: Record<string, number> = {};
  for (const d of snap.docs) {
    const reg = d.data() as { status?: string; ticketType?: string };
    if (reg.status === 'cancelled') continue;
    const name = (reg.ticketType ?? '').trim();
    if (!name) continue;
    out[name] = (out[name] ?? 0) + 1;
  }
  return out;
}

function watchRef(sessionId: string) {
  return db().collection(COLLECTIONS.sessions).doc(sessionId).collection(SUBCOLLECTIONS.watch);
}

export async function getSessionWatch(sessionId: string): Promise<SessionWatch> {
  const now = Date.now();
  const [stream, recording] = await Promise.all([
    watchRef(sessionId).doc(WATCH_STREAM_DOC).get(),
    watchRef(sessionId).doc(WATCH_RECORDING_DOC).get(),
  ]);
  return {
    stream: stream.exists ? toStreamRow(stream.data() as SessionStreamDoc) : null,
    recording: recording.exists
      ? toRecordingRow(recording.data() as SessionRecordingDoc, now)
      : null,
  };
}

/**
 * Every session with whatever is set up against it.
 *
 * Sorted in memory by local start, the same way `listSessions()` does it and
 * for the same reason: the composite index that would let Firestore sort this
 * does not exist, the emulator would not notice, and production would.
 */
export async function listWatchOverview(): Promise<WatchOverviewRow[]> {
  const now = Date.now();
  const snap = await db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get();

  const rows = await Promise.all(
    snap.docs.map(async (d) => {
      const s = d.data() as SessionDoc;
      const [stream, recording] = await Promise.all([
        d.ref.collection(SUBCOLLECTIONS.watch).doc(WATCH_STREAM_DOC).get(),
        d.ref.collection(SUBCOLLECTIONS.watch).doc(WATCH_RECORDING_DOC).get(),
      ]);
      return {
        id: d.id,
        title: s.title,
        startsAtLocal: s.startsAtLocal,
        day: s.day,
        status: s.status,
        roomName: s.roomName ?? '',
        stream: stream.exists ? toStreamRow(stream.data() as SessionStreamDoc) : null,
        recording: recording.exists
          ? toRecordingRow(recording.data() as SessionRecordingDoc, now)
          : null,
      } satisfies WatchOverviewRow;
    }),
  );

  return rows.sort(
    (a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal) || a.title.localeCompare(b.title),
  );
}
