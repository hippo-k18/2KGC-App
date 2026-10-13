import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type CallDoc, type RubricCriterionDef } from '@kgc/shared';
import {
  DEFAULT_RUBRIC,
  MAX_CRITERIA,
  criterionId,
  orderedRubric,
  validateCriterion,
} from '@kgc/scripts/src/lib/review-core';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * The scoring criteria on a call: what reviewers mark each submission against.
 *
 * `CallDoc.rubric` is read by the reviewer's page on the website every time it
 * renders and by `saveReview` inside the transaction that accepts a score, so a
 * change here reaches a reviewer on their next page load.
 *
 * ── Editing after scores exist ─────────────────────────────────────────────
 *
 * The id is assigned once and scores are stored under it, so renaming a
 * criterion keeps its scores. Changing a *scale* under scores already given
 * would not: a 4 on 1 to 5 is not a 4 on 1 to 10, and every overall worked out
 * from it would be wrong without anything looking wrong. So once any review of
 * the call has been submitted, the scale of an existing criterion is refused,
 * and so is removing one. Adding one is allowed, and the screen says what it
 * costs: reviews already in keep the overall they were given.
 */

export type RubricResult = { ok: true; message: string } | { ok: false; error: string };

async function readCall(callId: string) {
  const ref = db().collection(COLLECTIONS.calls).doc(callId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const call = snap.data() as CallDoc;
  if (call.eventId !== EVENT_ID) return null;
  return { ref, call };
}

/** How many reviews of this call have been submitted. Zero means the criteria are still free to change. */
export async function submittedReviewCount(callId: string): Promise<number> {
  try {
    const snap = await db()
      .collection(COLLECTIONS.submissions)
      .where('eventId', '==', EVENT_ID)
      .where('callId', '==', callId)
      .get();
    return snap.docs.reduce((n, d) => n + ((d.data().reviewsSubmitted as number | undefined) ?? 0), 0);
  } catch (err) {
    recordError(`rubric.submittedCount:${callId}`, err);
    return 0;
  }
}

async function commit(
  found: NonNullable<Awaited<ReturnType<typeof readCall>>>,
  after: RubricCriterionDef[],
  actor: string,
): Promise<void> {
  const before = found.call.rubric ?? [];
  // Renumbered on every write so `order` is always 0..n-1 and a move is a swap.
  const rubric = orderedRubric(after).map((c, i) => ({ ...c, order: i }));
  await found.ref.update({ rubric, updatedBy: actor, updatedAt: FieldValue.serverTimestamp() });
  await appendAudit({
    actor,
    action: 'call.rubric',
    targetPath: found.ref.path,
    targetId: found.ref.id,
    before: { criteria: before.map((c) => `${c.label} ${c.min}-${c.max}`) },
    after: { criteria: rubric.map((c) => `${c.label} ${c.min}-${c.max}`) },
  });
}

export async function saveCriterion(input: {
  callId: string;
  /** Absent to add one. */
  id?: string;
  label: string;
  description?: string;
  min: number;
  max: number;
  actor: string;
}): Promise<RubricResult> {
  try {
    const checked = validateCriterion(input);
    if (!checked.ok) return checked;

    const found = await readCall(input.callId);
    if (!found) return { ok: false, error: 'That call does not exist.' };
    const rubric = found.call.rubric ?? [];

    if (!input.id) {
      if (rubric.length >= MAX_CRITERIA) {
        return { ok: false, error: `A call can have at most ${MAX_CRITERIA} criteria.` };
      }
      if (rubric.some((c) => c.label.toLowerCase() === checked.criterion.label.toLowerCase())) {
        return { ok: false, error: `There is already a criterion called “${checked.criterion.label}”.` };
      }
      const id = criterionId(checked.criterion.label, rubric.map((c) => c.id));
      await commit(found, [...rubric, { ...checked.criterion, id, order: rubric.length }], input.actor);
      return { ok: true, message: `Added “${checked.criterion.label}”. Reviewers see it the next time they open a submission.` };
    }

    const existing = rubric.find((c) => c.id === input.id);
    if (!existing) return { ok: false, error: 'That criterion does not exist any more.' };

    const scaleChanged = existing.min !== checked.criterion.min || existing.max !== checked.criterion.max;
    if (scaleChanged && (await submittedReviewCount(input.callId)) > 0) {
      return {
        ok: false,
        error:
          `Reviews have already been scored on ${existing.min} to ${existing.max}. ` +
          'Changing the scale now would change what those scores mean. You can still rename it.',
      };
    }

    await commit(
      found,
      rubric.map((c) => (c.id === input.id ? { ...checked.criterion, id: c.id, order: c.order } : c)),
      input.actor,
    );
    return { ok: true, message: `Saved “${checked.criterion.label}”. Scores already given to it are kept.` };
  } catch (err) {
    recordError('rubric.save', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save the criterion.' };
  }
}

export async function deleteCriterion(input: { callId: string; id: string; actor: string }): Promise<RubricResult> {
  try {
    const found = await readCall(input.callId);
    if (!found) return { ok: false, error: 'That call does not exist.' };
    const rubric = found.call.rubric ?? [];
    const existing = rubric.find((c) => c.id === input.id);
    if (!existing) return { ok: true, message: 'Already removed.' };

    if ((await submittedReviewCount(input.callId)) > 0) {
      return {
        ok: false,
        error: `Reviews have already been scored against “${existing.label}”, so it cannot be removed.`,
      };
    }

    await commit(found, rubric.filter((c) => c.id !== input.id), input.actor);
    return { ok: true, message: `Removed “${existing.label}”.` };
  } catch (err) {
    recordError('rubric.delete', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not remove the criterion.' };
  }
}

export async function moveCriterion(input: {
  callId: string;
  id: string;
  direction: 'up' | 'down';
  actor: string;
}): Promise<RubricResult> {
  try {
    const found = await readCall(input.callId);
    if (!found) return { ok: false, error: 'That call does not exist.' };
    const rubric = orderedRubric(found.call.rubric ?? []);
    const i = rubric.findIndex((c) => c.id === input.id);
    const j = input.direction === 'up' ? i - 1 : i + 1;
    if (i === -1 || j < 0 || j >= rubric.length) return { ok: true, message: 'Nothing to move.' };

    [rubric[i], rubric[j]] = [rubric[j], rubric[i]];
    await commit(found, rubric.map((c, order) => ({ ...c, order })), input.actor);
    return { ok: true, message: 'Reordered.' };
  } catch (err) {
    recordError('rubric.move', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reorder.' };
  }
}

/** Start from the usual three. Only on a call that has none, so it never overwrites. */
export async function applyDefaultRubric(input: { callId: string; actor: string }): Promise<RubricResult> {
  try {
    const found = await readCall(input.callId);
    if (!found) return { ok: false, error: 'That call does not exist.' };
    if ((found.call.rubric ?? []).length > 0) {
      return { ok: false, error: 'This call already has criteria.' };
    }
    await commit(found, DEFAULT_RUBRIC.map((c) => ({ ...c })), input.actor);
    return { ok: true, message: 'Added Relevance, Originality and Clarity, each scored 1 to 5. Change them to suit.' };
  } catch (err) {
    recordError('rubric.default', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not add the criteria.' };
  }
}
