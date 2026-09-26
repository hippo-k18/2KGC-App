import type { BlindReviewMode, ReviewStatus, RubricCriterionDef } from '@kgc/shared';

/**
 * The arithmetic and the rules of abstract review, with no Firestore in them.
 *
 * ── Why this is here and pure ───────────────────────────────────────────────
 *
 * The reviewer's page is on the website and the ranking is on the dashboard, and
 * neither app can import the other, so what they must agree on lives in this
 * package: what a valid score is, how an overall is worked out, what a mean over
 * a submission's reviews counts, and how much of an author a reviewer may see.
 * `reviews.ts` beside this file does the reads and writes; everything it decides
 * is decided here, where `npm test` can reach it without an emulator.
 *
 * No sentinels, nothing async, no store — the same posture as
 * `question-forms.ts`.
 */

// ---------------------------------------------------------------------------
// The criteria
// ---------------------------------------------------------------------------

/**
 * What a call is scored against until an organizer says otherwise.
 *
 * Offered on the dashboard as a one-press starting point rather than applied
 * silently: a call with no criteria has no scoring form, and the reviewers
 * screen says so.
 */
export const DEFAULT_RUBRIC: RubricCriterionDef[] = [
  {
    id: 'relevance',
    label: 'Relevance',
    description: 'How well it fits the conference and the track it was sent to.',
    min: 1,
    max: 5,
    order: 0,
  },
  {
    id: 'originality',
    label: 'Originality',
    description: 'Whether it says something the audience has not already heard.',
    min: 1,
    max: 5,
    order: 1,
  },
  {
    id: 'clarity',
    label: 'Clarity',
    description: 'Whether the abstract makes clear what the talk will deliver.',
    min: 1,
    max: 5,
    order: 2,
  },
];

/** The widest scale the form renders. Each point is one option in a select. */
export const MAX_SCALE_POINTS = 11;
export const MAX_CRITERIA = 12;

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/**
 * A new criterion's id: the label slugged, suffixed if that is taken.
 *
 * Assigned once and never regenerated — scores are stored under it, so a
 * reworded "Novelty" keeps every score it was already given. The same rule
 * `QuestionFieldDef.id` follows.
 */
export function criterionId(label: string, taken: readonly string[]): string {
  const base = slug(label) || 'criterion';
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export type CriterionResult =
  | { ok: true; criterion: Omit<RubricCriterionDef, 'id' | 'order'> }
  | { ok: false; error: string };

/** One criterion as typed on the dashboard, checked. */
export function validateCriterion(input: {
  label: string;
  description?: string;
  min: number;
  max: number;
}): CriterionResult {
  const label = input.label.trim();
  const description = input.description?.trim() ?? '';

  if (label.length < 2) return { ok: false, error: 'Give the criterion a name.' };
  if (label.length > 80) return { ok: false, error: 'Keep the name under 80 characters.' };
  if (description.length > 300) return { ok: false, error: 'Keep the description under 300 characters.' };
  if (!Number.isInteger(input.min) || !Number.isInteger(input.max)) {
    return { ok: false, error: 'The lowest and highest score must be whole numbers.' };
  }
  if (input.min < 0) return { ok: false, error: 'The lowest score cannot be below 0.' };
  if (input.max <= input.min) return { ok: false, error: 'The highest score must be above the lowest.' };
  if (input.max - input.min + 1 > MAX_SCALE_POINTS) {
    return { ok: false, error: `A scale can have at most ${MAX_SCALE_POINTS} points.` };
  }

  return {
    ok: true,
    criterion: { label, ...(description ? { description } : {}), min: input.min, max: input.max },
  };
}

/** The criteria in the order a reviewer is asked them. */
export const orderedRubric = (rubric: readonly RubricCriterionDef[]): RubricCriterionDef[] =>
  [...rubric].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

// ---------------------------------------------------------------------------
// One review
// ---------------------------------------------------------------------------

export const MAX_COMMENT = 4000;
export const MAX_CRITERION_COMMENT = 1000;

/** What the reviewer's form posted, before anything has been trusted. */
export interface RawReview {
  /** Keyed by criterion id. An empty string is "not scored". */
  scores: Record<string, string>;
  comments: Record<string, string>;
  confidence: string;
  commentsToCommittee: string;
  commentsToAuthors: string;
}

export interface CheckedReview {
  scores: Record<string, number>;
  criterionComments: Record<string, string>;
  confidence?: number;
  commentsToCommittee: string;
  commentsToAuthors: string;
  /** Present only when every criterion has a score. */
  overall?: number;
}

export type ReviewCheck =
  | { ok: true; review: CheckedReview }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

/**
 * Check one review against the criteria in force.
 *
 * `finish` is the difference between saving a draft and submitting: a draft may
 * leave criteria unscored, a submitted review may not. A score that is present
 * is checked either way — a draft holding a 9 on a 1 to 5 scale would become a
 * submitted 9 the moment the rest was filled in.
 *
 * Scores for criteria the call no longer has are dropped, not kept: the overall
 * is a mean over the current criteria, and a number nobody can see on the form
 * must not move it.
 */
export function checkReview(
  rubric: readonly RubricCriterionDef[],
  raw: RawReview,
  finish: boolean,
): ReviewCheck {
  const fieldErrors: Record<string, string> = {};
  const scores: Record<string, number> = {};
  const criterionComments: Record<string, string> = {};

  for (const c of rubric) {
    const given = (raw.scores[c.id] ?? '').trim();
    if (given === '') {
      if (finish) fieldErrors[`score_${c.id}`] = 'Choose a score.';
    } else {
      const n = Number(given);
      if (!Number.isInteger(n) || n < c.min || n > c.max) {
        fieldErrors[`score_${c.id}`] = `Choose a score from ${c.min} to ${c.max}.`;
      } else {
        scores[c.id] = n;
      }
    }

    const remark = (raw.comments[c.id] ?? '').trim();
    if (remark.length > MAX_CRITERION_COMMENT) {
      fieldErrors[`comment_${c.id}`] = `Keep this under ${MAX_CRITERION_COMMENT} characters.`;
    } else if (remark) {
      criterionComments[c.id] = remark;
    }
  }

  let confidence: number | undefined;
  const conf = raw.confidence.trim();
  if (conf !== '') {
    const n = Number(conf);
    if (!Number.isInteger(n) || n < 1 || n > 5) fieldErrors.confidence = 'Choose from 1 to 5.';
    else confidence = n;
  }

  const commentsToCommittee = raw.commentsToCommittee.trim();
  const commentsToAuthors = raw.commentsToAuthors.trim();
  if (commentsToCommittee.length > MAX_COMMENT) {
    fieldErrors.commentsToCommittee = `Keep this under ${MAX_COMMENT} characters.`;
  }
  if (commentsToAuthors.length > MAX_COMMENT) {
    fieldErrors.commentsToAuthors = `Keep this under ${MAX_COMMENT} characters.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      error: finish
        ? 'Some scores are missing or out of range. Nothing has been saved.'
        : 'Something below is out of range. Nothing has been saved.',
      fieldErrors,
    };
  }

  return {
    ok: true,
    review: {
      scores,
      criterionComments,
      confidence,
      commentsToCommittee,
      commentsToAuthors,
      overall: overallOf(rubric, scores),
    },
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One review's overall: the mean of its scores, each first placed on a 0 to 10
 * scale.
 *
 * Criteria are allowed different scales, and a plain mean of a 1 to 5 and a
 * 0 to 10 lets the wider one decide the result. Rescaling first makes every
 * criterion count the same, and makes overalls comparable across two calls with
 * different criteria. Undefined unless every criterion has a score.
 */
export function overallOf(
  rubric: readonly RubricCriterionDef[],
  scores: Readonly<Record<string, number>>,
): number | undefined {
  if (rubric.length === 0) return undefined;
  let sum = 0;
  for (const c of rubric) {
    const s = scores[c.id];
    if (typeof s !== 'number') return undefined;
    sum += ((s - c.min) / (c.max - c.min)) * 10;
  }
  return round2(sum / rubric.length);
}

/** The top of the scale every overall and mean is on. */
export const OVERALL_MAX = 10;

// ---------------------------------------------------------------------------
// One submission's reviews, added up
// ---------------------------------------------------------------------------

export interface ReviewForTally {
  status: ReviewStatus;
  conflict: boolean;
  overall?: number;
}

export interface ReviewTally {
  /** Reviewers who still hold this submission. A declared conflict does not. */
  reviewsAssigned: number;
  /** Reviews that count toward the mean. */
  reviewsSubmitted: number;
  /** Absent until one review counts. */
  scoreAverage?: number;
}

/**
 * The three numbers kept on the submission.
 *
 * Recounted from every review each time one changes, rather than incremented:
 * a reviewer can submit, then declare a conflict, then be excluded by an
 * organizer, and a counter that was nudged up and down through that is a
 * counter that drifts. A conflicted or excluded review counts for nothing, even
 * if scores were entered before the conflict was declared.
 */
export function tallyReviews(reviews: readonly ReviewForTally[]): ReviewTally {
  const live = reviews.filter((r) => r.status !== 'declined' && !r.conflict);
  const scored = live.filter((r) => r.status === 'submitted' && typeof r.overall === 'number');
  const tally: ReviewTally = { reviewsAssigned: live.length, reviewsSubmitted: scored.length };
  if (scored.length > 0) {
    tally.scoreAverage = round2(scored.reduce((n, r) => n + (r.overall as number), 0) / scored.length);
  }
  return tally;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface RankInput {
  id: string;
  title: string;
  trackId?: string;
  status: string;
  scoreAverage?: number;
  reviewsSubmitted: number;
  reviewsAssigned: number;
}

export interface RankedRow extends RankInput {
  /** 1 is best. Absent when nothing has been scored yet. Ties share a rank. */
  rank?: number;
}

export interface TrackRanking {
  /** Absent for submissions that chose no track. */
  trackId?: string;
  rows: RankedRow[];
}

/**
 * Submissions grouped by track, best mean first.
 *
 * Drafts and withdrawals are left out: neither is being judged. Unscored
 * submissions stay in, last and unranked, because a ranking that hid them would
 * read as "everything has been reviewed". Ties share a rank and the next rank
 * skips, the way a results table does. Among equals, more reviews comes first,
 * since a 8.0 from three people is firmer than a 8.0 from one.
 *
 * Tracks come back in `trackOrder`; the no-track group is last.
 */
export function rankByTrack(rows: readonly RankInput[], trackOrder: readonly string[]): TrackRanking[] {
  const groups = new Map<string, RankInput[]>();
  for (const r of rows) {
    if (r.status === 'draft' || r.status === 'withdrawn') continue;
    const key = r.trackId ?? '';
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const position = (id: string) => {
    if (id === '') return Number.MAX_SAFE_INTEGER;
    const i = trackOrder.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };

  return [...groups.entries()]
    .sort(([a], [b]) => position(a) - position(b) || a.localeCompare(b))
    .map(([trackId, members]) => {
      const sorted = [...members].sort(
        (a, b) =>
          (b.scoreAverage ?? -1) - (a.scoreAverage ?? -1) ||
          b.reviewsSubmitted - a.reviewsSubmitted ||
          a.title.localeCompare(b.title),
      );

      const ranked: RankedRow[] = [];
      sorted.forEach((row, i) => {
        if (row.scoreAverage === undefined) {
          ranked.push({ ...row });
          return;
        }
        const prev = ranked[i - 1];
        const rank = prev && prev.scoreAverage === row.scoreAverage ? prev.rank : i + 1;
        ranked.push({ ...row, rank });
      });

      return { trackId: trackId || undefined, rows: ranked };
    });
}

// ---------------------------------------------------------------------------
// What a reviewer may see
// ---------------------------------------------------------------------------

/**
 * Whether a reviewer is shown who wrote it.
 *
 * Only `double-blind` hides the author. This decides whether the identity
 * document is *read at all* for the reviewer's page: the name is not loaded and
 * then hidden, it is never fetched.
 */
export const authorVisibleToReviewer = (mode: BlindReviewMode): boolean => mode !== 'double-blind';

/**
 * Whether a reviewer is shown what the other reviewers said.
 *
 * Not until their own review is in, so nobody scores toward somebody else's
 * number. Never for a reviewer who has left the submission.
 */
export const otherReviewsVisible = (own: { status: ReviewStatus; conflict: boolean }): boolean =>
  own.status === 'submitted' && !own.conflict;

/**
 * Whether a review can still be written.
 *
 * It closes when the committee decides: a score that changes after the decision
 * it informed is a record that no longer explains the decision.
 */
export function reviewRefusal(submissionStatus: string, own: { status: ReviewStatus; conflict: boolean }): string | null {
  if (own.status === 'declined' || own.conflict) return 'You are no longer reviewing this submission.';
  if (submissionStatus === 'withdrawn') return 'The author withdrew this submission.';
  if (submissionStatus === 'draft') return 'The author has taken this back to a draft.';
  if (submissionStatus === 'accepted' || submissionStatus === 'rejected' || submissionStatus === 'waitlisted') {
    return 'The committee has decided on this submission, so reviews are closed.';
  }
  return null;
}
