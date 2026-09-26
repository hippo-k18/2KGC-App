import { useMemo } from 'react';
import { doc } from 'firebase/firestore';

import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  WATCH_RECORDING_DOC,
  WATCH_STREAM_DOC,
  providerLabel,
  type SessionRecordingDoc,
  type SessionStreamDoc,
  type Timestamp,
} from '@kgc/shared';

import { failureKind } from '@/lib/data/errors';
import { getDb } from '@/lib/firebase/client';
import { useDocument } from '@/lib/data/use-document';
import { useMyTicket } from '@/lib/data/my-ticket';
import { formatDayTab, formatTime, type Session } from '@/lib/data/sessions';
import {
  groupWatchable,
  recordingPanel,
  streamPanel,
  type RecordingFacts,
  type StreamFacts,
  type WatchOutcome,
  type WatchPanel,
} from '@/lib/data/watch-core';

/**
 * Reading what an attendee may watch.
 *
 * ── The two flags decide whether to ask at all ──────────────────────────────
 *
 * `sessions/{id}/watch/{stream|recording}` is gated by ticket type in
 * `firestore.rules`, and the rule reads `resource.data.allowedTicketTypes` —
 * which does not exist on a document that does not exist, so the rule errors
 * and the read is refused. A session with no stream and a session whose stream
 * is sold to another tier therefore come back identically.
 *
 * `SessionDoc.streamState` and `SessionDoc.hasRecording` are what tell the two
 * apart, and they are on the session document precisely so that this hook can
 * ask only the questions that have an answer. Ask anyway and every ordinary
 * session shows "not on your ticket" for a video nobody has set up.
 *
 * ── A refusal is the answer, not an error ───────────────────────────────────
 *
 * There is one other thing `permission-denied` can mean here: a `registered`
 * claim that has not caught up, which is the usual cause elsewhere in the app.
 * It cannot be the cause on this path — a reader who is looking at the session
 * at all has already been served the session document by the same claim — so
 * the refusal is read as the ticket answer it is.
 *
 * ── No collection-group query, here or anywhere ─────────────────────────────
 *
 * `list` is refused on this subcollection. A query across it would be denied
 * outright the moment one session in range was restricted, which is a video
 * library that fails for exactly the people it was sold to. The Watch screen
 * reads the flags on the session documents instead and asks nothing per row.
 */

function msOf(ts: Timestamp | undefined): number | null {
  if (!ts) return null;
  try {
    const ms = ts.toMillis();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    // A hand-written or imported document can hold a plain string where a
    // timestamp belongs. An availability window nobody can read is treated as
    // no window at all, which leaves the recording open — the same direction
    // the dashboard's own "absent means it stays up" takes.
    return null;
  }
}

function toStreamFacts(d: SessionStreamDoc): StreamFacts {
  return {
    state: d.state,
    embeddable: d.embeddable !== false,
    embedUrl: d.embedUrl ?? '',
    watchUrl: d.watchUrl ?? '',
    providerLabel: providerLabel(d.provider),
  };
}

function toRecordingFacts(d: SessionRecordingDoc): RecordingFacts {
  return {
    title: d.title ?? '',
    embeddable: d.embeddable !== false,
    embedUrl: d.embedUrl ?? '',
    watchUrl: d.watchUrl ?? '',
    providerLabel: providerLabel(d.provider),
    durationSeconds: d.durationSeconds ?? null,
    availableFromMs: msOf(d.availableFrom),
    availableUntilMs: msOf(d.availableUntil),
  };
}

function outcomeOf(asked: boolean, loading: boolean, error: unknown, data: unknown): WatchOutcome {
  if (!asked) return 'none';
  if (error) return failureKind(error) === 'denied' ? 'denied' : 'error';
  if (loading) return 'loading';
  // Settled and absent: the flag on the session says there is one and the
  // document is gone, which is a dashboard write that half-landed. Reported as
  // an error rather than as nothing, because nothing is the empty box.
  return data ? 'ready' : 'error';
}

export interface SessionWatch {
  stream: WatchPanel | null;
  recording: WatchPanel | null;
  /** True when this session has anything at all to say about watching it. */
  any: boolean;
}

/**
 * The two blocks a session detail screen draws, or nulls when there is nothing
 * set up. Safe to call with a session that is still loading.
 */
export function useSessionWatch(session: Session | null): SessionWatch {
  const id = session?.id ?? null;
  const hasStream = Boolean(session?.streamState);
  const hasRecording = session?.hasRecording === true;

  /*
   * The closing date off the session, which every reader may see.
   *
   * `firestore.rules` enforces the availability window as well as the ticket,
   * so once a library closes the document is refused — and asking for it
   * anyway turns "this closed on 1 March" into "not on your ticket". Same
   * reason the two flags above gate the reads at all: ask only the questions
   * that have an answer.
   */
  const closesAtMs = msOf(session?.recordingUntil);
  const recordingClosed = closesAtMs !== null && closesAtMs <= Date.now();
  const askRecording = hasRecording && !recordingClosed;

  const streamRead = useDocument<SessionStreamDoc>(
    () =>
      hasStream && id
        ? doc(getDb(), COLLECTIONS.sessions, id, SUBCOLLECTIONS.watch, WATCH_STREAM_DOC)
        : null,
    [hasStream, id],
    (_docId, d) => d as SessionStreamDoc,
  );

  const recordingRead = useDocument<SessionRecordingDoc>(
    () =>
      askRecording && id
        ? doc(getDb(), COLLECTIONS.sessions, id, SUBCOLLECTIONS.watch, WATCH_RECORDING_DOC)
        : null,
    [askRecording, id],
    (_docId, d) => d as SessionRecordingDoc,
  );

  // Only a restricted session costs a registration read. Most do not have one.
  const restricted = (session?.watchRestricted ?? false) && (hasStream || hasRecording);
  const ticket = useMyTicket(restricted);

  const streamOutcome = outcomeOf(
    hasStream,
    streamRead.loading,
    streamRead.error,
    streamRead.data,
  );
  const recordingOutcome = outcomeOf(
    askRecording,
    recordingRead.loading,
    recordingRead.error,
    recordingRead.data,
  );

  const streamData = streamRead.data;
  const recordingData = recordingRead.data;

  return useMemo(() => {
    if (!session) return { stream: null, recording: null, any: false };

    const stream = streamPanel({
      outcome: streamOutcome,
      stream: streamData ? toStreamFacts(streamData) : null,
      stateHint: session.streamState ?? null,
      allowed: session.streamTicketTypes ?? [],
      myTicketType: ticket.ticketType,
      startsAt: { day: formatDayTab(session.day), time: formatTime(session.startsAtLocal) },
      hasRecording,
    });

    const recording = recordingPanel({
      outcome: recordingOutcome,
      recording: recordingData ? toRecordingFacts(recordingData) : null,
      exists: hasRecording,
      allowed: session.recordingTicketTypes ?? [],
      myTicketType: ticket.ticketType,
      closesAtMs,
      // Read once per render rather than on a timer. A recording whose window
      // closes while somebody is looking at the screen keeps playing until they
      // leave it, which is the kinder of the two wrong answers and the one a
      // video player gives anyway.
      nowMs: Date.now(),
    });

    return { stream, recording, any: Boolean(stream || recording) };
  }, [
    session,
    streamOutcome,
    streamData,
    recordingOutcome,
    recordingData,
    hasRecording,
    closesAtMs,
    ticket.ticketType,
  ]);
}

/** A session on the Watch screen, with the times already in words. */
export interface WatchCandidateSession {
  session: Session;
  /** 'Tue 4 May · 2:30 PM', or as much of it as the session carries. */
  when: string;
  streamState?: Session['streamState'] | null;
  hasRecording?: boolean;
  streamTicketTypes?: string[];
  recordingTicketTypes?: string[];
  recordingUntilMs?: number | null;
}

/**
 * Everything the event has to watch, in three lists.
 *
 * Built entirely from the session documents the agenda has already loaded. No
 * read is made per row: `list` is refused on the watch subcollection, and the
 * flags are on the session for exactly this screen. What that costs is that
 * the tag on a row is the session's word rather than the rules', which is why
 * `watchRowTag` says nothing at all when the reader's ticket is unknown.
 */
export function useWatchLists(sessions: Session[] | null) {
  const watchable = useMemo(
    () => (sessions ?? []).filter((s) => Boolean(s.streamState) || s.hasRecording === true),
    [sessions],
  );
  // The registration read is worth making only when something is restricted.
  const restricted = watchable.some((s) => s.watchRestricted === true);
  const ticket = useMyTicket(restricted);

  return useMemo(() => {
    const rows: WatchCandidateSession[] = watchable.map((session) => ({
      session,
      when: [formatDayTab(session.day), formatTime(session.startsAtLocal)]
        .filter(Boolean)
        .join(' · '),
      streamState: session.streamState ?? null,
      hasRecording: session.hasRecording === true,
      streamTicketTypes: session.streamTicketTypes ?? [],
      recordingTicketTypes: session.recordingTicketTypes ?? [],
      recordingUntilMs: msOf(session.recordingUntil),
    }));

    const grouped = groupWatchable(rows, ticket.ticketType, ticket.known, Date.now());
    return { ...grouped, anything: watchable.length > 0 };
  }, [watchable, ticket.ticketType, ticket.known]);
}
