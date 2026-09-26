import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, type TrackDoc } from '@kgc/shared';
import { readReviewerToken } from '@kgc/scripts/src/lib/reviewer-token';
import {
  loadAssignment,
  loadQueue,
  loadReviewer,
  markReviewerActive,
  saveReview,
  withdrawReviewer,
  type Assignment,
  type QueueItem,
  type ReviewWrite,
  type ReviewerIdentity,
} from '@kgc/scripts/src/lib/reviews';
import type { RawReview } from '@kgc/scripts/src/lib/review-core';
import { db } from './firestore';

/**
 * The reviewer's side of a call, for somebody with a link and no account.
 *
 * Thin on purpose. What a reviewer may read and write is decided in
 * `@kgc/scripts/src/lib/reviews.ts`, which the dashboard shares; this file adds
 * the two things only this app can supply — the store, and a `FieldValue.delete()`
 * built by the copy of `firebase-admin` that owns it (AGENTS.md gotcha 8).
 *
 * ── Every function starts from the token ───────────────────────────────────
 *
 * A server action is a public endpoint, so nothing here takes a reviewer id.
 * `reviewerFor` turns the token into one, or into null, and a null is a 404 on a
 * page and a refusal in an action, with no hint about which check failed.
 */

const ops = () => ({ deleteField: FieldValue.delete() });

export async function reviewerFor(token: string): Promise<ReviewerIdentity | null> {
  const payload = readReviewerToken(token);
  if (!payload) return null;
  try {
    return await loadReviewer(db(), payload.rvid, payload.iat);
  } catch (err) {
    console.error('[reviews] could not load reviewer', err);
    return null;
  }
}

export async function queueFor(
  reviewer: ReviewerIdentity,
): Promise<{ items: QueueItem[]; trackName: Map<string, string> }> {
  // Opening the page is the acceptance. Best effort: a failure here must not
  // cost the reviewer their queue.
  await markReviewerActive(db(), reviewer.id).catch((err) =>
    console.error('[reviews] could not mark reviewer active', err),
  );
  const items = await loadQueue(db(), reviewer.id);
  return { items, trackName: await trackNames(items.map((i) => i.trackId)) };
}

export async function assignmentFor(
  reviewer: ReviewerIdentity,
  submissionId: string,
): Promise<(Assignment & { trackName?: string }) | null> {
  try {
    const a = await loadAssignment(db(), reviewer.id, submissionId);
    if (!a) return null;
    const names = await trackNames([a.trackId]);
    return { ...a, trackName: a.trackId ? names.get(a.trackId) : undefined };
  } catch (err) {
    console.error('[reviews] could not load assignment', submissionId, err);
    return null;
  }
}

export async function submitReview(
  token: string,
  submissionId: string,
  raw: RawReview,
  finish: boolean,
): Promise<ReviewWrite> {
  const reviewer = await reviewerFor(token);
  if (!reviewer) return { ok: false, error: 'That link is not valid any more. Ask the organizers for a new one.' };
  try {
    return await saveReview(db(), ops(), { reviewerId: reviewer.id, submissionId, raw, finish });
  } catch (err) {
    console.error('[reviews] could not save review', submissionId, err);
    return { ok: false, error: 'That did not save. Nothing has changed. Try again in a moment.' };
  }
}

export async function declareConflict(token: string, submissionId: string, note: string): Promise<boolean> {
  const reviewer = await reviewerFor(token);
  if (!reviewer) return false;
  try {
    const result = await withdrawReviewer(db(), ops(), { reviewerId: reviewer.id, submissionId, note });
    return result.ok;
  } catch (err) {
    console.error('[reviews] could not declare conflict', submissionId, err);
    return false;
  }
}

async function trackNames(ids: (string | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return out;
  try {
    const docs = await db().getAll(...wanted.map((id) => db().collection(COLLECTIONS.tracks).doc(id)));
    for (const d of docs) if (d.exists) out.set(d.id, (d.data() as TrackDoc).name);
  } catch (err) {
    console.error('[reviews] could not load tracks', err);
  }
  return out;
}
