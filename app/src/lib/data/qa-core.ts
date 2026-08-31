import type { PollDoc, PollVoteDoc, SessionQuestionDoc, WithId } from '@kgc/shared';

/**
 * The two decisions in the Q&A and polling path that are pure, and the two that
 * are worth pinning: how the question list is ordered, and when a poll's stored
 * tally may be shown at all.
 *
 * They live here rather than in `qa.ts` for the reason `apps/organizer`'s
 * `conflicts-core.ts` sits beside `conflicts.ts` — the hooks module reaches
 * Firestore and `expo-router`, neither of which loads under Vitest, so logic
 * worth testing has to live beside the fetch rather than inside it. `qa.ts`
 * re-exports everything below, so screens still import from one place.
 */

export type Question = WithId<SessionQuestionDoc>;
export type Poll = WithId<PollDoc>;
export type Vote = WithId<PollVoteDoc>;

/**
 * The upvote number to show for a question, from the same expression that ranks
 * it, so the list can never be ordered by one number while displaying another.
 *
 * `undefined` means not counted yet and must render as "—" rather than as a
 * zero. The stored field is *not* used as a fallback: it is frozen at zero, so
 * falling back to it would mix true counts and zeros in one ordering and put a
 * question with nine upvotes below one with none for as long as the count took.
 */
export function upvoteScore(q: Question, counts: Record<string, number> | null) {
  return counts?.[q.id];
}

/** The one comparator. `qa.ts` uses it for the pre-count order too. */
export function compareQuestions(counts: Record<string, number> | null) {
  return (a: Question, b: Question) =>
    (upvoteScore(b, counts) ?? 0) - (upvoteScore(a, counts) ?? 0) ||
    (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0) ||
    a.id.localeCompare(b.id);
}

/**
 * Ranks the Q&A list.
 *
 * ── The ordering guarantee ──────────────────────────────────────────────────
 *
 * Most upvotes first; ties broken by age, oldest first; ties in *that* broken by
 * document id. The last clause is what makes the order **total** — with two
 * questions on equal upvotes asked in the same second, a comparator returning 0
 * leaves the order to whatever `Array.prototype.sort` and the snapshot happened
 * to produce, which is not the same on two phones and not the same twice on one.
 * The guarantee is therefore: *every device holding the same questions and the
 * same counts renders them in the same order, and re-renders do not reshuffle
 * them.*
 *
 * The order changes only when a count changes — an upvote the reader casts, or a
 * recount when the screen regains focus. It does not change when an unrelated
 * question is edited or approved, because those move no count. A question the
 * reader upvotes may move up under their finger; that is the ranking working,
 * it is what Slido and Whova both do, and the alternative (freezing the order
 * until the screen is reopened) makes the reader's own vote look ignored.
 *
 * Before any count arrives, `counts` is `null` and every question scores 0, so
 * the list is in ask order and the screen shows "—" rather than a number. That
 * is one re-rank on load and it is the honest one: the alternative is ordering
 * by a stored field that is uniformly zero, which is the same ask order wearing
 * a number that claims to be a tally.
 *
 * Sorts a copy. The array belongs to `useCollection`'s snapshot handler, and
 * sorting it in place mutates state React has already handed out.
 */
export function rankQuestions(
  questions: Question[],
  counts: Record<string, number> | null,
): Question[] {
  return [...questions].sort(compareQuestions(counts));
}

/**
 * How much of a poll's stored `tallies` / `totalVotes` may be shown.
 *
 * ── The number on the stage and the number in the back row ──────────────────
 *
 * `tallies` and `totalVotes` are written by the `tallyPoll` task, which is a
 * Cloud Function and is not deployed, so they hold whatever the seed wrote and
 * never move — while the ballots themselves land correctly, one document per
 * voter, in the `votes` subcollection. The organizer dashboard therefore refuses
 * to read `totalVotes` at all and counts the vote documents instead
 * (`apps/organizer/src/lib/polls.ts`), so it shows the true number; this screen
 * read the frozen field and showed a different one. Same poll, two audiences,
 * two answers.
 *
 * **The app cannot close that gap by counting, and must not try.** A ballot is
 * secret: `firestore.rules` allows a `votes` document to be read only by the
 * voter or an organizer, so a list or `count()` over the subcollection is denied
 * outright — verified against the emulator, and `tests/rules/firestore.test.ts`
 * ("keeps a ballot secret from other attendees") pins it. The dashboard gets the
 * real count because it uses the Admin SDK and bypasses rules. An attendee's
 * count would fail in production while passing every local run, and the poll
 * would render as though nobody had voted. That is why this is a staleness test
 * rather than a copy of the dashboard's aggregation.
 *
 * So the app shows a number only when it can prove that number is not behind:
 *
 * - `talliesUpdatedAt` is written *only* by `tallyPoll`. Absent, the task has
 *   never run for this poll and the zeros are seed values, not results.
 * - Otherwise the reader's own ballot dates the tally. Results are shown only
 *   after you have voted, so there is always a ballot to compare against, and a
 *   tally older than it provably excludes at least one vote — your own.
 *
 * What is left is a lag of at most one tally run once the task is deployed,
 * which is the same window the dashboard has between two page loads. What is
 * gone is the case where the two disagree permanently.
 */
export type TallyState = 'current' | 'lagging' | 'never-counted';

export function tallyState(poll: Poll, myVote: Vote | null | undefined): TallyState {
  if (!poll.talliesUpdatedAt) return 'never-counted';
  // A `serverTimestamp()` reads back as null in the local echo of your own
  // write, before the server confirms it. Unresolved means "just now", which is
  // newer than any tally.
  const votedAt = myVote ? (myVote.createdAt?.toMillis?.() ?? Infinity) : 0;
  const talliedAt = poll.talliesUpdatedAt.toMillis?.() ?? 0;
  return talliedAt >= votedAt ? 'current' : 'lagging';
}
