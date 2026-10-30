import { CHECKOUT_REMINDER_INTERVAL_DAYS, type CheckoutReminderDoc } from '@kgc/shared';

/**
 * The checkout reminder's decisions (T363), with no Firestore in sight so
 * every rule is a unit test: who left the payment page, who is due, who is
 * skipped and why, and whether a run may send.
 *
 * The server half (`checkout-reminder.ts`) reads the data, asks `decide()`,
 * and claims the person in a transaction that asks `decide()` again on the
 * fresh record. Two runs therefore agree on the rules and only one can claim.
 */

/** `settings/{this}`. */
export const REMINDER_SETTINGS_DOC = 'checkoutReminder';
export const DEFAULT_DELAY_HOURS = 24;
/** One reminder per person in this window, whatever they abandon in it. */
export const REMIND_AGAIN_AFTER_DAYS = CHECKOUT_REMINDER_INTERVAL_DAYS;
/** The first try and at most two retries on later runs. */
export const MAX_ATTEMPTS = 3;
/** A `sending` claim older than this was a run that died mid-send; it counts as a failed try. */
export const SENDING_LEASE_MS = 10 * 60 * 1000;
/** Sends per run. The timer runs every 15 minutes, so a backlog drains in hours, not one burst. */
export const SENDS_PER_RUN = 10;
/**
 * Always skipped, whatever the editable list says: the owner's own test
 * checkouts (T167 and T176 used `hartigandeely+t…@gmail.com`).
 */
export const ALWAYS_SKIP = ['hartigandeely@gmail.com'];

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** The settings as the core reads them: times in milliseconds. */
export interface ReminderSettings {
  enabled: boolean;
  enabledAtMs?: number;
  delayHours: number;
  subject: string;
  body: string;
  replyTo: string;
  skipList: string[];
}

/** One order as the reminder sees it. `closedAtMs` is when the checkout stopped being payable. */
export interface ReminderOrder {
  id: string;
  email: string;
  buyerName?: string;
  status: string;
  channel: string;
  disputed: boolean;
  registrationCount: number;
  ticketNames: string[];
  closedAtMs: number;
}

/** The reminder record for a person, as the core reads it. */
export interface ReminderRecord {
  status: CheckoutReminderDoc['status'];
  orderId: string;
  closedAtMs: number;
  attempts: number;
  reason?: string;
  claimedAtMs?: number;
  sentAtMs?: number;
}

/** What is known about the person behind an order, read for the candidates only. */
export interface PersonFacts {
  /** Holds a paid or partly refunded order, or an active ticket. */
  bought: boolean;
  /** Holds an invoice order still waiting to be paid: they chose to pay another way (T366). */
  invoicePending?: boolean;
  /** `suppressionReasonFor` on their contact, or a bounce or complaint on any mail to them. */
  suppressed: string | null;
  reminder?: ReminderRecord;
}

export type Decision =
  | { kind: 'send'; order: ReminderOrder; attempt: number }
  | { kind: 'wait'; order: ReminderOrder; dueAtMs: number }
  | { kind: 'skip'; order: ReminderOrder; reason: string }
  /** Nothing to do: already sent, in flight, or out of tries. `note` says which, for the screen. */
  | { kind: 'done'; order: ReminderOrder; note: string };

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `ada+kgc@x.com` → `ada@x.com`. */
export function baseAddress(email: string): string {
  const e = normaliseEmail(email);
  const at = e.lastIndexOf('@');
  if (at < 0) return e;
  return `${e.slice(0, at).split('+')[0]}${e.slice(at)}`;
}

/** Why an address is one we never remind, or null. */
export function testAddressReason(email: string, skipList: readonly string[], owners: readonly string[] = []): string | null {
  const e = normaliseEmail(email);
  const domain = e.slice(e.lastIndexOf('@') + 1);
  const local = e.slice(0, e.lastIndexOf('@'));
  if (domain === 'example.com' || domain === 'example.org' || /\+test/.test(local)) return 'test address';
  const base = baseAddress(e);
  const listed = [...ALWAYS_SKIP, ...skipList, ...owners].map(baseAddress);
  if (listed.includes(base)) return 'on the skip list';
  return null;
}

/** A checkout that was started on the payment page and never paid, with somebody to write to. */
export function isRemindable(o: ReminderOrder): boolean {
  return (
    o.status === 'cancelled' &&
    !o.disputed &&
    o.registrationCount === 0 &&
    // Invoices have a billing contact and Stripe chases them; manual and demo were never on the payment page.
    o.channel === 'checkout' &&
    Boolean(o.email)
  );
}

/**
 * What this person's own orders say, matched on `baseAddress`: a paid or
 * partly refunded order means they bought; an invoice still pending means
 * they chose to pay another way and are waiting on it.
 */
export function orderFacts(orders: readonly ReminderOrder[], email: string): { bought: boolean; invoicePending: boolean } {
  const base = baseAddress(email);
  const mine = orders.filter((o) => o.email && baseAddress(o.email) === base);
  return {
    bought: mine.some((o) => o.status === 'paid' || o.status === 'partially_refunded'),
    invoicePending: mine.some((o) => o.status === 'pending' && o.channel === 'invoice'),
  };
}

/** The addresses to look a person up under: as typed, and without the `+tag`. */
export function lookupAddresses(email: string): string[] {
  return [...new Set([normaliseEmail(email), baseAddress(email)])];
}

/**
 * The latest remindable checkout per person that closed after the reminder
 * was switched on. Before `enabledAt` nothing is a candidate, so switching it
 * on never mails a backlog, and while it is off nobody is (T366: the screen
 * listed people as due on the next run of a switched-off reminder).
 *
 * Keyed by `baseAddress`, so `ada+kgc@x` and `ada@x` are one person.
 */
export function candidates(
  orders: readonly ReminderOrder[],
  settings: Pick<ReminderSettings, 'enabled' | 'enabledAtMs'>,
): Map<string, ReminderOrder> {
  const out = new Map<string, ReminderOrder>();
  if (!settings.enabled || settings.enabledAtMs === undefined) return out;
  for (const o of orders) {
    if (!isRemindable(o) || o.closedAtMs < settings.enabledAtMs) continue;
    const key = baseAddress(o.email);
    const prev = out.get(key);
    if (!prev || o.closedAtMs > prev.closedAtMs) out.set(key, o);
  }
  return out;
}

/**
 * What to do about one person's latest checkout, now.
 *
 * The order of the checks is the order of the reasons on the screen: a person
 * who has since bought is "bought since" even if they also unsubscribed.
 * Every address comparison folds case and `+tag` (`baseAddress`).
 */
export function decide(
  order: ReminderOrder,
  facts: PersonFacts,
  settings: Pick<ReminderSettings, 'delayHours' | 'skipList'>,
  nowMs: number,
  owners: readonly string[] = [],
): Decision {
  const r = facts.reminder;

  // What an earlier run did comes first: a sent reminder is never undone by
  // a later skip reason, and a claim in flight belongs to that run.
  let attempt = 1;
  if (r) {
    if (r.status === 'sent') {
      const sentAt = r.sentAtMs ?? 0;
      if (r.orderId === order.id || order.closedAtMs <= sentAt) return { kind: 'done', order, note: 'reminded' };
      if (nowMs - sentAt < REMIND_AGAIN_AFTER_DAYS * DAY) return { kind: 'skip', order, reason: `reminded in the last ${REMIND_AGAIN_AFTER_DAYS} days` };
    } else if (r.status === 'sending' && nowMs - (r.claimedAtMs ?? 0) < SENDING_LEASE_MS) {
      return { kind: 'done', order, note: 'sending now' };
    } else if ((r.status === 'failed' || r.status === 'sending') && r.orderId === order.id) {
      if (r.attempts >= MAX_ATTEMPTS) return { kind: 'done', order, note: `not sent after ${r.attempts} tries` };
      attempt = r.attempts + 1;
    }
  }

  if (facts.bought) return { kind: 'skip', order, reason: 'bought a ticket since' };
  if (facts.invoicePending) return { kind: 'skip', order, reason: 'invoice pending' };
  const test = testAddressReason(order.email, settings.skipList, owners);
  if (test) return { kind: 'skip', order, reason: test };
  if (facts.suppressed) return { kind: 'skip', order, reason: facts.suppressed };

  const dueAtMs = order.closedAtMs + settings.delayHours * HOUR;
  if (nowMs < dueAtMs) return { kind: 'wait', order, dueAtMs };
  return { kind: 'send', order, attempt };
}

/** The "Reminded" cell for one order on the list. */
export function reminderCell(orderId: string, r: (ReminderRecord & { sentAtMs?: number }) | undefined): { text: string; at?: number } | null {
  if (!r) return null;
  if (r.orderId !== orderId) return r.status === 'sent' && r.sentAtMs ? { text: 'Reminded for another checkout', at: r.sentAtMs } : null;
  switch (r.status) {
    case 'sent':
      return { text: 'Reminded', at: r.sentAtMs };
    case 'sending':
      return { text: 'Sending' };
    case 'failed':
      return { text: r.attempts >= MAX_ATTEMPTS ? `Not sent after ${r.attempts} tries` : `Not sent yet (try ${r.attempts} failed)` };
    case 'skipped':
      return { text: `Skipped: ${r.reason ?? 'no reason recorded'}` };
  }
}

/** Plain-text checks on the editable settings. Returns the problems, or none. */
export function checkSettings(input: { delayHours: number; subject: string; body: string; replyTo: string }): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(input.delayHours) || input.delayHours < 1 || input.delayHours > 720) {
    problems.push('Hours to wait must be a whole number from 1 to 720.');
  }
  if (!input.subject.trim()) problems.push('The subject is empty.');
  if (input.subject.length > 150) problems.push('The subject is longer than 150 characters.');
  if (!input.body.trim()) problems.push('The message is empty.');
  if (input.body.length > 3000) problems.push('The message is longer than 3,000 characters. Keep it short.');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.replyTo.trim())) problems.push('Reply-to is not an email address.');
  return problems;
}

/** One address per line or comma, normalised, de-duplicated. */
export function parseSkipList(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map(normaliseEmail).filter((e) => e.includes('@')))];
}
