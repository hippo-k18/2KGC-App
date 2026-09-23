import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  WATCH_RECORDING_DOC,
  WATCH_STREAM_DOC,
  type RecordingLike,
  type SessionRecordingDoc,
  type SessionStreamDoc,
  type StreamLike,
} from '@kgc/shared';
import { db } from '@/lib/firestore';

/**
 * Reading `sessions/{id}/watch/{stream|recording}` for the public site.
 *
 * ── Two fixed ids, fetched directly, never listed ───────────────────────────
 *
 * `firestore.rules` denies `list` on this subcollection, for the reason given
 * in the rules file: a collection-group query over it would be refused outright
 * the moment one session in range is restricted. This reads the two documents
 * by id for the same reason even though the Admin SDK would happily list them
 * — a server read that works by a route the client could never take is a read
 * that drifts from the rule it is supposed to mirror.
 *
 * ── ⚠️ The Admin SDK bypasses the gate, so the gate is the caller's ─────────
 *
 * On the phone, the ticket check happens in `firestore.rules` and a viewer with
 * the wrong ticket never receives the URL. Here it does not: this process holds
 * a credential that reads everything. So the document comes back whole, and
 * `watch-view-core.ts` is what decides whether any of it reaches the page.
 * Nothing in this file may be rendered directly — the page takes a `WatchView`,
 * and the blocked shape carries no URL at all.
 */

/** What the page needs, with the timestamps already reduced to epoch ms. */
export interface SessionWatchData {
  stream: (StreamLike & { provider: string }) | null;
  recording:
    | (RecordingLike & {
        provider: string;
        title: string;
        durationSeconds?: number;
        availableUntilMs?: number | null;
      })
    | null;
}

const millis = (t: unknown): number | null => {
  const v = t as { toMillis?: () => number } | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : null;
};

export async function sessionWatch(sessionId: string): Promise<SessionWatchData> {
  const empty: SessionWatchData = { stream: null, recording: null };
  try {
    const watch = db()
      .collection(COLLECTIONS.sessions)
      .doc(sessionId)
      .collection(SUBCOLLECTIONS.watch);

    const [streamSnap, recordingSnap] = await db().getAll(
      watch.doc(WATCH_STREAM_DOC),
      watch.doc(WATCH_RECORDING_DOC),
    );

    const s = streamSnap.exists ? (streamSnap.data() as SessionStreamDoc) : null;
    const r = recordingSnap.exists ? (recordingSnap.data() as SessionRecordingDoc) : null;

    return {
      /*
       * `eventId` is checked on the documents themselves. The session id is
       * already scoped by the page, but these are separate documents written by
       * a separate action, and a stream left behind by a previous event under a
       * reused session id would otherwise play.
       */
      stream:
        s && s.eventId === EVENT_ID
          ? {
              provider: s.provider,
              embedUrl: s.embedUrl,
              watchUrl: s.watchUrl,
              embeddable: s.embeddable !== false,
              state: s.state,
              allowedTicketTypes: s.allowedTicketTypes ?? [],
            }
          : null,
      recording:
        r && r.eventId === EVENT_ID
          ? {
              provider: r.provider,
              embedUrl: r.embedUrl,
              watchUrl: r.watchUrl,
              embeddable: r.embeddable !== false,
              title: r.title,
              durationSeconds: r.durationSeconds,
              allowedTicketTypes: r.allowedTicketTypes ?? [],
              availableFromMs: millis(r.availableFrom),
              availableUntilMs: millis(r.availableUntil),
            }
          : null,
    };
  } catch (err) {
    console.error('[watch] could not read what is set up for this session', err);
    return empty;
  }
}
