import type { EmailLogDoc } from '@kgc/shared';

/**
 * The Email Log's arithmetic (T274), apart from Firestore so it can be tested
 * (`server-only` and Vitest do not mix; see AGENTS.md). `email-log.ts` reads,
 * this decides what a row is called, which rows a filter keeps and where a row
 * links to.
 */

export type EmailTemplate = EmailLogDoc['template'];
export type EmailStatus = EmailLogDoc['status'];

export type EmailGroup = 'cfp' | 'tickets' | 'sign-in' | 'messages' | 'speakers' | 'blog' | 'team';

export const GROUP_LABEL: Record<EmailGroup, string> = {
  cfp: 'Call for speakers',
  tickets: 'Tickets',
  'sign-in': 'Sign-in codes',
  messages: 'Campaigns and messages',
  speakers: 'Speakers, sponsors and exhibitors',
  blog: 'Blog',
  team: 'Dashboard team',
};

/**
 * Every email the system sends, by the name an organizer would use. Typed as
 * a full record so a template added to `EmailLogDoc` without a name here fails
 * the build instead of showing a raw id.
 */
export const TEMPLATE_INFO: Record<EmailTemplate, { label: string; group: EmailGroup }> = {
  'cfp-received': { label: 'E1 Submission received', group: 'cfp' },
  'cfp-accepted': { label: 'E2 Accepted, send your details', group: 'cfp' },
  'cfp-nudge': { label: 'E3 Details reminder', group: 'cfp' },
  'cfp-decision-accepted': { label: 'E4 Accepted after the close', group: 'cfp' },
  'cfp-decision-declined': { label: 'E4 Not accepted', group: 'cfp' },
  'cfp-still-open': { label: 'E6 Still open', group: 'cfp' },
  'cfp-accept-notice': { label: 'Acceptance notice to onboarding', group: 'cfp' },
  'cfp-weekly-reminder': { label: 'Thursday review reminder', group: 'cfp' },
  'submission-receipt': { label: 'Submission received (other calls)', group: 'cfp' },
  'submission-decision': { label: 'Submission decision (other calls)', group: 'cfp' },
  'reviewer-invitation': { label: 'Reviewer invitation', group: 'cfp' },
  'purchase-confirmation': { label: 'Ticket confirmation', group: 'tickets' },
  'extra-added': { label: 'Extra added to ticket', group: 'tickets' },
  'invoice-raised': { label: 'Invoice raised', group: 'tickets' },
  'refund-confirmation': { label: 'Refund confirmation', group: 'tickets' },
  'ticket-cancelled': { label: 'Ticket cancelled', group: 'tickets' },
  'sign-in-code': { label: 'App sign-in code', group: 'sign-in' },
  'ticket-sign-in-code': { label: 'Website sign-in code', group: 'sign-in' },
  'dashboard-sign-in-code': { label: 'Dashboard sign-in code', group: 'sign-in' },
  'blog-sign-in-code': { label: 'Blog sign-in code', group: 'sign-in' },
  'bulk-message': { label: 'Campaign or message', group: 'messages' },
  'consent-request': { label: 'Consent form request', group: 'messages' },
  'speaker-profile-request': { label: 'Speaker profile request', group: 'speakers' },
  'exhibitor-lead-link': { label: 'Exhibitor lead link', group: 'speakers' },
  'blog-invitation': { label: 'Blog invitation', group: 'blog' },
  'blog-review-request': { label: 'Blog review request', group: 'blog' },
  'blog-review-decision': { label: 'Blog review decision', group: 'blog' },
  'team-invitation': { label: 'Team invitation', group: 'team' },
};

export const TEMPLATES = Object.keys(TEMPLATE_INFO) as EmailTemplate[];

export function templateLabel(template: string): string {
  return TEMPLATE_INFO[template as EmailTemplate]?.label ?? template;
}

export function isTemplate(value: string | undefined): value is EmailTemplate {
  return Boolean(value) && value! in TEMPLATE_INFO;
}

export function isGroup(value: string | undefined): value is EmailGroup {
  return Boolean(value) && value! in GROUP_LABEL;
}

/** One `emailLog` row as the screen reads it. Times are epoch ms. */
export interface EmailLogRow {
  id: string;
  atMs: number;
  to: string;
  subject: string;
  template: string;
  status: EmailStatus;
  error?: string;
  reason?: string;
  attempts?: number;
  bounced?: boolean;
  complained?: boolean;
  orderId?: string;
  registrationId?: string;
  campaignId?: string;
  submissionId?: string;
  actor?: string;
  hasBody: boolean;
}

export interface EmailLogFilters {
  /** `YYYY-MM-DD` in New York, inclusive. */
  from?: string;
  to?: string;
  template?: EmailTemplate;
  group?: EmailGroup;
  status?: EmailStatus;
  /** Matched against the recipient, the subject and the related ids. */
  q?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the filters from a query string, dropping anything malformed. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): EmailLogFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const status = one('status');
  // The Email select sends `type=group:cfp` for a whole group; `group=cfp` is the same.
  const type = one('type');
  const template = type?.startsWith('group:') ? undefined : type;
  const group = type?.startsWith('group:') ? type.slice('group:'.length) : one('group');
  const from = one('from');
  const to = one('to');
  return {
    ...(from && ISO_DATE.test(from) ? { from } : {}),
    ...(to && ISO_DATE.test(to) ? { to } : {}),
    ...(isTemplate(template) ? { template } : {}),
    ...(isGroup(group) ? { group } : {}),
    ...(status === 'sent' || status === 'failed' || status === 'skipped' ? { status } : {}),
    ...(one('q') ? { q: one('q') } : {}),
  };
}

/**
 * The instant a New York calendar day starts, in epoch ms. Done with the
 * zone's own offset at that date, so a range across the November clock change
 * starts each day at local midnight.
 */
export function dayStartMs(isoDate: string, timeZone: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utcGuess = Date.UTC(y, m - 1, d);
  const offset = zoneOffsetMs(utcGuess, timeZone);
  // Correct once more in case the offset differs at the shifted instant.
  const first = utcGuess - offset;
  return utcGuess - zoneOffsetMs(first, timeZone);
}

/** How far ahead of UTC `timeZone` is at `ms` (negative west of Greenwich). */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** `[start, end)` in epoch ms for the filter's dates; either end may be open. */
export function rangeMs(filters: Pick<EmailLogFilters, 'from' | 'to'>, timeZone: string): {
  startMs?: number;
  endMs?: number;
} {
  const startMs = filters.from ? dayStartMs(filters.from, timeZone) : undefined;
  let endMs: number | undefined;
  if (filters.to) {
    const [y, m, d] = filters.to.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    endMs = dayStartMs(next, timeZone);
  }
  return { startMs, endMs };
}

/** The rows a filter keeps, newest first. */
export function filterRows(rows: readonly EmailLogRow[], f: EmailLogFilters, timeZone: string): EmailLogRow[] {
  const { startMs, endMs } = rangeMs(f, timeZone);
  const q = f.q?.toLowerCase();
  return rows
    .filter((r) => {
      if (startMs !== undefined && r.atMs < startMs) return false;
      if (endMs !== undefined && r.atMs >= endMs) return false;
      if (f.template && r.template !== f.template) return false;
      if (f.group && TEMPLATE_INFO[r.template as EmailTemplate]?.group !== f.group) return false;
      if (f.status && r.status !== f.status) return false;
      if (q) {
        const hay = [r.to, r.subject, r.submissionId, r.orderId, r.campaignId, r.actor]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.atMs - a.atMs);
}

/** "18 Oct 2026, 14:02" in the event's zone. */
export function formatWhen(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(ms));
}

/** The long form for a preview header: "Sun, Oct 18, 2026, 2:02 PM EDT", as Gmail writes it. */
export function formatWhenLong(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(ms));
}

const CFA = '/content/call-for-speakers-abstracts';

/** Where a row's "related" link goes, or null when it is about nothing on the dashboard. */
export function relatedLink(r: Pick<EmailLogRow, 'submissionId' | 'orderId' | 'campaignId' | 'template'>): {
  href: string;
  label: string;
} | null {
  if (r.submissionId) return { href: `${CFA}/submissions/${encodeURIComponent(r.submissionId)}`, label: 'Submission' };
  if (r.orderId) {
    return {
      href: `/tickets/orders-and-transactions/attendee-orders?q=${encodeURIComponent(r.orderId)}`,
      label: 'Order',
    };
  }
  if (r.template === 'cfp-weekly-reminder') return { href: `${CFA}/rolling-review`, label: 'Review list' };
  return null;
}

/** The status cell's words: "Sent", "Failed: 422 invalid address", and so on. */
export function statusDetail(r: Pick<EmailLogRow, 'status' | 'error' | 'reason' | 'bounced' | 'complained'>): string | null {
  if (r.status === 'failed') return r.error ?? null;
  if (r.status === 'skipped') return r.reason ?? null;
  if (r.complained) return 'Marked as spam by the recipient.';
  if (r.bounced) return 'Accepted, then bounced.';
  return null;
}

export const EMAIL_LOG_PATH = '/tools/email-log';

/** "Knowledge Graph Conference <hello@knowledgegraph.tech>" → its two halves. */
export function splitAddress(value: string): { name: string; address: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (m) return { name: m[1].trim() || m[2], address: m[2].trim() };
  return { name: value.trim(), address: value.trim() };
}

/** Puts `<base target="_blank">` first in the head so every link leaves the frame. */
export function framedHtml(html: string): string {
  const base = '<base target="_blank">';
  // `<head>` or `<head lang=…>`, never `<header>`.
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (tag) => `${tag}${base}`);
  return `<!doctype html><html><head><meta charset="utf-8">${base}</head><body>${html}</body></html>`;
}
