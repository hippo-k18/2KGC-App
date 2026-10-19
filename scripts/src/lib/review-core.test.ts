import { describe, expect, it } from 'vitest';
import type { RubricCriterionDef } from '@kgc/shared';
import {
  DEFAULT_RUBRIC,
  authorVisibleToReviewer,
  checkReview,
  criterionId,
  otherReviewsVisible,
  overallOf,
  rankByTrack,
  reviewRefusal,
  tallyReviews,
  validateCriterion,
  type RawReview,
} from './review-core';

const rubric: RubricCriterionDef[] = [
  { id: 'relevance', label: 'Relevance', min: 1, max: 5, order: 0 },
  { id: 'rigour', label: 'Rigour', min: 0, max: 10, order: 1 },
];

const raw = (over: Partial<RawReview> = {}): RawReview => ({
  scores: { relevance: '5', rigour: '5' },
  comments: {},
  confidence: '',
  commentsToCommittee: '',
  commentsToAuthors: '',
  ...over,
});

describe('criteria', () => {
  it('slugs an id from the label and never reuses a taken one', () => {
    expect(criterionId('Technical Depth!', [])).toBe('technical-depth');
    expect(criterionId('Relevance', ['relevance', 'relevance-2'])).toBe('relevance-3');
    expect(criterionId('???', [])).toBe('criterion');
  });

  it('refuses a scale that is upside down, fractional, negative or too wide to render', () => {
    expect(validateCriterion({ label: 'Fit', min: 5, max: 1 }).ok).toBe(false);
    expect(validateCriterion({ label: 'Fit', min: 1, max: 1 }).ok).toBe(false);
    expect(validateCriterion({ label: 'Fit', min: 1.5, max: 5 }).ok).toBe(false);
    expect(validateCriterion({ label: 'Fit', min: -1, max: 5 }).ok).toBe(false);
    expect(validateCriterion({ label: 'Fit', min: 0, max: 100 }).ok).toBe(false);
    expect(validateCriterion({ label: 'F', min: 1, max: 5 }).ok).toBe(false);
  });

  it('accepts 1 to 5 and 0 to 10, and drops an empty description rather than storing it', () => {
    const a = validateCriterion({ label: ' Fit ', description: '  ', min: 1, max: 5 });
    expect(a).toEqual({ ok: true, criterion: { label: 'Fit', min: 1, max: 5 } });
    expect(validateCriterion({ label: 'Fit', min: 0, max: 10 }).ok).toBe(true);
  });

  it('ships a default rubric that passes its own validator', () => {
    for (const c of DEFAULT_RUBRIC) expect(validateCriterion(c).ok).toBe(true);
    expect(new Set(DEFAULT_RUBRIC.map((c) => c.id)).size).toBe(DEFAULT_RUBRIC.length);
  });
});

describe('one review', () => {
  it('weighs every criterion equally whatever its scale', () => {
    // Top of 1–5 and middle of 0–10: (10 + 5) / 2. A plain mean of 5 and 5
    // would call these the same score, which they are not.
    expect(overallOf(rubric, { relevance: 5, rigour: 5 })).toBe(7.5);
    expect(overallOf(rubric, { relevance: 1, rigour: 0 })).toBe(0);
    expect(overallOf(rubric, { relevance: 5, rigour: 10 })).toBe(10);
  });

  it('has no overall until every criterion is scored', () => {
    expect(overallOf(rubric, { relevance: 5 })).toBeUndefined();
    expect(overallOf([], {})).toBeUndefined();
  });

  it('requires every score to submit and none to save a draft', () => {
    const partial = raw({ scores: { relevance: '4', rigour: '' } });

    const finished = checkReview(rubric, partial, true);
    expect(finished.ok).toBe(false);
    if (!finished.ok) expect(Object.keys(finished.fieldErrors)).toEqual(['score_rigour']);

    const draft = checkReview(rubric, partial, false);
    expect(draft.ok).toBe(true);
    if (draft.ok) {
      expect(draft.review.scores).toEqual({ relevance: 4 });
      expect(draft.review.overall).toBeUndefined();
    }
  });

  it('refuses an out-of-range or fractional score even in a draft', () => {
    for (const bad of ['6', '0', '2.5', 'abc']) {
      const result = checkReview(rubric, raw({ scores: { relevance: bad, rigour: '5' } }), false);
      expect(result.ok, bad).toBe(false);
    }
  });

  it('ignores scores posted for criteria the call does not have', () => {
    const result = checkReview(rubric, raw({ scores: { relevance: '5', rigour: '10', invented: '99' } }), true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.review.scores).toEqual({ relevance: 5, rigour: 10 });
      expect(result.review.overall).toBe(10);
    }
  });

  it('keeps a remark per criterion and leaves out the empty ones', () => {
    const result = checkReview(rubric, raw({ comments: { relevance: ' On topic. ', rigour: '  ' } }), true);
    expect(result.ok && result.review.criterionComments).toEqual({ relevance: 'On topic.' });
  });

  it('bounds confidence to 1–5 and lets it be left out', () => {
    expect(checkReview(rubric, raw({ confidence: '6' }), true).ok).toBe(false);
    const ok = checkReview(rubric, raw({ confidence: '' }), true);
    expect(ok.ok && ok.review.confidence).toBeUndefined();
  });
});

describe('the tally kept on a submission', () => {
  it('means only submitted reviews, and counts assigned ones separately', () => {
    expect(
      tallyReviews([
        { status: 'submitted', conflict: false, overall: 8 },
        { status: 'submitted', conflict: false, overall: 5 },
        { status: 'assigned', conflict: false },
      ]),
    ).toEqual({ reviewsAssigned: 3, reviewsSubmitted: 2, scoreAverage: 6.5 });
  });

  it('drops a conflicted review completely, even one scored before the conflict', () => {
    expect(
      tallyReviews([
        { status: 'submitted', conflict: false, overall: 4 },
        { status: 'declined', conflict: true, overall: 10 },
      ]),
    ).toEqual({ reviewsAssigned: 1, reviewsSubmitted: 1, scoreAverage: 4 });
  });

  it('has no mean at all when nothing counts, rather than a zero', () => {
    const tally = tallyReviews([{ status: 'assigned', conflict: false }]);
    expect(tally).toEqual({ reviewsAssigned: 1, reviewsSubmitted: 0 });
    expect('scoreAverage' in tally).toBe(false);
  });
});

describe('ranking by track', () => {
  const row = (id: string, trackId: string | undefined, scoreAverage?: number, reviewsSubmitted = 1, status = 'under-review') => ({
    id,
    title: id,
    trackId,
    status,
    scoreAverage,
    reviewsSubmitted,
    reviewsAssigned: 3,
  });

  it('groups by track in the call’s order, best mean first, no-track last', () => {
    const out = rankByTrack(
      [row('a', 't2', 6), row('b', 't1', 7), row('c', 't1', 9), row('d', undefined, 10)],
      ['t1', 't2'],
    );
    expect(out.map((g) => g.trackId)).toEqual(['t1', 't2', undefined]);
    expect(out[0].rows.map((r) => [r.id, r.rank])).toEqual([
      ['c', 1],
      ['b', 2],
    ]);
  });

  it('shares a rank on a tie and skips the next one', () => {
    const [g] = rankByTrack([row('a', 't', 8), row('b', 't', 8), row('c', 't', 7)], ['t']);
    expect(g.rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('puts the better-reviewed of two equal means first', () => {
    const [g] = rankByTrack([row('one', 't', 8, 1), row('three', 't', 8, 3)], ['t']);
    expect(g.rows.map((r) => r.id)).toEqual(['three', 'one']);
  });

  it('keeps unscored submissions, last and unranked', () => {
    const [g] = rankByTrack([row('new', 't', undefined, 0), row('scored', 't', 2)], ['t']);
    expect(g.rows.map((r) => [r.id, r.rank])).toEqual([
      ['scored', 1],
      ['new', undefined],
    ]);
  });

  it('leaves out drafts and withdrawals, and keeps decided ones', () => {
    const [g] = rankByTrack(
      [row('d', 't', 9, 1, 'draft'), row('w', 't', 9, 1, 'withdrawn'), row('ok', 't', 5, 1, 'waitlisted')],
      ['t'],
    );
    expect(g.rows.map((r) => r.id)).toEqual(['ok']);
  });
});

describe('what a reviewer may see and do', () => {
  it('hides the author only under double-blind', () => {
    expect(authorVisibleToReviewer('open')).toBe(true);
    expect(authorVisibleToReviewer('single-blind')).toBe(true);
    expect(authorVisibleToReviewer('double-blind')).toBe(false);
  });

  it('shows other reviews only after the reviewer’s own is in, and never after a conflict', () => {
    expect(otherReviewsVisible({ status: 'assigned', conflict: false })).toBe(false);
    expect(otherReviewsVisible({ status: 'submitted', conflict: false })).toBe(true);
    expect(otherReviewsVisible({ status: 'submitted', conflict: true })).toBe(false);
    expect(otherReviewsVisible({ status: 'declined', conflict: true })).toBe(false);
  });

  it('closes reviewing once a decision, a withdrawal or a conflict stands', () => {
    const live = { status: 'assigned' as const, conflict: false };
    expect(reviewRefusal('under-review', live)).toBeNull();
    expect(reviewRefusal('submitted', live)).toBeNull();
    for (const s of ['accepted', 'rejected', 'waitlisted', 'withdrawn', 'draft']) {
      expect(reviewRefusal(s, live), s).not.toBeNull();
    }
    expect(reviewRefusal('under-review', { status: 'declined', conflict: true })).not.toBeNull();
  });
});
