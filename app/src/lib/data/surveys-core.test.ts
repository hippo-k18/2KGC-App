import { describe, expect, it } from 'vitest';

import type { Timestamp } from '@kgc/shared';

import {
  answeredCount,
  decodeMulti,
  encodeMulti,
  isOpen,
  missingRequired,
  MULTI_SEPARATOR,
  prune,
  type Survey,
} from '@/lib/data/surveys-core';

/**
 * The four survey decisions that are wrong in ways no type catches: a schedule
 * that reads as closed when the console never set one, a required question that
 * passes because its answer is the number zero, and a multi-select encoding that
 * disagrees with the arithmetic the organizer's dashboard does on the other end.
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

function survey(over: Partial<Survey> = {}): Survey {
  return {
    id: 'sv1',
    eventId: 'kgc-2027',
    createdAt: ts(0),
    updatedAt: ts(0),
    title: 'Opening session — your feedback',
    status: 'published',
    responseCount: 0,
    questions: [
      { id: 'q1', prompt: 'How useful?', kind: 'rating', required: false },
      { id: 'q2', prompt: 'Recommend it?', kind: 'single', options: ['Yes', 'Maybe', 'No'], required: false },
      { id: 'q3', prompt: 'Anything else?', kind: 'text', required: false },
    ],
    ...over,
  } as Survey;
}

const NOW = new Date('2027-05-04T12:00:00Z');

describe('isOpen', () => {
  it('treats a published survey with no window at all as open', () => {
    // The console's form writes neither `opensAt` nor `closesAt`, so this is
    // every survey that exists today. Reading a missing bound as "closed" would
    // have shut the whole feature the day it shipped.
    expect(isOpen(survey(), NOW)).toBe(true);
  });

  it('refuses a draft even inside its window', () => {
    // Belt and braces: the rules never serve a draft, so this branch only fires
    // if something upstream changes. It is the cheaper of the two guards.
    expect(isOpen(survey({ status: 'draft' }), NOW)).toBe(false);
  });

  it('is closed before it opens and after it closes, and open in between', () => {
    const scheduled = survey({
      opensAt: ts(Date.parse('2027-05-04T09:00:00Z')),
      closesAt: ts(Date.parse('2027-05-04T17:00:00Z')),
    });
    expect(isOpen(scheduled, new Date('2027-05-04T08:59:00Z'))).toBe(false);
    expect(isOpen(scheduled, NOW)).toBe(true);
    expect(isOpen(scheduled, new Date('2027-05-04T17:00:00Z'))).toBe(false);
  });

  it('honours one bound without the other', () => {
    expect(isOpen(survey({ opensAt: ts(Date.parse('2027-05-05T00:00:00Z')) }), NOW)).toBe(false);
    expect(isOpen(survey({ closesAt: ts(Date.parse('2027-05-05T00:00:00Z')) }), NOW)).toBe(true);
  });
});

describe('missingRequired', () => {
  it('names only the required questions that have no answer', () => {
    const s = survey({
      questions: [
        { id: 'q1', prompt: 'How useful?', kind: 'rating', required: true },
        { id: 'q2', prompt: 'Anything else?', kind: 'text', required: false },
      ],
    });
    expect(missingRequired(s, {})).toEqual(['q1']);
    expect(missingRequired(s, { q1: 4 })).toEqual([]);
  });

  it('counts a whitespace-only comment as unanswered', () => {
    // A required text box that has been tapped and left blank holds `''`, and
    // submitting it stores an answer the console then counts as given.
    const s = survey({
      questions: [{ id: 'q1', prompt: 'Why?', kind: 'text', required: true }],
    });
    expect(missingRequired(s, { q1: '   ' })).toEqual(['q1']);
    expect(missingRequired(s, { q1: 'because' })).toEqual([]);
  });

  it('does not treat the number zero as unanswered', () => {
    // No scale here starts at zero, but a falsy-number check is the bug this
    // shape invites and it would silently block submission.
    const s = survey({
      questions: [{ id: 'q1', prompt: 'How many?', kind: 'rating', required: true }],
    });
    expect(missingRequired(s, { q1: 0 })).toEqual([]);
  });
});

describe('answeredCount', () => {
  it('counts only questions carrying a real answer', () => {
    expect(answeredCount(survey(), {})).toBe(0);
    expect(answeredCount(survey(), { q1: 5, q3: '' })).toBe(1);
    expect(answeredCount(survey(), { q1: 5, q2: 'Yes', q3: 'more time' })).toBe(3);
  });
});

describe('the multi-select encoding', () => {
  it('joins with the separator the console splits on', () => {
    // `apps/organizer/src/lib/surveys.ts` splits stored answers on `;` and trims
    // each part, then matches the parts against the survey's own option labels.
    // Any other separator turns every multi answer into one unrecognised option
    // and shows the organizer a table of zeros.
    expect(MULTI_SEPARATOR).toBe('; ');
    expect(encodeMulti(['A', 'B', 'C'], new Set(['A', 'C']))).toBe('A; C');
  });

  it('orders by the survey, not by the order they were tapped', () => {
    // Two people who chose the same pair must store the same string, or the
    // distribution counts them as two different answers.
    const options = ['Yes', 'Maybe', 'No'];
    expect(encodeMulti(options, new Set(['No', 'Yes']))).toBe(
      encodeMulti(options, new Set(['Yes', 'No'])),
    );
  });

  it('round-trips', () => {
    expect(decodeMulti(encodeMulti(['A', 'B', 'C'], new Set(['A', 'C'])))).toEqual(['A', 'C']);
    expect(decodeMulti('')).toEqual([]);
    expect(decodeMulti(undefined)).toEqual([]);
    // A rating stored as a number is not a multi answer and must not decode as
    // the string "4" — it reaches here only through a mis-typed question.
    expect(decodeMulti(4)).toEqual([]);
  });
});

describe('prune', () => {
  it('drops answers to questions the survey does not have', () => {
    // Writing a key that matches no question puts a column in the organizer's
    // aggregate with no prompt above it.
    expect(prune(survey(), { q1: 5, q9: 'orphan' })).toEqual({ q1: 5 });
  });
});
