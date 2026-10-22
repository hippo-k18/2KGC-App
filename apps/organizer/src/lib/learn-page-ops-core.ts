import type { LearnPageContent, LearnPageDoc } from '@kgc/shared';
import { LearnConflict, docOf, effectiveDoc, planPublish, withoutSchedule } from './learn-page-core';

/**
 * Scheduled publish and the draft preview link for the KGC | Learn page (T316),
 * with no Firestore in them, so `learn-page-ops-core.test.ts` can pin every rule.
 * `learn-page-ops.ts` runs them inside transactions.
 *
 * ── Scheduled publish ───────────────────────────────────────────────────────
 *
 * Scheduling stores a time on `pageLayouts/learn`, not a copy of the draft. At
 * that time the droplet's timer (`/api/cron/learn-page`) publishes whatever the
 * draft is then. That is deliberate: an editor who schedules on Monday and fixes
 * a typo on Tuesday wants the fixed page at the scheduled time, not Monday's.
 * The version note says when that happened, because the person who scheduled
 * it may not be the person who edited it afterwards. `scheduledRevision`
 * records the draft revision at scheduling time so the note can tell.
 *
 * A run is idempotent because the publish clears the schedule in the same
 * transaction: a second run, or two timers firing at once, finds nothing due.
 */

/** Earliest a schedule may be set: a minute ahead, so it is never "already due" by the time it is saved. */
export const LEARN_SCHEDULE_MIN_LEAD_MS = 60_000;
/** Latest: a year ahead. Further than that is more likely a typo in the year. */
export const LEARN_SCHEDULE_MAX_LEAD_MS = 366 * 24 * 60 * 60 * 1000;

export const SCHEDULED_NOTE = 'Scheduled';
export const SCHEDULED_CHANGED_NOTE = 'Scheduled. The draft was edited after it was scheduled, so the latest draft was published.';

export class LearnOpRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearnOpRejected';
  }
}

/** Set (or move) the scheduled publish. The revision check is the editor's usual one: schedule what you are looking at. */
export function planSchedule(
  stored: LearnPageDoc | null | undefined,
  at: unknown,
  baseRevision: number,
  actor: string,
  now: number,
): LearnPageDoc {
  if (typeof at !== 'number' || !Number.isFinite(at)) throw new LearnOpRejected('Choose a date and time to publish.');
  if (at < now + LEARN_SCHEDULE_MIN_LEAD_MS) {
    throw new LearnOpRejected('Choose a time at least a minute from now. To publish now, press Publish.');
  }
  if (at > now + LEARN_SCHEDULE_MAX_LEAD_MS) throw new LearnOpRejected('Choose a time within the next year.');
  const cur = effectiveDoc(stored);
  if (cur.revision !== baseRevision) throw new LearnConflict(cur.revision);
  if (!stored) {
    // Nothing saved yet means the draft is the default page, which is what www already shows.
    throw new LearnOpRejected('Save the draft before scheduling it.');
  }
  return {
    ...withoutSchedule(cur),
    scheduledPublishAt: Math.round(at),
    scheduledBy: actor,
    scheduledRevision: cur.revision,
  };
}

/** Drop a pending schedule. `null` when there was none, so the caller writes nothing. */
export function planCancelSchedule(stored: LearnPageDoc | null | undefined): LearnPageDoc | null {
  if (!stored || stored.scheduledPublishAt === undefined) return null;
  return withoutSchedule(stored);
}

export interface ScheduledPublishPlan {
  doc: LearnPageDoc;
  version: { content: LearnPageContent; publishedAt: number; publishedBy: string; note?: string };
  draftChanged: boolean;
}

/**
 * What the timer does at `now`: `null` when nothing is due, otherwise the
 * published doc and the version to write beside it.
 */
export function planScheduledPublish(stored: LearnPageDoc | null | undefined, now: number): ScheduledPublishPlan | null {
  if (!stored || typeof stored.scheduledPublishAt !== 'number' || stored.scheduledPublishAt > now) return null;
  const draftChanged = stored.scheduledRevision !== undefined && stored.scheduledRevision !== stored.revision;
  const actor = stored.scheduledBy || 'scheduled publish';
  const { doc, version } = planPublish(stored, actor, now, draftChanged ? SCHEDULED_CHANGED_NOTE : SCHEDULED_NOTE);
  return { doc, version, draftChanged };
}

// ---------------------------------------------------------------------------
// Draft preview link
// ---------------------------------------------------------------------------

/** 32 random bytes as base64url: the shape `isPreviewTokenShape` in `@kgc/shared` accepts. */
export const LEARN_PREVIEW_TOKEN_BYTES = 32;

/** Give the doc a new preview token. Rotating is the same call: the old link stops working. */
export function planPreviewToken(stored: LearnPageDoc | null | undefined, token: string): LearnPageDoc {
  // With nothing saved, the draft is the default page www already shows, and
  // writing a doc just to hold a token would make the editor report unpublished changes.
  if (!stored) throw new LearnOpRejected('Save the draft before making a preview link.');
  return { ...docOf(stored), previewToken: token };
}

/** Remove the preview token. `null` when there was none. */
export function planRevokePreview(stored: LearnPageDoc | null | undefined): LearnPageDoc | null {
  if (!stored || stored.previewToken === undefined) return null;
  const out = docOf(stored);
  delete out.previewToken;
  return out;
}

/** The preview link for a token, on the public website. */
export function learnPreviewUrl(siteOrigin: string, token: string): string {
  return `${siteOrigin.replace(/\/+$/, '')}/learn/preview/${token}`;
}
