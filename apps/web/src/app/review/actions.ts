'use server';

import { redirect } from 'next/navigation';
import type { RawReview } from '@kgc/scripts/src/lib/review-core';
import { declareConflict, submitReview } from '@/lib/reviews';

export interface ReviewState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Saving scores, and declaring a conflict.
 *
 * ── Who is writing comes out of the HMAC ───────────────────────────────────
 *
 * Never out of a form field, for the reason `submit/actions.ts` gives. The
 * token is re-read here from scratch, because the page having verified it says
 * nothing about who invoked this. The submission id *is* a form field, and that
 * is safe only because `saveReview` looks for this reviewer's own review
 * document under it before doing anything: an id typed by hand finds none.
 */
export async function reviewAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const token = String(formData.get('token') ?? '');
  const submissionId = String(formData.get('submissionId') ?? '');
  const finish = String(formData.get('finish') ?? '') === '1';

  const raw: RawReview = {
    scores: prefixed(formData, 'score_'),
    comments: prefixed(formData, 'comment_'),
    confidence: String(formData.get('confidence') ?? ''),
    commentsToCommittee: String(formData.get('commentsToCommittee') ?? ''),
    commentsToAuthors: String(formData.get('commentsToAuthors') ?? ''),
  };

  const result = await submitReview(token, submissionId, raw, finish);
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

  redirect(
    `/review/${encodeURIComponent(token)}/${encodeURIComponent(submissionId)}?r=${
      result.status === 'submitted' ? 'submitted' : 'saved'
    }`,
  );
}

export async function conflictAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const submissionId = String(formData.get('submissionId') ?? '');
  const ok = await declareConflict(token, submissionId, String(formData.get('note') ?? ''));
  redirect(`/review/${encodeURIComponent(token)}?r=${ok ? 'conflict' : 'error'}`);
}

/** Every value whose field name starts with `prefix`, keyed by the rest of it. */
function prefixed(formData: FormData, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = String(formData.get(key) ?? '');
  }
  return out;
}
