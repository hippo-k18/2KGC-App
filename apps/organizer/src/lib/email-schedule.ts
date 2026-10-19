import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  TIME_ZONE,
  publicSiteOrigin,
  type CallDoc,
  type EmailBodyDoc,
} from '@kgc/shared';
import {
  DETAILS_DUE_DAYS,
  closeDecisionPlan,
  dayAfter,
  formatDay,
  reviewQueue,
  sessionTypeLine,
  stillOpenRecipients,
} from '@kgc/scripts/src/lib/cfp-core';
import {
  cfpAcceptedMessage,
  cfpCloseAcceptedMessage,
  cfpCloseDeclinedMessage,
  cfpNudgeMessage,
  cfpStillOpenMessage,
  cfpWeeklyReminderMessage,
  emailEnabled,
  senderIdentity,
} from '@kgc/scripts/src/lib/email';
import { listCfpSubmissions, reviewDashboardUrl, type CfpSubmission } from './cfp';
import { recordError } from './errors';
import { db } from './firestore';
import {
  callSchedule,
  jobSchedule,
  sortSchedule,
  type ScheduleCall,
  type ScheduleEnv,
  type ScheduleJob,
  type ScheduledEmail,
} from './email-schedule-core';
import { recentSendJobs } from './send-jobs';

/**
 * The Scheduled tab's reads (T274). The rules are in `email-schedule-core.ts`;
 * this gathers the calls, submissions and bulk jobs they run on. Read-only:
 * nothing here sends, and the previews are built, never posted.
 */

/** `settings/cfpCron`: when the hourly CFP run last called in. Written by `/api/cron/cfp`. */
export const CRON_STATUS_DOC = 'cfpCron';

const ms = (t: unknown): number | undefined => {
  const v = t as { toMillis?: () => number } | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : undefined;
};

export async function scheduleEnv(): Promise<ScheduleEnv> {
  let lastCronRunMs: number | undefined;
  try {
    const snap = await db().collection(COLLECTIONS.settings).doc(CRON_STATUS_DOC).get();
    const v = snap.get('lastRunAtMs');
    lastCronRunMs = typeof v === 'number' ? v : undefined;
  } catch (err) {
    recordError('email-schedule.cron-status', err);
  }
  return {
    emailEnabled: emailEnabled(),
    cronSecretSet: (process.env.CRON_SECRET ?? '').length >= 16,
    lastCronRunMs,
  };
}

/** Every published call on the rolling-review flow, with its submissions. */
async function scheduleCalls(): Promise<(ScheduleCall & { submissions: CfpSubmission[] })[]> {
  const snap = await db().collection(COLLECTIONS.calls).where('eventId', '==', EVENT_ID).get();
  const out: (ScheduleCall & { submissions: CfpSubmission[] })[] = [];
  for (const doc of snap.docs) {
    const call = doc.data() as CallDoc;
    // The same calls the hourly run reads.
    if (!call.cfp || call.status !== 'published') continue;
    const submissions = await listCfpSubmissions(doc.id, { strict: true });
    out.push({
      id: doc.id,
      title: call.title,
      timeZone: call.timeZone ?? TIME_ZONE,
      opensAtMs: ms(call.opensAt),
      closesAtMs: ms(call.closesAt),
      cfp: call.cfp,
      rows: submissions.map((s) => ({ ...s, title: s.title })),
      submissions,
    });
  }
  return out;
}

async function scheduleJobs(): Promise<ScheduleJob[]> {
  const [campaigns, messages] = await Promise.all([
    recentSendJobs(db(), 'campaign', 20),
    recentSendJobs(db(), 'message', 20),
  ]);
  const audienceOf = new Map<string, string>();
  try {
    const snap = await db().collection(COLLECTIONS.sendJobs).where('eventId', '==', EVENT_ID).get();
    for (const d of snap.docs) audienceOf.set(d.id, String(d.get('audience') ?? ''));
  } catch {
    // The audience only picks which screen to link to.
  }
  return [...campaigns, ...messages].map((j) => ({
    campaignId: j.campaignId,
    kind: j.kind,
    audience: audienceOf.get(j.campaignId) ?? '',
    label: j.label,
    subject: j.subject,
    view: j.view,
    total: j.total,
    reached: j.alreadySent + j.sent,
    failed: j.failed,
  }));
}

export interface ScheduleView {
  env: ScheduleEnv;
  items: ScheduledEmail[];
  calls: { id: string; title: string; missing: string[] }[];
}

export async function loadSchedule(nowMs = Date.now()): Promise<ScheduleView> {
  const [env, calls, jobs] = await Promise.all([scheduleEnv(), scheduleCalls(), scheduleJobs()]);
  const items = [
    ...calls.flatMap((c) => callSchedule(c, env, nowMs)),
    ...jobSchedule(jobs, env),
  ];
  return {
    env,
    items: sortSchedule(items),
    calls: calls.map((c) => ({
      id: c.id,
      title: c.title,
      missing: [
        ...(c.cfp.acceptNoticeEmail?.includes('@') ? [] : ['Acceptance notice address (sent on every Accept)']),
        ...(c.cfp.reviewerReminderEmail?.includes('@') ? [] : ['Weekly reminder address']),
      ],
    })),
  };
}

// ---------------------------------------------------------------------------
// Previews of what a scheduled item will look like
// ---------------------------------------------------------------------------

const PRIVATE_LINK = '[private link]';

export interface ScheduledPreview {
  item: ScheduledEmail;
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Everyone it would go to, for a send to many. */
  recipients?: { name?: string; email: string; title: string }[];
  notes: string[];
}

export async function scheduledPreview(key: string, nowMs = Date.now()): Promise<ScheduledPreview | null> {
  const view = await loadSchedule(nowMs);
  const item = view.items.find((i) => i.key === key);
  if (!item) return null;
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const sender = senderIdentity();
  const site = publicSiteOrigin();
  const linkNote = 'Private links are shown as [private link]; the real email carries the recipient’s own.';

  if (kind === 'job') return jobPreview(item, id, sender);

  const calls = await scheduleCalls();
  if (kind === 'reminder') {
    const call = calls.find((c) => c.id === id);
    if (!call) return null;
    const queue = reviewQueue(call.rows, call.cfp.lastPassAtMs);
    const msg = cfpWeeklyReminderMessage({
      name: undefined,
      fresh: queue.filter((q) => q.isNew).length,
      open: queue.length,
      link: reviewDashboardUrl(),
    });
    return {
      item,
      ...sender,
      to: item.to,
      ...msg,
      notes: ['The counts are as of now; the email uses the counts at the time it goes.'],
    };
  }

  const call = calls.find((c) => c.submissions.some((s) => s.id === id)) ?? calls.find((c) => c.id === id);
  if (!call) return null;
  const tz = call.timeZone;

  if (kind === 'e2' || kind === 'e3') {
    const s = call.submissions.find((x) => x.id === id);
    if (!s?.email) return null;
    const typeLine = sessionTypeLine(s.sessionType, s.durationMinutes);
    const workshop = s.sessionType === 'workshop';
    const msg =
      kind === 'e2'
        ? cfpAcceptedMessage({
            name: s.name,
            title: s.title,
            typeLine,
            workshop,
            link: `${site}/speaker/${PRIVATE_LINK}`,
            dueDay: dayAfter(item.whenMs ?? nowMs, DETAILS_DUE_DAYS, tz),
            sessionNoticeDay: formatDay(call.cfp.sessionNoticeDate),
          })
        : cfpNudgeMessage({
            name: s.name,
            title: s.title,
            workshop,
            link: `${site}/speaker/${PRIVATE_LINK}`,
            dueDay: dayAfter(s.acceptance?.e2SentAtMs ?? nowMs, DETAILS_DUE_DAYS, tz),
          });
    return { item, ...sender, to: s.email, ...msg, notes: [linkNote] };
  }

  const many = (rows: CfpSubmission[]) =>
    rows.filter((r) => r.email).map((r) => ({ name: r.name, email: r.email!, title: r.title }));
  const plan = closeDecisionPlan(call.submissions);
  const group =
    kind === 'e4d' ? plan.declined : kind === 'e4a' ? plan.accepted : kind === 'e6' ? stillOpenRecipients(call.submissions) : [];
  const recipients = many(group);
  const first = group.find((r) => r.email);
  if (!first) return null;
  const msg =
    kind === 'e4d'
      ? cfpCloseDeclinedMessage({ name: first.name, title: first.title, reason: first.declineReason })
      : kind === 'e4a'
        ? cfpCloseAcceptedMessage({ name: first.name, title: first.title })
        : cfpStillOpenMessage({ name: first.name, title: first.title, decisionDay: formatDay(call.cfp.decisionDate) });
  return {
    item,
    ...sender,
    to: first.email!,
    ...msg,
    recipients,
    notes: [`Shown as ${first.name || first.email} would get it. Each author gets their own name and title.`],
  };
}

/** A bulk send's preview is a message it already sent: the newest stored copy. */
async function jobPreview(
  item: ScheduledEmail,
  campaignId: string,
  sender: { from: string; replyTo: string },
): Promise<ScheduledPreview | null> {
  const snap = await db().collection(COLLECTIONS.emailLog).where('campaignId', '==', campaignId).get();
  const withBody = snap.docs.filter((d) => d.get('hasBody') === true);
  for (const d of withBody) {
    const body = await db().collection(COLLECTIONS.emailBodies).doc(d.id).get();
    if (!body.exists) continue;
    const b = body.data() as EmailBodyDoc;
    return {
      item,
      from: b.from,
      replyTo: b.replyTo,
      to: b.to,
      subject: b.subject,
      html: b.html,
      text: b.text,
      notes: [`One copy this send already made, to ${b.to}. Each person gets their own greeting and unsubscribe link.`],
    };
  }
  return {
    item,
    ...sender,
    to: item.to,
    subject: item.about?.label ?? '',
    html: '',
    text: '',
    notes: ['No copy of this send was stored, so there is nothing to show. Sends started before the Email Log existed have none.'],
  };
}
