import { expandReusableBlocks, type LearnPageContent, type LearnPageDoc, type LearnSection } from '@kgc/shared';
import {
  LearnConflict,
  LearnNotReady,
  docOf,
  effectiveDoc,
  planPublish,
  publishProblems,
  validateLearnContent,
  withoutSchedule,
  type LearnValidateOptions,
} from './learn-page-core';

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

export type ScheduledPublishPlan =
  | {
      ok: true;
      doc: LearnPageDoc;
      version: { content: LearnPageContent; publishedAt: number; publishedBy: string; note?: string };
      draftChanged: boolean;
    }
  | {
      /** Due but not publishable: `doc` drops the schedule and records why. */
      ok: false;
      doc: LearnPageDoc;
      message: string;
      problems: string[];
      draftChanged: boolean;
      /** Set when the run threw rather than finding a problem: for the error log, never shown. */
      error?: unknown;
    };

/** How many problems the failure note names before "and N more". */
const FAILURE_PROBLEMS_SHOWN = 5;

function failureMessage(lead: string, problems: readonly string[]): string {
  const shown = problems.slice(0, FAILURE_PROBLEMS_SHOWN).join(' ');
  const more = problems.length > FAILURE_PROBLEMS_SHOWN ? ` And ${problems.length - FAILURE_PROBLEMS_SHOWN} more.` : '';
  // The editor's banner says that the scheduled publish did not run; this is the why.
  return `${lead}${shown ? ` ${shown}` : ''}${more}`;
}

/**
 * What the timer does at `now`: `null` when nothing is due, otherwise either
 * the published doc and the version to write beside it, or (`ok: false`) the
 * doc with the schedule cleared and the reason recorded.
 *
 * The checks are the ones `publishLearnPage` makes for a press of Publish, in
 * the same order, so a scheduled publish can never put on www what a person
 * could not: the stored draft is validated again (it may have been written
 * some other way since it was saved), Image and Video blocks must be filled in
 * (`publishBlockers`), and saved sections are expanded from `library` and the
 * expanded page validated too, because a saved section can be older than
 * today's rules. The live copy and the version hold the expanded page, so www
 * and Restore never depend on the library.
 *
 * A failure clears the schedule rather than leaving it due. The timer runs
 * every minute and the draft will not fix itself, so retrying would only fail
 * again (and, before this, threw inside the transaction on every tick). The
 * editor shows `scheduleFailure` so the organizer knows to fix it and publish
 * or schedule again.
 *
 * The blockers are checked on the draft that gets published, with the
 * library, as well as on the expanded page (`publishProblems`). Checking only
 * the expanded page missed an empty Saved section block, which expands to
 * nothing, and `planPublish` then threw on the draft inside the cron
 * transaction every minute (T324 X1). Anything that still throws here takes
 * the same failure path, with a plain message and the error kept for the log.
 */
export function planScheduledPublish(
  stored: LearnPageDoc | null | undefined,
  now: number,
  library: ReadonlyMap<string, LearnSection> = new Map(),
  opts: LearnValidateOptions = {},
): ScheduledPublishPlan | null {
  if (!stored || typeof stored.scheduledPublishAt !== 'number' || stored.scheduledPublishAt > now) return null;
  const base = effectiveDoc(stored);
  const draftChanged = base.scheduledRevision !== undefined && base.scheduledRevision !== base.revision;
  const actor = base.scheduledBy || 'scheduled publish';
  const fail = (lead: string, problems: string[], error?: unknown): ScheduledPublishPlan => {
    const message = failureMessage(lead, problems);
    const plan: ScheduledPublishPlan = {
      ok: false,
      doc: { ...withoutSchedule(base), scheduleFailure: { at: now, message } },
      message,
      problems,
      draftChanged,
    };
    if (error !== undefined) plan.error = error;
    return plan;
  };

  try {
    const checked = validateLearnContent(base.draft, opts);
    if (!checked.ok) return fail('The saved draft has problems:', checked.problems);
    const expanded = validateLearnContent(expandReusableBlocks(checked.content, library), opts);
    if (!expanded.ok) return fail('With its saved sections filled in, the page does not pass the checks:', expanded.problems);
    const blockers = publishProblems(checked.content, library, expanded.content);
    if (blockers.length > 0) return fail(NOT_READY_LEAD, blockers);

    const planned = planPublish(
      { ...base, draft: checked.content },
      actor,
      now,
      draftChanged ? SCHEDULED_CHANGED_NOTE : SCHEDULED_NOTE,
    );
    return {
      ok: true,
      doc: { ...planned.doc, published: expanded.content },
      version: { ...planned.version, content: expanded.content },
      draftChanged,
    };
  } catch (err) {
    if (err instanceof LearnNotReady) return fail(NOT_READY_LEAD, err.problems, err);
    return fail(UNEXPECTED_LEAD, [], err);
  }
}

const NOT_READY_LEAD = 'Some blocks are not filled in yet.';
const UNEXPECTED_LEAD = 'Something went wrong while publishing. Open the editor and press Publish, or schedule it again.';

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
