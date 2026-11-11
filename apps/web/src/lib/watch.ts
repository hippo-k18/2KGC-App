import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  WATCH_RECORDING_DOC,
  WATCH_STREAM_DOC,
  sessionWatchView,
  type RecordingLike,
  type SessionRecordingDoc,
  type SessionStreamDoc,
  type SessionWatchView,
  type StreamLike,
  type Viewer,
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
 *
 * ⚠️ **The documents stop here.** `sessionWatchView()` is the only export, and
 * it hands back decisions rather than records. That is deliberate and it is the
 * fix for a real leak: the page used to fetch the whole thing and hand it to a
 * component that decided correctly, and the gated URL still went down the wire,
 * because a server component's props are serialised into the response whether
 * or not the markup renders them. A page that never holds the record cannot
 * send it, whatever the component does and whoever later marks it `'use
 * client'`.
 */

/** The two documents, with the timestamps reduced to epoch ms. Never exported. */
interface SessionWatchData {
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

async function sessionWatch(sessionId: string): Promise<SessionWatchData> {
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

/**
 * What one session page is given: two decisions and the dates beside them.
 *
 * The ticket comes in as a `Viewer` rather than being read here, because the
 * page already holds the pass for the line that lets somebody forget it, and a
 * second read is a second chance for the sentence and the gate to disagree.
 */
export async function sessionWatchPanel(
  sessionId: string,
  viewer: Viewer,
  nowMs: number,
): Promise<SessionWatchView> {
  const data = await sessionWatch(sessionId);
  return sessionWatchView(data.stream, data.recording, viewer, nowMs);
}
