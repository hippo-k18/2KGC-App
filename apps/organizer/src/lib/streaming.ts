import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  WATCH_RECORDING_DOC,
  WATCH_STREAM_DOC,
  formatDuration,
  recordingWindow,
  type RecordingWindow,
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

/**
 * The tiers that were sold a video library, by name.
 *
 * Two tiers say "Three months of the KGC Video Library" in their bullet list,
 * and `includesVideoLibrary` is the machine-readable half of that sentence —
 * the flag `entitlementKinds()` on the website already turns into a
 * `video-library` entitlement at fulfilment. It is read here so that restricting
 * a recording cannot quietly exclude somebody who paid for one: see
 * `saveRecordingAction`, which unions these names back in.
 *
 * Names rather than ids, because the restriction is expressed in the names
 * `RegistrationDoc.ticketType` carries and `firestore.rules` compares.
 */
export async function videoLibraryTicketNames(): Promise<string[]> {
  const snap = await db()
    .collection(COLLECTIONS.ticketTypes)
    .where('eventId', '==', EVENT_ID)
    .get();
  return snap.docs
    .map((d) => d.data() as { name?: string; includesVideoLibrary?: boolean })
    .filter((t) => t.includesVideoLibrary === true && typeof t.name === 'string')
    .map((t) => t.name as string)
    .sort((a, b) => a.localeCompare(b));
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
