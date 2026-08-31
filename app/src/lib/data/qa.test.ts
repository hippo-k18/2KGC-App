import { describe, expect, it } from 'vitest';

import type { Timestamp } from '@kgc/shared';

import {
  rankQuestions,
  tallyState,
  type Poll,
  type Question,
  type Vote,
} from '@/lib/data/qa-core';

/**
 * The two pure decisions in the Q&A and polling path, both of which are wrong in
 * a way no type can catch: an ordering that is not total reshuffles a live Q&A
 * board between renders, and a tally shown at the wrong moment puts a different
 * number in front of the room than the one on the organizer's screen.
 */

/** A `firebase/firestore` `Timestamp` is structurally this — see `@kgc/shared`. */
function ts(ms: number): Timestamp {
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1e6,
    toDate: () => new Date(ms),
    toMillis: () => ms,
    isEqual: (other: Timestamp) => other.toMillis() === ms,
  };
}

function question(id: string, askedAtSeconds: number, upvoteCount = 0): Question {
  return {
    id,
    eventId: 'kgc-2027',
    authorId: 'demo_000',
    body: id,
    upvoteCount,
    state: 'approved',
    answered: false,
    createdAt: ts(askedAtSeconds * 1000),
  };
}

describe('rankQuestions', () => {
  const first = question('q-first', 100);
  const second = question('q-second', 200);
  const third = question('q-third', 300);
  const asked = [first, second, third];

  it('ranks by counted upvotes, most first', () => {
    const ranked = rankQuestions(asked, { 'q-first': 1, 'q-second': 9, 'q-third': 4 });
    expect(ranked.map((q) => q.id)).toEqual(['q-second', 'q-third', 'q-first']);
  });

  it('falls back to ask order while nothing has been counted', () => {
    // Not to `upvoteCount`, which is frozen: a question seeded with 40 upvotes
    // must not outrank one with a real, counted 2.
    const stale = [question('q-seeded', 300, 40), question('q-live', 100, 0)];
    expect(rankQuestions(stale, null).map((q) => q.id)).toEqual(['q-live', 'q-seeded']);
    expect(rankQuestions(stale, { 'q-live': 2 }).map((q) => q.id)).toEqual([
      'q-live',
      'q-seeded',
    ]);
  });

  it('breaks a tie on upvotes by age, oldest first', () => {
    const counts = { 'q-first': 3, 'q-second': 3, 'q-third': 3 };
    expect(rankQuestions(asked, counts).map((q) => q.id)).toEqual([
      'q-first',
      'q-second',
      'q-third',
    ]);
  });

  it('is a total order, so two devices agree', () => {
    // Same second, same count — the case a comparator returning 0 leaves to the
    // engine, which is why the id is the last clause.
    const sameSecond = [question('b', 100), question('a', 100), question('c', 100)];
    const counts = { a: 2, b: 2, c: 2 };
    const forwards = rankQuestions(sameSecond, counts).map((q) => q.id);
    const backwards = rankQuestions([...sameSecond].reverse(), counts).map((q) => q.id);
    expect(forwards).toEqual(['a', 'b', 'c']);
    expect(backwards).toEqual(forwards);
  });

  it('leaves the caller’s array alone', () => {
    const input = [third, first, second];
    rankQuestions(input, { 'q-first': 5 });
    expect(input.map((q) => q.id)).toEqual(['q-third', 'q-first', 'q-second']);
  });

  it('scores an uncounted question as zero rather than dropping it', () => {
    const ranked = rankQuestions(asked, { 'q-third': 1 });
    expect(ranked.map((q) => q.id)).toEqual(['q-third', 'q-first', 'q-second']);
  });
});

describe('tallyState', () => {
  const poll = (talliesUpdatedAt?: Timestamp): Poll => ({
    id: 'p1',
    eventId: 'kgc-2027',
    question: 'Ready?',
    options: [{ id: 'a', label: 'Yes' }],
    tallies: { a: 0 },
    totalVotes: 0,
    open: true,
    createdAt: ts(0),
    ...(talliesUpdatedAt ? { talliesUpdatedAt } : {}),
  });

  const ballot = (createdAt?: Timestamp): Vote =>
    ({ id: 'demo_000', uid: 'demo_000', optionIds: ['a'], createdAt }) as Vote;

  it('is never-counted when nothing has ever tallied the poll', () => {
    // `talliesUpdatedAt` is written only by `tallyPoll`. Absent, the zeros in
    // `tallies` are seed values and not a result.
    expect(tallyState(poll(), ballot(ts(1000)))).toBe('never-counted');
    expect(tallyState(poll(), null)).toBe('never-counted');
  });

  it('is current when the tally is at least as new as your ballot', () => {
    expect(tallyState(poll(ts(5000)), ballot(ts(4000)))).toBe('current');
    expect(tallyState(poll(ts(4000)), ballot(ts(4000)))).toBe('current');
  });

  it('is lagging when the tally predates your ballot', () => {
    // It provably excludes at least one vote — the reader's own.
    expect(tallyState(poll(ts(3000)), ballot(ts(4000)))).toBe('lagging');
  });

  it('is lagging while your own write is still unresolved', () => {
    // `serverTimestamp()` reads back null in the local echo of your own write.
    expect(tallyState(poll(ts(5000)), ballot(undefined))).toBe('lagging');
  });
});
