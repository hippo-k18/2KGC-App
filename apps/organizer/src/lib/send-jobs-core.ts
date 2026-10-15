import { createHash } from 'node:crypto';

/**
 * The arithmetic of a background bulk send, apart from Firestore so it can be
 * tested (`server-only` and Vitest do not mix; see AGENTS.md).
 *
 * `send-jobs.ts` is the half that reads and writes. Everything that decides
 * who gets a mail, and what a campaign is called, lives here.
 */

/** Lower-case and trim, the way every address comparison in the dashboard folds. */
export function foldEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * The campaign id for one message to one audience.
 *
 * ── Derived, not random ─────────────────────────────────────────────────────
 *
 * ⚠️ It used to be a fresh UUID per press. A send that outlived Apache's
 * five-minute timeout showed the organizer an error, they pressed Send again,
 * and the new id meant nothing connected the second press to the first: the
 * whole list was mailed twice (T258 #1). Derived from the audience, the subject
 * and the body, the second press lands on the same campaign, reads who the
 * first one reached from `emailLog`, and mails only the rest.
 *
 * The cost is that the same message cannot be sent to the same audience twice
 * on purpose. That is the right way round: change a word and it is a new
 * campaign.
 */
export function bulkCampaignId(input: {
  kind: 'campaign' | 'message';
  audience: string;
  subject: string;
  body: string;
}): string {
  const digest = createHash('sha256')
    .update([input.kind, input.audience, input.subject.trim(), input.body.trim()].join('\u0000'))
    .digest('hex')
    .slice(0, 32);
  return `${input.kind === 'campaign' ? 'campaign' : 'camp'}_${digest}`;
}

export interface BulkRecipient {
  email: string;
  name?: string;
}

/**
 * One row per folded address, first one kept, input order preserved. Applied
 * where an audience is resolved, so the count an organizer types to confirm is
 * the count that is then mailed.
 */
export function dedupeByEmail<T extends BulkRecipient>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = foldEmail(r.email);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface BulkPlan<T extends BulkRecipient> {
  /** Who this run will mail, one per folded address, in input order. */
  todo: T[];
  /** Distinct addresses in the audience. */
  total: number;
  /** Of those, already sent for this campaign. */
  alreadySent: number;
  /** Rows dropped because the folded address had appeared already. */
  duplicates: number;
}

/**
 * Who a run will actually mail.
 *
 * One mail per folded address, because two sponsor records sharing a contact,
 * or `Ada@x.com` and `ada@x.com` on one list, used to get two copies (T258
 * #16). And nobody whose `emailLog` row for this campaign says `sent`: a row
 * that says `failed` or `skipped` is somebody the last run did not reach, and
 * is mailed again.
 */
export function planBulkSend<T extends BulkRecipient>(
  recipients: readonly T[],
  sentTo: ReadonlySet<string>,
): BulkPlan<T> {
  const seen = new Set<string>();
  const todo: T[] = [];
  let duplicates = 0;
  let alreadySent = 0;

  for (const r of recipients) {
    const key = foldEmail(r.email);
    if (!key) continue;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    if (sentTo.has(key)) alreadySent++;
    else todo.push(r);
  }

  return { todo, total: seen.size, alreadySent, duplicates };
}

/**
 * How long a running job may go without a heartbeat before it counts as
 * interrupted. The runner beats every few seconds; a deploy restart or a crash
 * stops it, and after this long another press may take the campaign over.
 */
export const JOB_STALE_MS = 90_000;

/** How often the runner writes its counters and refreshes its lock. */
export const JOB_HEARTBEAT_MS = 5_000;

export type JobView = 'running' | 'interrupted' | 'done' | 'stopped';

/** What the screen should call a job, given its stored status and its heartbeat. */
export function jobView(
  status: 'running' | 'done' | 'stopped',
  heartbeatAtMs: number,
  nowMs: number,
): JobView {
  if (status !== 'running') return status;
  return nowMs - heartbeatAtMs > JOB_STALE_MS ? 'interrupted' : 'running';
}

/** Whether the campaign lock may be taken, given when it was last refreshed. */
export function jobLockIsFree(heldAtMs: number | undefined, nowMs: number): boolean {
  return heldAtMs === undefined || nowMs - heldAtMs > JOB_STALE_MS;
}

/** The order in which one person's rows decide their outcome. */
const RANK: Record<string, number> = { sent: 3, failed: 2, skipped: 1 };

/**
 * One outcome per person per campaign.
 *
 * A resumed campaign writes a second row for everybody the first run failed,
 * and a `sent` row anywhere means they got it. Counting rows instead of people
 * would show "2,000 sent, 40 failed" for a list of 2,000 that every person
 * received.
 */
export function foldCampaignRows<R extends { to?: string | null; status: string }>(
  rows: readonly R[],
): R[] {
  const best = new Map<string, R>();
  const anonymous: R[] = [];
  for (const row of rows) {
    const key = foldEmail(row.to);
    // An erased recipient has no address left to fold on; keep each row.
    if (!key) {
      anonymous.push(row);
      continue;
    }
    const held = best.get(key);
    if (!held || (RANK[row.status] ?? 0) > (RANK[held.status] ?? 0)) best.set(key, row);
  }
  return [...best.values(), ...anonymous];
}

/** The one sentence a finished or running job is summed up in. */
export function jobSummary(job: {
  view: JobView;
  total: number;
  alreadySent: number;
  sent: number;
  failed: number;
  label: string;
}): string {
  const reached = job.alreadySent + job.sent;
  const left = Math.max(0, job.total - reached - job.failed);
  const failed = job.failed
    ? ` ${job.failed} failed. Press Send again with the same message to retry them.`
    : '';
  switch (job.view) {
    case 'running':
      return `Sending to ${job.label}: ${reached} of ${job.total} sent so far.${job.failed ? ` ${job.failed} failed.` : ''} You can leave this page; it keeps going.`;
    case 'done':
      return `Finished: sent to ${reached} of ${job.total} on ${job.label}.${failed}`;
    case 'interrupted':
    case 'stopped':
      return `Stopped before the end: ${reached} of ${job.total} sent, ${left} not tried yet.${job.failed ? ` ${job.failed} failed.` : ''} Press Send again with the same message to finish. Nobody already reached gets a second copy.`;
  }
}
