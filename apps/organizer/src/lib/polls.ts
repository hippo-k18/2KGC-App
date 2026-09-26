import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  type PollDoc,
  type PollVoteDoc,
  type SessionDoc,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * Engagement › Live Polling.
 *
 * ── The tally is counted here, not read off the document ───────────────────
 *
 * `PollDoc.tallies` and `PollDoc.totalVotes` are written by the `tallyPoll`
 * trigger. The triggers in `functions/` are written and tested and **not
 * deployed** — blocked on one IAM grant (`OWNER-ACTIONS.md` §3) — so on the
 * live project those two fields hold whatever last wrote them and do not move,
 * while the votes themselves land correctly, one document per voter, in the
 * `votes` subcollection.
 *
 * A polling screen that read `totalVotes` would show a number that is
 * confidently wrong in front of an audience. So this reads the vote documents
 * and derives both the total and the per-option split from them. That is a real
 * count of real data and needs no trigger and no plan upgrade; the stored
 * numbers are returned alongside only so the screen can say when the two
 * disagree, because the stored ones are what an *attendee's* phone shows.
 *
 * ── Why the same trick does not fix the app ────────────────────────────────
 *
 * The dashboard is one reader per page load. The app is a thousand phones
 * watching one poll, and asking each of them to read every vote document is the
 * traffic the trigger exists to prevent. A ballot is secret besides: the rules
 * let a `votes` document be read only by its owner and by an organizer, so an
 * attendee counting them is denied outright. `publishTally()` below is the
 * honest middle: the server counts once, and every phone reads one document.
 *
 * ── Live results: the same write, on a timer somebody can see ───────────────
 *
 * `PollDoc.liveResults` turns that button into a heartbeat. The room view
 * recounts and republishes every few seconds while it is open, so the phones in
 * the room follow the screen at the front of it without anybody pressing
 * anything. It is still a snapshot — a vote cast a second after the last recount
 * is in the next one — and it stops the moment the room view is closed, which
 * is why the tile on the poll row says when the count was last published rather
 * than claiming the number is live. What it is not is a substitute for
 * `tallyPoll`: a poll nobody is projecting still needs the button.
 *
 * ── Why this walks sessions instead of a collection group ───────────────────
 *
 * `collectionGroup('polls')` would be one query, but polls are a subcollection
 * of a session and the screen needs the session title beside every poll anyway.
 * Walking the sessions gets both in the same pass and matches `listQaSessions`
 * in `moderation.ts`, which solved the identical problem for Q&A. One equality
 * filter on `eventId`, sorting in memory — the rule everywhere in this app,
 * because the emulator does not enforce composite indexes.
 */

export interface PollOptionRow {
  id: string;
  label: string;
  /** Vote documents naming this option. Counted, never read off `tallies`. */
  votes: number;
  /** What the attendee's phone currently shows for this option. */
  storedVotes: number;
}

export interface PollRow {
  id: string;
  sessionId: string;
  sessionTitle: string;
  sessionDay: string;
  startsAtLocal: string;
  question: string;
  options: PollOptionRow[];
  open: boolean;
  /** Republish the count by itself while the room view is open. */
  liveResults: boolean;
  /** `PollDoc.totalVotes` as stored — trigger-owned, and therefore frozen. */
  storedTotal: number;
  /** Vote documents actually present. This is the true number. */
  actualVotes: number;
  /** True when the stored tally disagrees with the votes on disk. */
  stale: boolean;
  /** When somebody last published the count to the app, if ever. */
  talliesUpdatedAt: string | null;
  createdAt: string;
}

export interface PollRead {
  polls: PollRow[];
  /** Sessions with `pollsEnabled`, whether or not anybody wrote a poll. */
  enabledSessions: number;
  /** Live sessions in total, so "3 of 72" reads as a share rather than a count. */
  liveSessions: number;
  votesCast: number;
  votesShownByTallies: number;
  /** Sessions a poll can be attached to, oldest first, for the editor. */
  sessions: { id: string; label: string }[];
}

function iso(t: { toDate(): Date } | undefined): string {
  try {
    return t?.toDate().toISOString() ?? '';
  } catch {
    return '';
  }
}

/**
 * Every vote document for one poll, split by option.
 *
 * `PollVoteDoc.optionIds` is an array because a poll may accept more than one
 * answer, so the per-option numbers can legitimately sum to more than the
 * number of voters. The total is the count of *voters*, which is what the
 * document count already is — deriving it from the option sums instead would
 * over-count every multi-select poll.
 */
function splitByOption(
  options: PollDoc['options'],
  votes: PollVoteDoc[],
): Map<string, number> {
  const counts = new Map<string, number>((options ?? []).map((o) => [o.id, 0]));
  for (const v of votes) {
    for (const id of v.optionIds ?? []) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

export async function readPolls(): Promise<PollRead> {
  const sessionSnap = await db()
    .collection(COLLECTIONS.sessions)
    .where('eventId', '==', EVENT_ID)
    .get();

  const live = sessionSnap.docs.filter((d) => {
    const s = d.data() as SessionDoc;
    return s.status !== 'cancelled' && !s.deletedAt;
  });

  const polls: PollRow[] = [];
  let enabledSessions = 0;

  await Promise.all(
    live.map(async (d) => {
      const s = d.data() as SessionDoc;
      if (s.pollsEnabled) enabledSessions++;

      const pollSnap = await d.ref.collection(SUBCOLLECTIONS.polls).get();

      await Promise.all(
        pollSnap.docs.map(async (p) => {
          const poll = p.data() as PollDoc;
          // The whole subcollection rather than a `count()` aggregation: the
          // per-option split needs `optionIds` off each document, and an
          // aggregation returns a number rather than the documents. At poll
          // volumes this is one small read; if a keynote ever carries a poll
          // with a thousand voters, the total alone is a `count()` and only the
          // split needs the documents.
          const voteSnap = await p.ref.collection(SUBCOLLECTIONS.votes).get();
          const votes = voteSnap.docs.map((v) => v.data() as PollVoteDoc);
          const counts = splitByOption(poll.options, votes);
          const stored = poll.totalVotes ?? 0;

          polls.push({
            id: p.id,
            sessionId: d.id,
            sessionTitle: s.title,
            sessionDay: s.day,
            startsAtLocal: s.startsAtLocal,
            question: poll.question,
            options: (poll.options ?? []).map((o) => ({
              id: o.id,
              label: o.label,
              votes: counts.get(o.id) ?? 0,
              storedVotes: poll.tallies?.[o.id] ?? 0,
            })),
            open: Boolean(poll.open),
            liveResults: Boolean(poll.liveResults),
            storedTotal: stored,
            actualVotes: voteSnap.size,
            stale: stored !== voteSnap.size,
            talliesUpdatedAt: poll.talliesUpdatedAt ? iso(poll.talliesUpdatedAt) : null,
            createdAt: iso(poll.createdAt),
          });
        }),
      );
    }),
  );

  polls.sort(
    (a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal) || a.question.localeCompare(b.question),
  );

  const sessions = live
    .map((d) => ({ id: d.id, doc: d.data() as SessionDoc }))
    .sort((a, b) => a.doc.startsAtLocal.localeCompare(b.doc.startsAtLocal))
    .map((r) => ({
      id: r.id,
      label: `${r.doc.day} ${r.doc.startsAtLocal.slice(11, 16)} · ${r.doc.title}`,
    }));

  return {
    polls,
    enabledSessions,
    liveSessions: live.length,
    votesCast: polls.reduce((n, p) => n + p.actualVotes, 0),
    votesShownByTallies: polls.reduce((n, p) => n + p.storedTotal, 0),
    sessions,
  };
}

/** One poll, with its votes already counted. Null when it does not exist. */
export async function getPoll(sessionId: string, pollId: string): Promise<PollRow | null> {
  const sessionRef = db().collection(COLLECTIONS.sessions).doc(sessionId);
  const [sessionDoc, pollDoc] = await Promise.all([
    sessionRef.get(),
    sessionRef.collection(SUBCOLLECTIONS.polls).doc(pollId).get(),
  ]);
  if (!sessionDoc.exists || !pollDoc.exists) return null;

  const s = sessionDoc.data() as SessionDoc;
  const poll = pollDoc.data() as PollDoc;
  const voteSnap = await pollDoc.ref.collection(SUBCOLLECTIONS.votes).get();
  const votes = voteSnap.docs.map((v) => v.data() as PollVoteDoc);
  const counts = splitByOption(poll.options, votes);

  return {
    id: pollDoc.id,
    sessionId,
    sessionTitle: s.title,
    sessionDay: s.day,
    startsAtLocal: s.startsAtLocal,
    question: poll.question,
    options: (poll.options ?? []).map((o) => ({
      id: o.id,
      label: o.label,
      votes: counts.get(o.id) ?? 0,
      storedVotes: poll.tallies?.[o.id] ?? 0,
    })),
    open: Boolean(poll.open),
    liveResults: Boolean(poll.liveResults),
    storedTotal: poll.totalVotes ?? 0,
    actualVotes: voteSnap.size,
    stale: (poll.totalVotes ?? 0) !== voteSnap.size,
    talliesUpdatedAt: poll.talliesUpdatedAt ? iso(poll.talliesUpdatedAt) : null,
    createdAt: iso(poll.createdAt),
  };
}

/**
 * Count the votes and write the result to the fields the app reads.
 *
 * ⚠️ `tallies` and `totalVotes` are trigger-owned and no client may write them —
 * `tests/rules/firestore.test.ts` asserts exactly that, and this does not change
 * it. This runs on the Admin SDK from a trusted server, which is the same
 * privilege the trigger would have; when `tallyPoll` is finally deployed it
 * writes the same numbers from the same source and this becomes redundant
 * rather than conflicting.
 *
 * Returns the totals it wrote, so the caller can say what happened.
 */
export async function publishTally(
  sessionId: string,
  pollId: string,
): Promise<{ total: number; options: number }> {
  const ref = db()
    .collection(COLLECTIONS.sessions)
    .doc(sessionId)
    .collection(SUBCOLLECTIONS.polls)
    .doc(pollId);

  const [pollDoc, voteSnap] = await Promise.all([
    ref.get(),
    ref.collection(SUBCOLLECTIONS.votes).get(),
  ]);
  if (!pollDoc.exists) throw new Error('That poll no longer exists.');

  const poll = pollDoc.data() as PollDoc;
  const votes = voteSnap.docs.map((v) => v.data() as PollVoteDoc);
  const counts = splitByOption(poll.options, votes);

  /**
   * Every option is named on every write, including the ones on zero.
   * `tallies` is a nested map under a merge write, and a merge merges maps key
   * by key — sending only the options that scored would leave a previously
   * published number for an option that has since been renamed or emptied.
   */
  const tallies: Record<string, number> = {};
  for (const o of poll.options ?? []) tallies[o.id] = counts.get(o.id) ?? 0;

  await ref.set(
    { tallies, totalVotes: voteSnap.size, talliesUpdatedAt: new Date() },
    { merge: true },
  );

  return { total: voteSnap.size, options: Object.keys(tallies).length };
}

/**
 * Publish the count, but only for a poll whose organizer asked for that.
 *
 * The room view calls this on its own timer. Reading `liveResults` here rather
 * than trusting the caller is the point: the timer runs in a browser, and a page
 * left open on a poll whose live results were switched off afterwards must stop
 * writing. Returns whether it wrote, so nothing claims a republish that a
 * switched-off poll refused.
 */
export async function republishIfLive(
  sessionId: string,
  pollId: string,
): Promise<{ published: boolean; total: number }> {
  const poll = await getPoll(sessionId, pollId);
  if (!poll) return { published: false, total: 0 };
  if (!poll.liveResults) return { published: false, total: poll.actualVotes };

  const written = await publishTally(sessionId, pollId);
  return { published: true, total: written.total };
}
