import type { CallCfpSettings } from '@kgc/shared';
import {
  NUDGE_AFTER_DAYS,
  closeDecisionDate,
  closeDecisionOpen,
  closeDecisionPlan,
  dateIn,
  e2RetriesDue,
  formatDay,
  isOpen,
  reminderDue,
  stillOpenRecipients,
  type CfpRow,
} from '@kgc/scripts/src/lib/cfp-core';
import { dayStartMs } from './email-log-core';

/**
 * The Email Log's Scheduled tab (T274): every email the system will send by
 * itself, and every one waiting on somebody's button. Pure, so the rules can
 * be tested with a moved clock; `email-schedule.ts` gathers the inputs.
 *
 * ⚠️ The timed rules are the scheduler's own (`cfp-core.ts`), called here
 * rather than copied, so this tab cannot promise a send the hourly run would
 * not make. What this file adds is *when*: the run is hourly, so a send that
 * is due now goes on the next hour.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const CFA_BASE = '/content/call-for-speakers-abstracts';

export interface ScheduleRow extends CfpRow {
  title: string;
  name?: string;
  email?: string;
}

export interface ScheduleCall {
  id: string;
  title: string;
  timeZone: string;
  opensAtMs?: number;
  closesAtMs?: number;
  cfp: CallCfpSettings;
  rows: ScheduleRow[];
}

/** A bulk send job, as `send-jobs.ts` reads it. */
export interface ScheduleJob {
  campaignId: string;
  kind: 'campaign' | 'message';
  audience: string;
  label: string;
  subject: string;
  view: 'running' | 'interrupted' | 'done' | 'stopped';
  total: number;
  reached: number;
  failed: number;
}

export interface ScheduleEnv {
  /** `RESEND_API_KEY` is set on the dashboard. */
  emailEnabled: boolean;
  /** `CRON_SECRET` is set, so the hourly route accepts the timer's call. */
  cronSecretSet: boolean;
  /** When the hourly run last reported in, if it ever has. */
  lastCronRunMs?: number;
}

export type ScheduledKind = 'timed' | 'waiting' | 'sending';

export interface ScheduledEmail {
  /** Stable id, and the preview route's key: `e3:<submissionId>`, `reminder:<callId>`, `job:<campaignId>`. */
  key: string;
  /** The friendly name, as the Sent tab spells it. */
  email: string;
  template: string;
  kind: ScheduledKind;
  /** For `timed`: the hour it should go. */
  whenMs?: number;
  /** Words for the When column. */
  when: string;
  /** One address, or "12 authors". */
  to: string;
  count: number;
  /** Set when it cannot send as things stand, in words. */
  blocked?: string;
  /** For `waiting`: where the button is. */
  where?: { label: string; href: string };
  /** The submission or screen it is about. */
  about?: { label: string; href: string };
}

/** The first hourly run at or after `ms`: the timer fires on the hour. */
export function nextRunAt(ms: number): number {
  return Math.ceil(ms / HOUR_MS) * HOUR_MS;
}

/** Why nothing timed can go, or undefined when the hourly run is set up. */
export function timedBlocker(env: ScheduleEnv): string | undefined {
  if (!env.emailEnabled) return 'Email is not switched on for the dashboard (RESEND_API_KEY is empty), so this would be skipped.';
  if (!env.cronSecretSet) return 'The hourly run is not set up on this server (CRON_SECRET is empty), so this will not go.';
  return undefined;
}

/**
 * When the Thursday reminder next goes, or undefined if it will not go in the
 * next five weeks (before the call opens, or after the close with nothing left
 * to review). Checked an hour at a time from now, with the scheduler's own rule.
 */
export function nextReminderMs(call: ScheduleCall, nowMs: number): number | undefined {
  const window = {
    opensAtMs: call.opensAtMs,
    closesAtMs: call.closesAtMs,
    cfp: call.cfp,
    openCount: call.rows.filter(isOpen).length,
  };
  const tz = call.timeZone;
  const today = dateIn(nowMs, tz);
  for (let d = 0; d < 35; d++) {
    const [y, m, day] = today.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, day + d)).toISOString().slice(0, 10);
    const start = dayStartMs(date, tz);
    // Every run that day from 09:00 local; the first one the rule accepts.
    for (let h = 9; h < 24; h++) {
      const at = Math.max(nextRunAt(nowMs), start + h * HOUR_MS);
      if (at >= start + DAY_MS) break;
      if (reminderDue(at, tz, call.cfp.lastReminderWeek, window)) return at;
    }
  }
  return undefined;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Everything one call for speakers will send, or is waiting to. */
export function callSchedule(call: ScheduleCall, env: ScheduleEnv, nowMs: number): ScheduledEmail[] {
  const out: ScheduledEmail[] = [];
  const blocked = timedBlocker(env);
  const submission = (id: string, title: string) => ({ label: title || 'Untitled', href: `${CFA_BASE}/submissions/${id}` });

  // Owed E2: due now, retried every hour until it goes.
  for (const r of e2RetriesDue(call.rows)) {
    if (!r.email) continue;
    const at = nextRunAt(nowMs);
    out.push({
      key: `e2:${r.id}`,
      email: 'E2 Accepted, send your details',
      template: 'cfp-accepted',
      kind: 'timed',
      whenMs: at,
      when: 'Next hourly run (it failed before and is retried every hour)',
      to: r.email,
      count: 1,
      blocked,
      about: submission(r.id, r.title),
    });
  }

  // E3: five days after E2 for everyone accepted who has sent nothing back.
  for (const r of call.rows) {
    const e2 = r.acceptance?.e2SentAtMs;
    if (r.status !== 'accepted' || e2 === undefined || r.acceptance?.nudgedAtMs || r.detailsReceivedAtMs) continue;
    if (!r.email) continue;
    const at = nextRunAt(Math.max(nowMs, e2 + NUDGE_AFTER_DAYS * DAY_MS));
    out.push({
      key: `e3:${r.id}`,
      email: 'E3 Details reminder',
      template: 'cfp-nudge',
      kind: 'timed',
      whenMs: at,
      when: 'Sends only if their details have still not arrived by then',
      to: r.email,
      count: 1,
      blocked,
      about: submission(r.id, r.title),
    });
  }

  // The Thursday reminder.
  const reviewer = call.cfp.reviewerReminderEmail?.includes('@') ? call.cfp.reviewerReminderEmail : undefined;
  const reminderAt = nextReminderMs(call, nowMs);
  if (reminderAt !== undefined || !reviewer) {
    out.push({
      key: `reminder:${call.id}`,
      email: 'Thursday review reminder',
      template: 'cfp-weekly-reminder',
      kind: 'timed',
      whenMs: reminderAt,
      when:
        reminderAt !== undefined
          ? 'Every Thursday from 09:00 while there is something to review'
          : 'Not due: the call has not opened, or nothing is left to review',
      to: reviewer ?? 'No address set',
      count: reviewer ? 1 : 0,
      blocked: !reviewer
        ? 'The weekly reminder address is empty, so this will not send. Set it on Rolling review: dates and emails.'
        : blocked,
      where: !reviewer ? { label: 'Rolling review: dates and emails', href: `${CFA_BASE}/rolling-review` } : undefined,
    });
  }

  // E4 and E6: sent by a person pressing a button.
  const plan = closeDecisionPlan(call.rows);
  const e4Day = formatDay(closeDecisionDate(call.cfp));
  const e4Open = closeDecisionOpen(nowMs, call.cfp, call.timeZone);
  const e4Blocked = e4Open
    ? undefined
    : e4Day
      ? `The button opens on ${e4Day}, two weeks after the close.`
      : 'The close date is not set, so the button cannot open yet.';
  const rolling = { label: 'Call for Speakers › Rolling review › E4', href: `${CFA_BASE}/rolling-review` };
  const declined = plan.declined.filter((r) => r.email);
  const accepted = plan.accepted.filter((r) => r.email);
  if (declined.length) {
    out.push({
      key: `e4d:${call.id}`,
      email: 'E4 Not accepted',
      template: 'cfp-decision-declined',
      kind: 'waiting',
      when: 'Waiting for someone to send',
      to: plural(declined.length, 'author'),
      count: declined.length,
      blocked: e4Blocked,
      where: rolling,
    });
  }
  if (accepted.length) {
    out.push({
      key: `e4a:${call.id}`,
      email: 'E4 Accepted after the close',
      template: 'cfp-decision-accepted',
      kind: 'waiting',
      when: 'Waiting for someone to send. E2 with the details link follows each one.',
      to: plural(accepted.length, 'author'),
      count: accepted.length,
      blocked: e4Blocked,
      where: rolling,
    });
  }
  const e6 = stillOpenRecipients(call.rows).filter((r) => r.email);
  if (e6.length) {
    out.push({
      key: `e6:${call.id}`,
      email: 'E6 Still open',
      template: 'cfp-still-open',
      kind: 'waiting',
      when: 'Waiting for someone to send (planned for early January)',
      to: plural(e6.length, 'author'),
      count: e6.length,
      where: { label: 'Call for Speakers › Rolling review › E6', href: `${CFA_BASE}/rolling-review` },
    });
  }
  return out;
}

/** Bulk sends that are running, or stopped with people still to reach. */
export function jobSchedule(jobs: readonly ScheduleJob[], env: ScheduleEnv): ScheduledEmail[] {
  const out: ScheduledEmail[] = [];
  for (const j of jobs) {
    const left = Math.max(0, j.total - j.reached);
    const where =
      j.kind === 'campaign'
        ? { label: 'Tickets › Ticket Marketing › Email Campaign', href: '/tickets/ticket-marketing/email-campaign' }
        : { label: messageScreenLabel(j.audience), href: messageScreenHref(j.audience) };
    const base = {
      key: `job:${j.campaignId}`,
      email: j.kind === 'campaign' ? 'Email campaign' : 'Message',
      template: 'bulk-message',
      where,
      about: { label: j.subject, href: where.href },
    };
    if (j.view === 'running') {
      out.push({
        ...base,
        kind: 'sending',
        when: `Sending now: ${j.reached} of ${j.total} sent`,
        to: `${plural(left, 'person', 'people')} still to go (${j.label})`,
        count: left,
        blocked: env.emailEnabled ? undefined : 'Email is not switched on, so each one is being skipped.',
      });
    } else if (left > 0) {
      out.push({
        ...base,
        kind: 'waiting',
        when:
          j.view === 'done'
            ? `Finished with ${plural(j.failed, 'failure')}. Waiting for someone to press Send again to retry them.`
            : 'Stopped part way. Waiting for someone to press Send again with the same message.',
        to: `${plural(left, 'person', 'people')} not reached (${j.label})`,
        count: left,
      });
    }
  }
  return out;
}

function messageScreenHref(audience: string): string {
  if (audience.startsWith('sponsor')) return '/content/sponsor-center/message-sponsors';
  if (audience.startsWith('exhibitor')) return '/content/exhibitor-center/message-exhibitors';
  return '/content/speaker-center/message-speakers';
}

function messageScreenLabel(audience: string): string {
  if (audience.startsWith('sponsor')) return 'Content › Sponsor Center › Message Sponsors';
  if (audience.startsWith('exhibitor')) return 'Content › Exhibitor Center › Message Exhibitors';
  return 'Content › Speaker Center › Message Speakers';
}

/** Timed first by when, then the waiting ones, then the rest. */
export function sortSchedule(items: ScheduledEmail[]): ScheduledEmail[] {
  const rank: Record<ScheduledKind, number> = { sending: 0, timed: 1, waiting: 2 };
  return [...items].sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] ||
      (a.whenMs ?? Number.MAX_SAFE_INTEGER) - (b.whenMs ?? Number.MAX_SAFE_INTEGER) ||
      a.email.localeCompare(b.email),
  );
}

/**
 * The one-line health of the hourly run, or null when it looks fine. The
 * dashboard cannot see the droplet's timer, only whether the run has called
 * in: older than three hours means it has stopped.
 */
export function cronHealth(env: ScheduleEnv, nowMs: number): string | null {
  if (!env.cronSecretSet) return 'The hourly run is not set up on this server (CRON_SECRET is empty). Nothing timed will send until it is.';
  if (env.lastCronRunMs === undefined) return 'The hourly run has not reported in yet. If this stays, check the kgc-cfp-cron timer on the server.';
  if (nowMs - env.lastCronRunMs > 3 * HOUR_MS) return 'The hourly run has not reported in for over three hours. Check the kgc-cfp-cron timer on the server.';
  return null;
}
