import { formatDuration, recordingWindow, type StreamState } from '@kgc/shared';

/**
 * What an attendee is told about watching a session, worked out away from the
 * screen so it can be tested.
 *
 * The arithmetic and the parsing are already in `@kgc/shared`
 * (`recordingWindow`, `formatDuration`, `mayWatch`); this file is the layer
 * above them — the six states a person can actually be in, and the sentence
 * each one gets. It holds no Firestore import and no React.
 *
 * ── Every state says something, and none of them is an empty box ────────────
 *
 * A grey rectangle where a video should be is the failure mode this project
 * already has too many of, and it is indistinguishable from a bug. So the six
 * outcomes each carry their own line:
 *
 *   · nothing set up      → no panel at all, rather than a heading over nothing
 *   · streaming later     → when it starts, and where to open it
 *   · live now            → the player, or the way out to Zoom
 *   · the stream finished → whether there is a recording, in the same breath
 *   · a recording up      → how long it runs, and when it closes if it does
 *   · a recording closed  → the date it closed, not silence
 *
 * plus the one that is not about time at all: the reader's ticket does not
 * cover it. That one names the tickets that do, because "you may not watch
 * this" is not something a person can act on and "this is included with All
 * Access and Gold" is.
 *
 * ── Why a denial is read as a ticket answer ─────────────────────────────────
 *
 * `firestore.rules` gates `sessions/{id}/watch/{stream|recording}` on ticket
 * type, so the wrong ticket gets `permission-denied` and never sees the URL —
 * which is the point, and which means the app learns the answer by being
 * refused. The refusal is therefore not an error to report; it is the answer.
 * The one thing the caller must get right is not *asking* when the session has
 * no such document: a `get` on a document that does not exist evaluates the
 * rule against a null `resource` and is refused too, so an unasked question
 * would come back looking exactly like a denied one. The session's own
 * `streamState` and `hasRecording` flags are what decide whether to ask.
 */

/** How one gated watch document came back. */
export type WatchOutcome =
  /** The session has no such document, so nothing was asked. */
  | 'none'
  /** Asked, still out. */
  | 'loading'
  /** Read it. */
  | 'ready'
  /** Refused: this ticket does not cover it. */
  | 'denied'
  /** Something else went wrong — offline, a malformed document. */
  | 'error';

/** The stream document, reduced to what a screen uses. */
export interface StreamFacts {
  state: StreamState;
  embeddable: boolean;
  embedUrl: string;
  watchUrl: string;
  providerLabel: string;
}

/** The recording document, reduced the same way. */
export interface RecordingFacts {
  title: string;
  embeddable: boolean;
  embedUrl: string;
  watchUrl: string;
  providerLabel: string;
  durationSeconds?: number | null;
  availableFromMs?: number | null;
  availableUntilMs?: number | null;
}

/** One block on a screen: a heading, a line, and at most one thing to do. */
export interface WatchPanel {
  /** 'Live now', 'Streaming later', 'Recording'. */
  title: string;
  /** One line. Never blank. */
  message: string;
  /** Put this in a player, or null when there is nothing to play. */
  embedUrl: string | null;
  /** Open this outside the app, or null. */
  openUrl: string | null;
  /** What the button that opens it says. */
  openLabel: string;
  /** Draw the live dot. */
  live: boolean;
  /** This reader is being refused, so the block is drawn quietly. */
  barred: boolean;
}

/**
 * `https` and nothing else, checked again on the way out.
 *
 * The stored URL is already normalised by `parseStreamSource`, so in the
 * ordinary case this passes. It exists for the documents that did not come
 * through that path — a hand-edited record, an import, a field cleared to an
 * empty string — because the two things downstream of it are an iframe `src`
 * and `Linking.openURL`, and both of those will take a `javascript:` string
 * without complaint. A URL that fails here becomes a panel with no player and
 * no button rather than a frame that renders nothing.
 *
 * Matched with a regular expression rather than `new URL`. React Native's
 * `URL` is a partial polyfill that does not parse a protocol reliably, so the
 * check that looked the most careful would be the one that silently passed
 * everything on a phone.
 */
const HTTPS_URL = /^https:\/\/[^\s<>"']+$/i;

export function playableUrl(url: string | null | undefined): string | null {
  const trimmed = (url ?? '').trim();
  return HTTPS_URL.test(trimmed) ? trimmed : null;
}

/** "A, B and C". */
function andList(names: string[]): string {
  const clean = names.filter(Boolean);
  if (clean.length <= 1) return clean.join('');
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

/**
 * `31 December 2027`, in UTC.
 *
 * UTC because that is how the dashboard asks for it and what it says beside
 * both date boxes: an availability window is a contractual date rather than a
 * moment in the room, and converting it to the reader's own zone would move the
 * closing date by a day for anybody east or west of the organizer. Returns ''
 * for a value that is not a date, which the callers treat as "no date known"
 * rather than printing `Invalid Date` at somebody.
 */
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatWatchDate(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const month = MONTHS[d.getUTCMonth()];
  if (!month) return '';
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

/**
 * The line a refused reader gets.
 *
 * Their own ticket is named when it is known, because "this is for All Access
 * and Gold tickets" leaves somebody wondering which one they hold, and the
 * answer is two taps away in a screen they are not currently on. When the names
 * are not known either — an older session document written before the dashboard
 * started stamping them — it says only what it can stand behind.
 *
 * ── It must never argue with the refusal ────────────────────────────────────
 *
 * The two halves of this sentence come from two different places. The list of
 * tickets and the reader's own ticket come from a query on their email address,
 * which always works. The refusal comes from `firestore.rules`, which finds the
 * ticket through the pointer on the profile, which for a while was written on
 * one screen only. An attendee who had never opened that screen got "included
 * with All Access tickets. Your ticket is All Access." over a video they had
 * just been refused — the app telling somebody they are wrong about something
 * they can see.
 *
 * The refusal is the one that decides, so when the two disagree this says so
 * and gives the reader something to do, rather than repeating a claim the
 * screen has already disproved.
 */
export function ticketSentence(
  what: 'stream' | 'recording',
  allowed: string[],
  myTicketType: string | null | undefined,
): string {
  // The reader holds one of the tickets this was sold with, and has been
  // refused anyway. Saying it is included would be the app disagreeing with
  // itself in two consecutive sentences.
  if (myTicketType && allowed.includes(myTicketType)) {
    return 'Your ticket could not be checked on this device, so this is locked. Check your ticket on the Me tab, then try again.';
  }

  const subject = what === 'stream' ? 'Watching this session live is' : 'This recording is';
  const names = andList(allowed);
  const forWhom = names
    ? `${subject} included with ${names} tickets.`
    : `${subject} not included with every ticket.`;
  return myTicketType ? `${forWhom} Your ticket is ${myTicketType}.` : forWhom;
}

/** When a session starts, in the words the panels use. */
export interface StartsAt {
  /** `Tue 4 May`, already formatted by the caller. */
  day: string;
  /** `2:30 PM`, already formatted by the caller. */
  time: string;
}

/**
 * The live-stream block, or null when there is nothing to say.
 *
 * `outcome` and `stream` are the read; `allowed` and `myTicketType` are what
 * the session document and the reader's registration already told us, and they
 * are the only way to write the refusal sentence — by the time the rules have
 * refused the document, its own `allowedTicketTypes` is exactly what the reader
 * cannot see.
 */
export function streamPanel(input: {
  outcome: WatchOutcome;
  stream: StreamFacts | null;
  /** `SessionDoc.streamState`, known before the read and without being allowed. */
  stateHint: StreamState | null | undefined;
  /** `SessionDoc.streamTicketTypes`. */
  allowed: string[];
  myTicketType: string | null | undefined;
  startsAt: StartsAt;
  /** Whether this session also has a recording, for the "it finished" line. */
  hasRecording: boolean;
}): WatchPanel | null {
  const { outcome, stream, stateHint, allowed, myTicketType, startsAt, hasRecording } = input;
  if (outcome === 'none' || !stateHint) return null;

  const heading =
    stateHint === 'live' ? 'Live now' : stateHint === 'ended' ? 'Stream finished' : 'Streaming later';

  const bare = (message: string, live = false, barred = false): WatchPanel => ({
    title: heading,
    message,
    embedUrl: null,
    openUrl: null,
    openLabel: '',
    live,
    barred,
  });

  if (outcome === 'denied') {
    return bare(ticketSentence('stream', allowed, myTicketType), false, true);
  }
  if (outcome === 'loading') return bare('Finding the stream.');
  if (outcome === 'error' || !stream) {
    return bare('The stream could not be loaded. Try again in a moment.');
  }

  const openUrl = playableUrl(stream.watchUrl);
  const embedUrl = stream.embeddable ? playableUrl(stream.embedUrl) : null;
  const where = stream.providerLabel;

  if (stream.state === 'ended') {
    return bare(
      hasRecording
        ? 'The live stream has finished. The recording is below.'
        : 'The live stream has finished. No recording has been posted yet.',
    );
  }

  if (stream.state === 'scheduled') {
    const when = startsAt.day && startsAt.time ? `${startsAt.day} at ${startsAt.time}` : '';
    return {
      title: heading,
      message: when
        ? `This session streams here from ${when}.`
        : 'This session streams here when it starts.',
      embedUrl: null,
      openUrl,
      openLabel: openUrl ? `Open on ${where}` : '',
      live: false,
      barred: false,
    };
  }

  // Live. A provider that refuses to be framed is a button out of the app, and
  // says so: Zoom sends `X-Frame-Options`, and a player that renders an empty
  // grey box is worse than a link that works.
  if (!embedUrl) {
    return {
      title: heading,
      message: openUrl
        ? `This session is running in ${where} right now.`
        : 'This session is live, but the link to it is missing. Ask at the registration desk.',
      embedUrl: null,
      openUrl,
      openLabel: openUrl ? `Join in ${where}` : '',
      live: true,
      barred: false,
    };
  }

  return {
    title: heading,
    message: 'This session is streaming now.',
    embedUrl,
    openUrl,
    openLabel: openUrl ? `Open on ${where}` : '',
    live: true,
    barred: false,
  };
}

/** The recording block, or null when there is nothing to say. */
export function recordingPanel(input: {
  outcome: WatchOutcome;
  recording: RecordingFacts | null;
  /** `SessionDoc.hasRecording`, known without being allowed to read it. */
  exists: boolean;
  /** `SessionDoc.recordingTicketTypes`. */
  allowed: string[];
  myTicketType: string | null | undefined;
  /**
   * `SessionDoc.recordingUntil`, which every reader of the session may see.
   *
   * ⚠️ Needed because `firestore.rules` now enforces the availability window
   * as well as the ticket, so a closed library refuses the document — and a
   * refusal on its own reads as "not on your ticket", which is both the wrong
   * sentence and an insulting one to somebody whose ticket did include it. The
   * closing date is not a secret; it is on the session for this.
   */
  closesAtMs?: number | null;
  nowMs: number;
}): WatchPanel | null {
  const { outcome, recording, exists, allowed, myTicketType, closesAtMs, nowMs } = input;
  if (!exists) return null;

  const bare = (message: string, barred = false): WatchPanel => ({
    title: 'Recording',
    message,
    embedUrl: null,
    openUrl: null,
    openLabel: '',
    live: false,
    barred,
  });

  /*
   * Ahead of both `none` and `denied`, on purpose.
   *
   * A closed library and a wrong ticket both come back from the rules as a
   * refusal, and only one of them has an honest sentence to offer. The caller
   * does not even ask for a document it knows is closed, so the outcome it
   * passes is `none` — which without this branch draws no block at all, and a
   * recording that silently disappears is the worse of the two wrong answers.
   */
  if (typeof closesAtMs === 'number' && closesAtMs <= nowMs) {
    const closed = formatWatchDate(closesAtMs);
    return bare(
      closed
        ? `This recording closed on ${closed} and is no longer available.`
        : 'This recording is no longer available.',
    );
  }

  if (outcome === 'none') return null;
  if (outcome === 'denied') {
    return bare(ticketSentence('recording', allowed, myTicketType), true);
  }
  if (outcome === 'loading') return bare('Finding the recording.');
  if (outcome === 'error' || !recording) {
    return bare('The recording could not be loaded. Try again in a moment.');
  }

  const window = recordingWindow(
    {
      availableFromMs: recording.availableFromMs ?? null,
      availableUntilMs: recording.availableUntilMs ?? null,
    },
    nowMs,
  );

  if (window === 'not-yet') {
    const opens = formatWatchDate(recording.availableFromMs);
    return bare(
      opens ? `This recording opens on ${opens}.` : 'This recording is not open yet.',
    );
  }
  if (window === 'expired') {
    const closed = formatWatchDate(recording.availableUntilMs);
    return bare(
      closed
        ? `This recording closed on ${closed} and is no longer available.`
        : 'This recording is no longer available.',
    );
  }

  const openUrl = playableUrl(recording.watchUrl);
  const embedUrl = recording.embeddable ? playableUrl(recording.embedUrl) : null;
  const parts = [
    recording.durationSeconds ? `Runs ${formatDuration(recording.durationSeconds)}` : '',
    recording.availableUntilMs
      ? `Available until ${formatWatchDate(recording.availableUntilMs)}`
      : '',
  ].filter(Boolean);

  return {
    title: 'Recording',
    message:
      parts.length > 0
        ? `${parts.join('. ')}.`
        : embedUrl
          ? 'The recording of this session.'
          : `The recording of this session, on ${recording.providerLabel}.`,
    embedUrl,
    openUrl,
    openLabel: openUrl ? `Open on ${recording.providerLabel}` : '',
    live: false,
    barred: false,
  };
}

/**
 * The tag on one row of the Watch list.
 *
 * Drawn from the session document alone — no gated read per row, which is what
 * the flags on the session exist for. It is an honest guess and not the
 * verdict: the rules decide on the way into the player, and a reader whose
 * registration could not be read is shown nothing rather than a warning the
 * app cannot stand behind.
 */
export function watchRowTag(
  allowed: string[],
  myTicketType: string | null | undefined,
  ticketKnown: boolean,
): string | null {
  if (allowed.length === 0) return null;
  if (!ticketKnown) return null;
  return myTicketType && allowed.includes(myTicketType) ? null : 'Not on your ticket';
}

/** The parts of a session the Watch list sorts and labels by. */
export interface WatchCandidate {
  streamState?: StreamState | null;
  hasRecording?: boolean;
  streamTicketTypes?: string[];
  recordingTicketTypes?: string[];
  recordingUntilMs?: number | null;
}

export interface WatchEntry<T> {
  item: T;
  /** 'Not on your ticket', or null. */
  tag: string | null;
  /** 'Available until 31 December 2027', 'Closed 1 March 2027', or ''. */
  note: string;
  /** The recording's window has closed. Rows stay listed, drawn quietly. */
  closed: boolean;
}

export interface WatchGrouping<T> {
  live: WatchEntry<T>[];
  upcoming: WatchEntry<T>[];
  recordings: WatchEntry<T>[];
}

/**
 * What is on now, what is coming, and what can be watched back.
 *
 * Generic over the session type so it can be tested without Firestore. One
 * session can appear twice — a talk that streamed this morning and has its
 * recording up belongs in both lists — and that is deliberate: the two answer
 * different questions and a reader looking for the recording should not have to
 * know it was ever live.
 *
 * A closed recording is listed rather than dropped. Somebody who bought a
 * library and let it lapse is owed the date it closed; a row that silently
 * disappears reads as a bug in the app, and the one thing they might do about
 * it — ask the organizers — needs them to know it existed.
 */
export function groupWatchable<T extends WatchCandidate>(
  sessions: T[],
  myTicketType: string | null | undefined,
  ticketKnown: boolean,
  nowMs: number,
): WatchGrouping<T> {
  const live: WatchEntry<T>[] = [];
  const upcoming: WatchEntry<T>[] = [];
  const recordings: WatchEntry<T>[] = [];

  for (const item of sessions) {
    const streamTag = watchRowTag(item.streamTicketTypes ?? [], myTicketType, ticketKnown);
    if (item.streamState === 'live') {
      live.push({ item, tag: streamTag, note: '', closed: false });
    } else if (item.streamState === 'scheduled') {
      upcoming.push({ item, tag: streamTag, note: '', closed: false });
    }

    if (item.hasRecording === true) {
      const until = item.recordingUntilMs ?? null;
      const closed = until !== null && nowMs >= until;
      const date = formatWatchDate(until);
      recordings.push({
        item,
        tag: watchRowTag(item.recordingTicketTypes ?? [], myTicketType, ticketKnown),
        note: date ? (closed ? `Closed ${date}` : `Available until ${date}`) : '',
        closed,
      });
    }
  }

  return { live, upcoming, recordings };
}
