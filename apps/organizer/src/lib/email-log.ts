import 'server-only';

import { Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  TIME_ZONE,
  publicSiteOrigin,
  type EmailBodyDoc,
  type EmailLogDoc,
  type OrderDoc,
  type RegistrationDoc,
  type SubmissionDoc,
} from '@kgc/shared';
import {
  DETAILS_DUE_DAYS,
  dateIn,
  dayAfter,
  formatDay,
  sessionTypeLine,
} from '@kgc/scripts/src/lib/cfp-core';
import {
  cfpAcceptNoticeMessage,
  cfpAcceptedMessage,
  cfpCloseAcceptedMessage,
  cfpCloseDeclinedMessage,
  cfpNudgeMessage,
  cfpReceivedMessage,
  cfpStillOpenMessage,
  inviteForCode,
  purchaseConfirmationMessage,
  senderIdentity,
} from '@kgc/scripts/src/lib/email';
import { getCfpCall, submissionDashboardUrl } from './cfp';
import { recordError } from './errors';
import { db } from './firestore';
import { filterRows, type EmailLogFilters, type EmailLogRow } from './email-log-core';
import { getSubmission } from './submissions';

/**
 * The dashboard's Email Log (T274): every row of `emailLog`, and the message
 * behind one.
 *
 * Read-only. Nothing in this file, and nothing on the screens that use it,
 * sends anything.
 *
 * ── The list query ──────────────────────────────────────────────────────────
 *
 * One range on `at`, ordered by `at`. That needs only the single-field index
 * Firestore keeps by default, so there is no composite index to deploy, and
 * the emulator (which ignores index configuration) cannot pass a query that
 * production would refuse. `eventId`, template, status and the search are
 * applied here, on at most `MAX_SCAN` rows; past that the screen says to
 * narrow the dates.
 */

export const MAX_SCAN = 3000;

const ms = (t: unknown): number | undefined => {
  const v = t as { toMillis?: () => number } | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : undefined;
};

function toRow(id: string, d: EmailLogDoc): EmailLogRow {
  return {
    id,
    atMs: ms(d.at) ?? 0,
    to: d.to ?? '',
    subject: d.subject ?? '',
    template: d.template,
    status: d.status,
    error: d.error,
    reason: d.reason,
    attempts: d.attempts,
    bounced: Boolean(d.bouncedAt),
    complained: Boolean(d.complainedAt),
    orderId: d.orderId,
    registrationId: d.registrationId,
    campaignId: d.campaignId,
    submissionId: d.submissionId,
    actor: d.actor,
    hasBody: d.hasBody === true,
  };
}

export interface EmailLogPage {
  rows: EmailLogRow[];
  /** True when the date range held more than `MAX_SCAN` rows and the oldest were not read. */
  capped: boolean;
}

export async function listEmailLog(
  filters: EmailLogFilters,
  range: { startMs?: number; endMs?: number },
): Promise<EmailLogPage> {
  let q: FirebaseFirestore.Query = db().collection(COLLECTIONS.emailLog);
  if (range.startMs !== undefined) q = q.where('at', '>=', Timestamp.fromMillis(range.startMs));
  if (range.endMs !== undefined) q = q.where('at', '<', Timestamp.fromMillis(range.endMs));
  const snap = await q.orderBy('at', 'desc').limit(MAX_SCAN).get();
  const rows = snap.docs
    .filter((d) => (d.get('eventId') as string | undefined) === EVENT_ID)
    .map((d) => toRow(d.id, d.data() as EmailLogDoc));
  return { rows: filterRows(rows, filters, TIME_ZONE), capped: snap.size >= MAX_SCAN };
}

/** What the preview screen shows for one row. */
export interface EmailPreview {
  row: EmailLogRow;
  /** `stored`: exactly what went. `recreated`: built again from today's data. `none`: nothing to show. */
  kind: 'stored' | 'recreated' | 'none';
  from?: string;
  replyTo?: string;
  subject?: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  htmlDropped?: boolean;
  masked?: boolean;
  /** For `none`: when stored bodies begin, if any exist. */
  storedFromMs?: number;
  /** For `recreated`: what may differ from what was sent. */
  notes?: string[];
}

export async function getEmailPreview(id: string): Promise<EmailPreview | null> {
  const snap = await db().collection(COLLECTIONS.emailLog).doc(id).get();
  if (!snap.exists) return null;
  const doc = snap.data() as EmailLogDoc;
  if (doc.eventId !== EVENT_ID) return null;
  const row = toRow(snap.id, doc);

  if (row.hasBody) {
    const body = await db().collection(COLLECTIONS.emailBodies).doc(id).get();
    if (body.exists) {
      const b = body.data() as EmailBodyDoc;
      return {
        row,
        kind: 'stored',
        from: b.from,
        replyTo: b.replyTo,
        subject: b.subject,
        html: b.html,
        text: b.text,
        headers: b.headers,
        htmlDropped: b.htmlDropped,
        masked: b.masked,
      };
    }
  }

  try {
    const again = await recreate(row);
    if (again) return { row, kind: 'recreated', ...senderIdentity(), ...again };
  } catch (err) {
    recordError(`email-log.recreate:${id}`, err);
  }
  return { row, kind: 'none', storedFromMs: await firstStoredMs() };
}

/** When the oldest stored body was written, for "Preview not stored for emails sent before …". */
async function firstStoredMs(): Promise<number | undefined> {
  try {
    const snap = await db().collection(COLLECTIONS.emailBodies).orderBy('at', 'asc').limit(1).get();
    return ms(snap.docs[0]?.get('at'));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Re-created previews, for rows written before bodies were stored
// ---------------------------------------------------------------------------

/**
 * Stands in for a capability link in a re-created preview. A new token is not
 * minted just to draw a picture: the link in the real mail was a different
 * token anyway, and a preview has no need for a working credential.
 */
const PRIVATE_LINK = '[private link]';

interface Recreated {
  subject: string;
  html: string;
  text: string;
  notes: string[];
}

const CFP_TEMPLATES = new Set<string>([
  'cfp-received',
  'cfp-accepted',
  'cfp-nudge',
  'cfp-decision-accepted',
  'cfp-decision-declined',
  'cfp-still-open',
  'cfp-accept-notice',
]);

/**
 * Build the mail again from the template and the data as it stands now, or
 * null when the data is gone or the template is one that cannot be rebuilt
 * (a sign-in code, a bulk message, the weekly counts).
 */
export async function recreate(row: Pick<EmailLogRow, 'template' | 'submissionId' | 'registrationId' | 'orderId' | 'atMs' | 'to'>): Promise<Recreated | null> {
  if (CFP_TEMPLATES.has(row.template) && row.submissionId) return recreateCfp(row.template, row.submissionId, row.atMs);
  if (row.template === 'purchase-confirmation' && row.registrationId) return recreateTicket(row.registrationId, row.to);
  return null;
}

async function recreateCfp(template: string, submissionId: string, atMs: number): Promise<Recreated | null> {
  const [sub, raw] = await Promise.all([
    getSubmission(submissionId),
    db().collection(COLLECTIONS.submissions).doc(submissionId).get(),
  ]);
  if (!sub || !raw.exists) return null;
  const s = raw.data() as SubmissionDoc;
  const call = await getCfpCall(sub.callId);
  const tz = call?.timeZone ?? TIME_ZONE;
  const cfp = call?.cfp ?? {};
  const name = sub.author?.name;
  const title = sub.title || 'Untitled';
  const typeLine = sessionTypeLine(sub.sessionType, s.durationMinutes);
  const site = publicSiteOrigin();
  const e2At = ms(s.acceptance?.e2SentAt) ?? atMs;
  const notes = [
    'Built again from the template and the submission as they are today. Wording and dates may differ from what was sent.',
    'Private links are shown as [private link].',
  ];

  switch (template) {
    case 'cfp-received':
      return {
        ...cfpReceivedMessage({
          name,
          title,
          typeLine,
          decisionDay: formatDay(cfp.decisionDate),
          link: `${site}/submit/token/${PRIVATE_LINK}`,
        }),
        notes,
      };
    case 'cfp-accepted':
      return {
        ...cfpAcceptedMessage({
          name,
          title,
          typeLine,
          workshop: sub.sessionType === 'workshop',
          link: `${site}/speaker/${PRIVATE_LINK}`,
          dueDay: dayAfter(e2At, DETAILS_DUE_DAYS, tz),
          sessionNoticeDay: formatDay(cfp.sessionNoticeDate),
        }),
        notes,
      };
    case 'cfp-nudge':
      return {
        ...cfpNudgeMessage({
          name,
          title,
          workshop: sub.sessionType === 'workshop',
          link: `${site}/speaker/${PRIVATE_LINK}`,
          dueDay: dayAfter(e2At, DETAILS_DUE_DAYS, tz),
        }),
        notes,
      };
    case 'cfp-decision-accepted':
      return { ...cfpCloseAcceptedMessage({ name, title }), notes };
    case 'cfp-decision-declined':
      return {
        ...cfpCloseDeclinedMessage({ name, title, reason: s.closeDecision?.reason ?? s.declineReason }),
        notes,
      };
    case 'cfp-still-open':
      return { ...cfpStillOpenMessage({ name, title, decisionDay: formatDay(cfp.decisionDate) }), notes };
    case 'cfp-accept-notice': {
      const acceptedMs = ms(s.acceptance?.at) ?? atMs;
      return {
        ...cfpAcceptNoticeMessage({
          speakerName: name || 'Unknown',
          organisation: sub.author?.affiliation,
          title,
          typeLine,
          acceptedDay: formatDay(dateIn(acceptedMs, tz)) ?? '',
          link: submissionDashboardUrl(submissionId),
          e2: s.acceptance?.e2SentAt ? 'sent' : s.acceptance?.e2HeldForE4 ? 'held' : 'not sent',
        }),
        notes,
      };
    }
    default:
      return null;
  }
}

async function recreateTicket(registrationId: string, to: string): Promise<Recreated | null> {
  const reg = await db().collection(COLLECTIONS.registrations).doc(registrationId).get();
  if (!reg.exists) return null;
  const r = reg.data() as RegistrationDoc & { referralCode?: string };
  if (r.eventId !== EVENT_ID) return null;
  const order = r.orderId ? await db().collection(COLLECTIONS.orders).doc(r.orderId).get() : null;
  const o = order?.exists ? (order.data() as OrderDoc) : undefined;
  const line = o?.items?.find((i) => i.ticketTypeName === r.ticketType);
  const amountCents = line ? line.unitPriceCents : (o?.totalCents ?? 0);
  const orderUrl = `${publicSiteOrigin()}/order/${PRIVATE_LINK}`;
  const message = purchaseConfirmationMessage(
    {
      to: r.email || to,
      name: r.name ?? '',
      ticketType: r.ticketType ?? '',
      amountCents,
      currency: o?.currency ?? 'usd',
      orderUrl,
    },
    inviteForCode(r.referralCode, orderUrl, r.name ?? ''),
  );
  return {
    ...message,
    notes: [
      'Built again from the template, the ticket and the order as they are today. The price is the ticket line on the order, or the order total when there is no matching line.',
      'Private links are shown as [private link].',
    ],
  };
}
