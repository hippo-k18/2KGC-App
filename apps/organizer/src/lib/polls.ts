import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  type PollDoc,
  type SessionDoc,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * Engagement › Live Polling.
 *
 * ── The whole point of this file is one subtraction ─────────────────────────
 *
 * `PollDoc.tallies` and `PollDoc.totalVotes` are written by the `tallyPoll`
 * task, which is a Cloud Function trigger, and this project is on the Spark
 * plan, so it has never run. Those two fields therefore hold whatever the seed
 * wrote and **never move**, while the votes themselves land correctly one
 * document per voter in the `votes` subcollection.
 *
 * A polling screen that read `totalVotes` would show a number that is confidently
 * wrong on stage. So this counts the vote documents instead and returns both
 * numbers, and the screen shows the difference. AGENTS.md names "the app claims
 * capabilities it does not have" as this codebase's recurring defect class;
 * printing a frozen tally next to a live audience is exactly that defect.
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

export interface PollRow {
  id: string;
  sessionId: string;
  sessionTitle: string;
  sessionDay: string;
  startsAtLocal: string;
  question: string;
  optionCount: number;
  open: boolean;
  /** `PollDoc.totalVotes` as stored — trigger-owned, and therefore frozen. */
  storedTotal: number;
  /** Vote documents actually present. This is the true number. */
  actualVotes: number;
  /** True when the stored tally disagrees with the votes on disk. */
  stale: boolean;
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
}

function iso(t: { toDate(): Date } | undefined): string {
  try {
    return t?.toDate().toISOString() ?? '';
  } catch {
    return '';
  }
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
          // One read per poll for the vote count. At conference volumes that is
          // a handful of queries; a `count()` aggregation would be cheaper and
          // is the obvious change if a keynote ever carries twenty polls.
          const voteSnap = await p.ref.collection(SUBCOLLECTIONS.votes).get();
          const stored = poll.totalVotes ?? 0;

          polls.push({
            id: p.id,
            sessionId: d.id,
            sessionTitle: s.title,
            sessionDay: s.day,
            startsAtLocal: s.startsAtLocal,
            question: poll.question,
            optionCount: (poll.options ?? []).length,
            open: Boolean(poll.open),
            storedTotal: stored,
            actualVotes: voteSnap.size,
            stale: stored !== voteSnap.size,
            createdAt: iso(poll.createdAt),
          });
        }),
      );
    }),
  );

  polls.sort(
    (a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal) || a.question.localeCompare(b.question),
  );

  return {
    polls,
    enabledSessions,
    liveSessions: live.length,
    votesCast: polls.reduce((n, p) => n + p.actualVotes, 0),
    votesShownByTallies: polls.reduce((n, p) => n + p.storedTotal, 0),
  };
}
