import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type SendJobDoc } from '@kgc/shared';
import type { SendOutcome } from '@kgc/scripts/src/lib/email';
import {
  JOB_HEARTBEAT_MS,
  foldEmail,
  jobLockIsFree,
  jobSummary,
  jobView,
  planBulkSend,
  type BulkRecipient,
  type JobView,
} from './send-jobs-core';

/**
 * Bulk email as a background job (T258 #1, #16; T262 Email Campaign).
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 *
 * Email Campaign and Message Speakers / Sponsors / Exhibitors sent inside the
 * server action, one recipient after another. A list of 2,000 takes ten to
 * twenty minutes, Apache cuts the browser off at five, and the organizer saw an
 * error while Node kept sending. They pressed Send again, which minted a new
 * campaign id and mailed the whole list a second time. A deploy restart in the
 * middle killed the loop, and nothing recorded how far it had got.
 *
 * ── What this does instead ──────────────────────────────────────────────────
 *
 * The press takes a lock on the campaign, works out who still needs the mail
 * from `emailLog` (`status: 'sent'` rows only, so a failed send is retried),
 * writes a `sendJobs/{campaignId}` progress document and returns. The sending
 * carries on in this Node process after the response has gone. The screen
 * polls the job document.
 *
 * The campaign id is derived from the audience and the message
 * (`bulkCampaignId`), so pressing Send again with the same message lands on
 * the same campaign: while it runs, the press is told it is already running;
 * after an interruption, it resumes and mails only the people not yet reached.
 *
 * ⚠️ The job lives in this process. A restart stops it, and the screen then
 * says "stopped before the end, press Send again". Nothing resumes on its own,
 * on purpose: a send nobody is watching is the 6am-in-the-wrong-timezone
 * failure the dashboard refuses to schedule for.
 *
 * Takes the store as a parameter rather than calling `db()`, so the emulator
 * suite can run the real thing.
 */

export interface StartBulkSendInput<T extends BulkRecipient> {
  store: Firestore;
  campaignId: string;
  kind: SendJobDoc['kind'];
  /** Which screen's job this is: the list name, or the Message audience id. */
  audience: string;
  /** For the progress line: "the KGC 2026 attendees list", "speakers". */
  label: string;
  subject: string;
  actor: string;
  recipients: readonly T[];
  /** Mail one person. Must not throw; it is `sendBulkMessage` in practice. */
  send: (recipient: T, ctx: { campaignId: string; issuedAt: number }) => Promise<SendOutcome>;
  /** Runs once, on the first press of a campaign only (the suppression log). */
  onFirstRun?: () => Promise<void>;
  /** Errors from the background run, which has no request to report to. */
  onError?: (err: unknown) => void;
}

export type StartBulkSendResult =
  | {
      started: true;
      campaignId: string;
      /** True when an earlier run of this campaign had already reached some people. */
      resumed: boolean;
      total: number;
      alreadySent: number;
      /** How many this run will try. */
      todo: number;
      duplicates: number;
      /** Settles when the background run ends. Actions do not await it; tests do. */
      done: Promise<void>;
    }
  | {
      started: false;
      reason: 'busy' | 'nothing-left';
      campaignId: string;
      total: number;
      alreadySent: number;
    };

const lockRef = (store: Firestore, campaignId: string) =>
  store.collection(COLLECTIONS.sendLocks).doc(campaignId);
const jobRef = (store: Firestore, campaignId: string) =>
  store.collection(COLLECTIONS.sendJobs).doc(campaignId);

function millis(t: unknown): number | undefined {
  const v = t as { toMillis?: () => number } | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : undefined;
}

/**
 * Take the campaign, or report that a live run holds it.
 *
 * A transaction, so two presses in the same second cannot both win. A lock
 * whose `heldAt` is unreadable counts as held now, so a malformed row refuses
 * a send rather than authorising a second one.
 */
async function takeLock(store: Firestore, campaignId: string, actor: string, runId: string): Promise<boolean> {
  return store.runTransaction(async (tx) => {
    const ref = lockRef(store, campaignId);
    const snap = await tx.get(ref);
    const heldAt = snap.exists ? (millis(snap.get('heldAt')) ?? Date.now()) : undefined;
    if (!jobLockIsFree(heldAt, Date.now())) return false;
    tx.set(ref, { campaignId, actor, runId, heldAt: new Date() });
    return true;
  });
}

/** Refresh the lock if it is still ours. False means another run took it over. */
async function beat(store: Firestore, campaignId: string, runId: string): Promise<boolean> {
  return store.runTransaction(async (tx) => {
    const ref = lockRef(store, campaignId);
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get('runId') !== runId) return false;
    tx.update(ref, { heldAt: new Date() });
    return true;
  });
}

async function releaseLock(store: Firestore, campaignId: string, runId: string): Promise<void> {
  await store
    .runTransaction(async (tx) => {
      const ref = lockRef(store, campaignId);
      const snap = await tx.get(ref);
      if (snap.exists && snap.get('runId') === runId) tx.delete(ref);
    })
    .catch(() => undefined);
}

/**
 * Every address this campaign has actually been sent to, folded.
 *
 * ⚠️ Only `sent`. Counting a `failed` row as mailed is how the consent send
 * left everybody Resend refused with a 429 unmailed for ever (T258 #2).
 * Rethrows: an empty set would mean "mail everybody again".
 */
export async function sentAddresses(store: Firestore, campaignId: string): Promise<Set<string>> {
  const snap = await store.collection(COLLECTIONS.emailLog).where('campaignId', '==', campaignId).get();
  const sent = new Set<string>();
  for (const d of snap.docs) {
    if (d.get('status') === 'sent') sent.add(foldEmail(d.get('to') as string | undefined));
  }
  sent.delete('');
  return sent;
}

export async function startBulkSend<T extends BulkRecipient>(
  input: StartBulkSendInput<T>,
): Promise<StartBulkSendResult> {
  const { store, campaignId } = input;
  const runId = randomUUID();

  if (!(await takeLock(store, campaignId, input.actor, runId))) {
    const job = await readSendJob(store, campaignId).catch(() => null);
    return {
      started: false,
      reason: 'busy',
      campaignId,
      total: job?.total ?? input.recipients.length,
      alreadySent: (job?.alreadySent ?? 0) + (job?.sent ?? 0),
    };
  }

  let handedOff = false;
  try {
    const plan = planBulkSend(input.recipients, await sentAddresses(store, campaignId));
    if (plan.todo.length === 0) {
      return { started: false, reason: 'nothing-left', campaignId, total: plan.total, alreadySent: plan.alreadySent };
    }

    const previous = await jobRef(store, campaignId).get();
    const issuedAt =
      (previous.exists ? (previous.get('issuedAt') as number | undefined) : undefined) ?? Date.now();
    const resumed = previous.exists || plan.alreadySent > 0;

    const job: SendJobDoc = {
      eventId: EVENT_ID,
      campaignId,
      kind: input.kind,
      audience: input.audience,
      label: input.label,
      subject: input.subject,
      actor: input.actor,
      status: 'running',
      total: plan.total,
      alreadySent: plan.alreadySent,
      sent: 0,
      failed: 0,
      issuedAt,
      // Native Dates: a sentinel from this copy of firebase-admin may not be
      // the store's copy (AGENTS.md gotcha 8).
      startedAt: new Date() as unknown as SendJobDoc['startedAt'],
      heartbeatAt: new Date() as unknown as SendJobDoc['heartbeatAt'],
    };
    await jobRef(store, campaignId).set(job);

    if (!previous.exists && input.onFirstRun) await input.onFirstRun();

    const done = run(input, plan.todo, runId, issuedAt);
    handedOff = true;
    return {
      started: true,
      campaignId,
      resumed,
      total: plan.total,
      alreadySent: plan.alreadySent,
      todo: plan.todo.length,
      duplicates: plan.duplicates,
      done,
    };
  } finally {
    if (!handedOff) await releaseLock(store, campaignId, runId);
  }
}

/**
 * The background half. Never rejects: whatever happens is written to the job
 * document, because there is no request left to report it to.
 */
async function run<T extends BulkRecipient>(
  input: StartBulkSendInput<T>,
  todo: readonly T[],
  runId: string,
  issuedAt: number,
): Promise<void> {
  const { store, campaignId } = input;
  const ref = jobRef(store, campaignId);
  let sent = 0;
  let failed = 0;
  let lost = false;
  let error: string | undefined;

  const progress = () => ({ sent, failed, heartbeatAt: new Date() });

  /*
   * On a timer rather than between sends: one send can spend most of a minute
   * in retries against a rate-limited provider, and the lock must not look
   * abandoned while it does.
   */
  const timer = setInterval(() => {
    beat(store, campaignId, runId)
      .then((mine) => {
        if (!mine) lost = true;
        return ref.update(progress());
      })
      .catch(() => undefined);
  }, JOB_HEARTBEAT_MS);

  try {
    for (const r of todo) {
      if (lost) {
        error = 'Another send of this campaign took over, so this one stopped.';
        break;
      }
      const outcome = await input.send(r, { campaignId, issuedAt });
      if (outcome === 'sent') sent++;
      else failed++;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    input.onError?.(err);
  } finally {
    clearInterval(timer);
    await ref
      .update({
        ...progress(),
        status: error ? 'stopped' : 'done',
        finishedAt: new Date(),
        ...(error ? { error: error.slice(0, 300) } : {}),
      })
      .catch((err) => input.onError?.(err));
    await releaseLock(store, campaignId, runId);
  }
}

export interface SendJobView {
  campaignId: string;
  kind: SendJobDoc['kind'];
  label: string;
  subject: string;
  view: JobView;
  total: number;
  alreadySent: number;
  sent: number;
  failed: number;
  /** One sentence for the screen. */
  summary: string;
  startedAt: string;
}

function toView(d: SendJobDoc, now: number): SendJobView {
  const view = jobView(d.status, millis(d.heartbeatAt) ?? 0, now);
  return {
    campaignId: d.campaignId,
    kind: d.kind,
    label: d.label,
    subject: d.subject,
    view,
    total: d.total,
    alreadySent: d.alreadySent,
    sent: d.sent,
    failed: d.failed,
    summary: jobSummary({ ...d, view }),
    startedAt: new Date(millis(d.startedAt) ?? 0).toISOString(),
  };
}

export async function readSendJob(store: Firestore, campaignId: string): Promise<SendJobView | null> {
  const snap = await jobRef(store, campaignId).get();
  if (!snap.exists) return null;
  return toView(snap.data() as SendJobDoc, Date.now());
}

/**
 * The newest jobs of one kind, for the screen to show on load.
 *
 * One equality filter and the sorting done here, so no composite index is
 * needed. There are a handful of jobs per event.
 */
export async function recentSendJobs(
  store: Firestore,
  kind: SendJobDoc['kind'],
  limit = 3,
  audience?: string,
): Promise<SendJobView[]> {
  const snap = await store.collection(COLLECTIONS.sendJobs).where('eventId', '==', EVENT_ID).get();
  const now = Date.now();
  return snap.docs
    .map((d) => d.data() as SendJobDoc)
    .filter((d) => d.kind === kind && (audience === undefined || d.audience === audience))
    .sort((a, b) => (millis(b.startedAt) ?? 0) - (millis(a.startedAt) ?? 0))
    .slice(0, limit)
    .map((d) => toView(d, now));
}
