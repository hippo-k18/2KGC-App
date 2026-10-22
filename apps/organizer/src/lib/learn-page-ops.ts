import 'server-only';

import { randomBytes } from 'node:crypto';
import { COLLECTIONS, LEARN_PAGE_DOC, type LearnPageDoc } from '@kgc/shared';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';
// One way only: `learn-page.ts` must not import this file, or the two would form a cycle.
import { learnValidateOptions, loadLearnLibrarySections } from './learn-page';
import { versionsToPrune } from './learn-page-core';
import {
  LEARN_PREVIEW_TOKEN_BYTES,
  planCancelSchedule,
  planPreviewToken,
  planRevokePreview,
  planSchedule,
  planScheduledPublish,
} from './learn-page-ops-core';

/**
 * Scheduled publish and the draft preview link (T316): the Firestore half of
 * `learn-page-ops-core.ts`. Like `learn-page.ts`, every write is a whole
 * document `set` inside a transaction, so nothing an organizer cleared can
 * survive as a stale merged field.
 */

function docRef() {
  return db().collection(COLLECTIONS.pageLayouts).doc('learn');
}

function versionsRef() {
  return docRef().collection('versions');
}

function read(snap: FirebaseFirestore.DocumentSnapshot): LearnPageDoc | null {
  return snap.exists ? (snap.data() as LearnPageDoc) : null;
}

/** Schedule the current draft. Throws `LearnScheduleRejected` or `LearnConflict`. */
export async function scheduleLearnPublish(at: unknown, baseRevision: number, actor: string): Promise<LearnPageDoc> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(docRef());
    const next = planSchedule(read(snap), at, baseRevision, actor, Date.now());
    tx.set(docRef(), next);
    return next;
  });
}

/** Cancel a pending schedule. Returns the time that was cancelled, or `null` when nothing was scheduled. */
export async function cancelLearnSchedule(): Promise<number | null> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(docRef());
    const stored = read(snap);
    const next = planCancelSchedule(stored);
    if (!next) return null;
    tx.set(docRef(), next);
    return stored?.scheduledPublishAt ?? null;
  });
}

export interface ScheduledRunResult {
  published: boolean;
  versionId?: string;
  draftChanged?: boolean;
  /** Who scheduled it, for the audit entry. */
  scheduledBy?: string;
  revision?: number;
  /** The schedule came due but the draft could not be published; the schedule was cleared. */
  failed?: boolean;
  /** What the editor shows (`scheduleFailure.message`). */
  message?: string;
  problems?: string[];
  /** What threw, when the run failed that way: for the error log only. */
  error?: unknown;
}

/**
 * The timer's step: publish the draft when its scheduled time has come, with
 * the checks a press of Publish makes (`planScheduledPublish`).
 *
 * The check and the publish are one transaction, and the publish clears the
 * schedule, so overlapping or repeated runs publish once. A draft that cannot
 * be published clears the schedule too and records why on the doc, so the
 * next tick finds nothing due instead of failing again every minute.
 */
export async function runScheduledLearnPublish(now: number = Date.now()): Promise<ScheduledRunResult> {
  const versionRef = versionsRef().doc();
  const result = await db().runTransaction(async (tx): Promise<ScheduledRunResult> => {
    const snap = await tx.get(docRef());
    const stored = read(snap);
    // Cheap test first: the timer runs every minute and is almost never due,
    // so the saved sections are read only when there is something to publish.
    if (!stored || typeof stored.scheduledPublishAt !== 'number' || stored.scheduledPublishAt > now) {
      return { published: false };
    }
    // Every read before the first write, as a Firestore transaction requires.
    const library = await loadLearnLibrarySections(tx);
    const plan = planScheduledPublish(stored, now, library, learnValidateOptions());
    if (!plan) return { published: false };
    tx.set(docRef(), plan.doc);
    if (!plan.ok) {
      return {
        published: false,
        failed: true,
        message: plan.message,
        problems: plan.problems,
        draftChanged: plan.draftChanged,
        scheduledBy: stored.scheduledBy,
        revision: plan.doc.revision,
        error: plan.error,
      };
    }
    tx.set(versionRef, plan.version);
    return {
      published: true,
      versionId: versionRef.id,
      draftChanged: plan.draftChanged,
      scheduledBy: stored.scheduledBy,
      revision: plan.doc.revision,
    };
  });
  if (result.published) {
    // As in `publishLearnPage`: housekeeping outside the transaction.
    try {
      const snap = await versionsRef().orderBy('publishedAt', 'desc').select().get();
      await Promise.all(versionsToPrune(snap.docs.map((d) => ({ id: d.id }))).map((id) => versionsRef().doc(id).delete()));
    } catch {
      // An extra old version costs a few kilobytes.
    }
  }
  return result;
}

/** Create the preview link's token, or replace it (which kills the old link). Returns the new token. */
export async function rotateLearnPreviewToken(): Promise<string> {
  const token = randomBytes(LEARN_PREVIEW_TOKEN_BYTES).toString('base64url');
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(docRef());
    tx.set(docRef(), planPreviewToken(read(snap), token));
  });
  return token;
}

/** Turn the preview link off. Returns false when there was none. */
export async function revokeLearnPreviewToken(): Promise<boolean> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(docRef());
    const next = planRevokePreview(read(snap));
    if (!next) return false;
    tx.set(docRef(), next);
    return true;
  });
}

/**
 * One timer tick (`/api/cron/learn-page`, and the hourly call for papers run as
 * a fallback): run the scheduled publish and log it when it happened.
 */
export async function runLearnPageCronStep(now: number = Date.now()): Promise<ScheduledRunResult> {
  const result = await runScheduledLearnPublish(now);
  if (result.published) {
    await appendAudit({
      actor: 'system:schedule',
      action: 'learnPage.scheduledPublish',
      targetPath: LEARN_PAGE_DOC,
      subject: 'KGC | Learn page',
      targetId: 'learn',
      before: {},
      after: {
        revision: result.revision ?? null,
        versionId: result.versionId ?? null,
        scheduledBy: result.scheduledBy ?? null,
        draftChanged: result.draftChanged ?? false,
      },
    });
  } else if (result.failed) {
    // Nobody is watching when the timer fires, so the dashboard's error log
    // and the audit log are where "why did the page not go live" is answered.
    recordError(
      'learn page scheduled publish did not run',
      result.error ?? new Error(result.message ?? 'The draft could not be published.'),
    );
    await appendAudit({
      actor: 'system:schedule',
      action: 'learnPage.scheduledPublishFailed',
      targetPath: LEARN_PAGE_DOC,
      subject: 'KGC | Learn page',
      targetId: 'learn',
      before: { scheduledBy: result.scheduledBy ?? null },
      after: {
        revision: result.revision ?? null,
        problems: (result.problems ?? []).slice(0, 20),
        draftChanged: result.draftChanged ?? false,
      },
    });
  }
  return result;
}
