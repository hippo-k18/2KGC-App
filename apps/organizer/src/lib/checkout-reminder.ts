import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  type CheckoutReminderDoc,
  type CheckoutReminderSettings,
  type ContactDoc,
  type OrderDoc,
  type RegistrationDoc,
} from '@kgc/shared';
import { CHECKOUT_REMINDER_DEFAULTS, sendCheckoutReminder, type SendOutcome } from '@kgc/scripts/src/lib/email';
import { hubspotPersonKey } from '@kgc/scripts/src/lib/hubspot-sync';
import { contactId } from '@kgc/scripts/src/lib/ids';
import { suppressionReasonFor } from './campaigns-core';
import {
  DEFAULT_DELAY_HOURS,
  REMINDER_SETTINGS_DOC,
  SENDS_PER_RUN,
  candidates,
  decide,
  normaliseEmail,
  type Decision,
  type PersonFacts,
  type ReminderOrder,
  type ReminderRecord,
  type ReminderSettings,
} from './checkout-reminder-core';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * The automatic reminder to people who reached the payment page and left
 * without paying (T363). The rules are in `checkout-reminder-core.ts`; this
 * file reads what they need, claims a person, sends and records the result.
 *
 * Run by `POST /api/cron/checkout-reminder` every 15 minutes. Off until an
 * owner switches it on, and then only for checkouts that closed after that.
 */

const CONTACT = 'contact@knowledgegraph.tech';

function settingsRef() {
  return db().collection(COLLECTIONS.settings).doc(REMINDER_SETTINGS_DOC);
}

const ms = (t: unknown): number | undefined => {
  const v = t as { toMillis?: () => number } | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : undefined;
};

export interface ReminderSettingsView extends ReminderSettings {
  enabledBy?: string;
  updatedAtMs?: number;
  updatedBy?: string;
}

/** The saved settings over the defaults. A missing document is "off, default copy". */
export async function readReminderSettings(): Promise<ReminderSettingsView> {
  const d = ((await settingsRef().get()).data() ?? {}) as Partial<CheckoutReminderSettings>;
  return {
    enabled: d.enabled === true,
    enabledAtMs: ms(d.enabledAt),
    enabledBy: d.enabledBy,
    delayHours: typeof d.delayHours === 'number' ? d.delayHours : DEFAULT_DELAY_HOURS,
    subject: d.subject ?? CHECKOUT_REMINDER_DEFAULTS.subject,
    body: d.body ?? CHECKOUT_REMINDER_DEFAULTS.body,
    replyTo: d.replyTo ?? CONTACT,
    skipList: d.skipList ?? [],
    updatedAtMs: ms(d.updatedAt),
    updatedBy: d.updatedBy,
  };
}

/**
 * Save the settings. Switching it on stamps `enabledAt` (now), and only
 * checkouts closed after that are ever reminded; switching it off keeps the
 * old stamp, and switching on again moves it forward.
 */
export async function saveReminderSettings(
  patch: Pick<CheckoutReminderSettings, 'enabled' | 'delayHours' | 'subject' | 'body' | 'replyTo' | 'skipList'>,
  actor: string,
): Promise<{ before: ReminderSettingsView; switchedOn: boolean }> {
  const before = await readReminderSettings();
  const switchedOn = patch.enabled && !before.enabled;
  await settingsRef().set(
    {
      ...patch,
      ...(switchedOn ? { enabledAt: FieldValue.serverTimestamp(), enabledBy: actor } : {}),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    },
    { merge: true },
  );
  return { before, switchedOn };
}

/** Owners from `CONSOLE_ALLOWLIST`: never reminded, whatever they test. */
function owners(): string[] {
  return (process.env.CONSOLE_ALLOWLIST ?? '').split(',').map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'));
}

function toReminderOrder(id: string, o: OrderDoc): ReminderOrder {
  const items = o.items ?? [];
  // When it stopped being payable. A single-seat stub is written at expiry,
  // so `purchasedAt` is that moment; a group cart is written at the start and
  // `updatedAt` moves when the webhook cancels it.
  const closedAtMs = Math.max(ms(o.purchasedAt) ?? 0, ms(o.updatedAt) ?? 0, ms(o.refundedAt) ?? 0);
  return {
    id,
    email: o.email ?? '',
    buyerName: o.buyerName ?? undefined,
    status: o.status,
    channel: o.channel ?? 'checkout',
    disputed: Boolean(o.disputedAt),
    registrationCount: (o.registrationIds ?? []).length,
    ticketNames: items.map((i) => i.ticketTypeName).filter(Boolean),
    closedAtMs,
  };
}

function toRecord(d: CheckoutReminderDoc): ReminderRecord {
  return {
    status: d.status,
    orderId: d.orderId,
    closedAtMs: ms(d.closedAt) ?? 0,
    attempts: d.attempts ?? 0,
    reason: d.reason,
    claimedAtMs: ms(d.claimedAt),
    sentAtMs: ms(d.sentAt),
  };
}

export interface PlanRow {
  email: string;
  key: string;
  decision: Decision;
}

export interface ReminderPlan {
  settings: ReminderSettingsView;
  rows: PlanRow[];
  /** Every reminder record, by person key, for the list's Reminded column. */
  records: Map<string, ReminderRecord>;
  /** Every order the reminder looks at, for the list. */
  orders: ReminderOrder[];
}

/** Has this person bought since, and are they suppressed? Read for candidates only. */
async function factsFor(email: string, orders: readonly ReminderOrder[]): Promise<Omit<PersonFacts, 'reminder'>> {
  const e = normaliseEmail(email);
  let bought = orders.some((o) => normaliseEmail(o.email) === e && (o.status === 'paid' || o.status === 'partially_refunded'));
  if (!bought) {
    const [byEmail, byAlt] = await Promise.all([
      db().collection(COLLECTIONS.registrations).where('email', '==', e).get(),
      db().collection(COLLECTIONS.registrations).where('altEmails', 'array-contains', e).get(),
    ]);
    bought = [...byEmail.docs, ...byAlt.docs].some((d) => {
      const r = d.data() as RegistrationDoc;
      return r.eventId === EVENT_ID && r.status === 'active';
    });
  }

  const contact = await db().collection(COLLECTIONS.contacts).doc(contactId(e)).get();
  const c = contact.exists ? (contact.data() as ContactDoc) : undefined;
  // The suppression rule reads presence only; any truthy value means "set".
  let suppressed: string | null = c
    ? suppressionReasonFor({
        email: e,
        unsubscribedAt: c.unsubscribedAt ? 'set' : undefined,
        bouncedAt: c.bouncedAt ? 'set' : undefined,
        complainedAt: c.complainedAt ? 'set' : undefined,
      })
    : null;
  if (!suppressed) {
    // A bounce or complaint the webhook pinned on a mail with no contact behind it.
    const logs = await db().collection(COLLECTIONS.emailLog).where('to', '==', e).get();
    const bad = logs.docs.map((d) => d.data()).filter((d) => d.eventId === EVENT_ID);
    if (bad.some((d) => d.complainedAt)) suppressed = 'marked as spam';
    else if (bad.some((d) => d.bouncedAt)) suppressed = 'bounced';
  }
  return { bought, suppressed };
}

/** Who is next and when, and who is skipped and why. Reads only; the screen and the run share it. */
export async function planReminders(nowMs: number = Date.now()): Promise<ReminderPlan> {
  const settings = await readReminderSettings();
  const [orderSnap, recordSnap] = await Promise.all([
    db().collection(COLLECTIONS.orders).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.checkoutReminders).where('eventId', '==', EVENT_ID).get(),
  ]);
  const orders = orderSnap.docs.map((d) => toReminderOrder(d.id, d.data() as OrderDoc));
  const records = new Map(recordSnap.docs.map((d) => [d.id, toRecord(d.data() as CheckoutReminderDoc)]));

  const rows: PlanRow[] = [];
  for (const [email, order] of candidates(orders, settings)) {
    const key = hubspotPersonKey(email);
    try {
      const facts: PersonFacts = { ...(await factsFor(email, orders)), reminder: records.get(key) };
      rows.push({ email, key, decision: decide(order, facts, settings, nowMs, owners()) });
    } catch (err) {
      recordError(`checkout-reminder.facts:${order.id}`, err);
    }
  }
  rows.sort((a, b) => a.decision.order.closedAtMs - b.decision.order.closedAtMs);
  return { settings, rows, records, orders };
}

export interface ReminderRun {
  ran: boolean;
  sent: number;
  failed: number;
  skipped: number;
  /** Claimed by another run between the plan and the claim. */
  lost: number;
}

/**
 * Claim the person: in one transaction, read the record again, ask `decide()`
 * again with it, and write `sending`. Only one of two overlapping runs gets
 * past this for the same person.
 */
async function claim(row: PlanRow, facts: Omit<PersonFacts, 'reminder'>, settings: ReminderSettings, nowMs: number): Promise<number | null> {
  const ref = db().collection(COLLECTIONS.checkoutReminders).doc(row.key);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const fresh = snap.exists ? toRecord(snap.data() as CheckoutReminderDoc) : undefined;
    const again = decide(row.decision.order, { ...facts, reminder: fresh }, settings, nowMs, owners());
    if (again.kind !== 'send') return null;
    const o = again.order;
    tx.set(ref, {
      eventId: EVENT_ID,
      email: row.email,
      orderId: o.id,
      closedAt: Timestamp.fromMillis(o.closedAtMs),
      status: 'sending',
      attempts: again.attempt,
      claimedAt: Timestamp.fromMillis(nowMs),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return again.attempt;
  });
}

/** Record a skip, only when it says something new: a run every 15 minutes must not rewrite the same row. */
async function recordSkip(row: PlanRow, reason: string, existing: ReminderRecord | undefined): Promise<boolean> {
  const o = row.decision.order;
  if (existing?.status === 'skipped' && existing.reason === reason && existing.orderId === o.id) return false;
  // Never overwrite a sent reminder's record: "reminded in the last 30 days" is about that send.
  if (existing?.status === 'sent' || existing?.status === 'sending') return false;
  await db()
    .collection(COLLECTIONS.checkoutReminders)
    .doc(row.key)
    .set({
      eventId: EVENT_ID,
      email: row.email,
      orderId: o.id,
      closedAt: Timestamp.fromMillis(o.closedAtMs),
      status: 'skipped',
      reason,
      attempts: 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
  return true;
}

/** One cron run: send what is due, at most `limit`, and record the skips. Nothing at all while off. */
export async function runCheckoutReminders(opts: { nowMs?: number; limit?: number } = {}): Promise<ReminderRun> {
  const nowMs = opts.nowMs ?? Date.now();
  const limit = opts.limit ?? SENDS_PER_RUN;
  const run: ReminderRun = { ran: false, sent: 0, failed: 0, skipped: 0, lost: 0 };
  const settings = await readReminderSettings();
  if (!settings.enabled || settings.enabledAtMs === undefined) return run;
  run.ran = true;

  const plan = await planReminders(nowMs);
  for (const row of plan.rows) {
    const d = row.decision;
    if (d.kind === 'skip') {
      if (await recordSkip(row, d.reason, plan.records.get(row.key))) run.skipped++;
      continue;
    }
    if (d.kind !== 'send' || run.sent + run.failed >= limit) continue;

    let attempt: number | null;
    try {
      attempt = await claim(row, await factsFor(row.email, plan.orders), plan.settings, nowMs);
    } catch (err) {
      recordError(`checkout-reminder.claim:${row.key}`, err);
      continue;
    }
    if (attempt === null) {
      run.lost++;
      continue;
    }

    const o = d.order;
    let outcome: SendOutcome;
    try {
      outcome = await sendCheckoutReminder(db(), {
        to: row.email,
        name: o.buyerName,
        ticketNames: o.ticketNames,
        subject: settings.subject,
        body: settings.body,
        replyTo: settings.replyTo,
        orderId: o.id,
        issuedAt: o.closedAtMs,
      });
    } catch (err) {
      recordError(`checkout-reminder.send:${row.key}`, err);
      outcome = 'failed';
    }

    const ref = db().collection(COLLECTIONS.checkoutReminders).doc(row.key);
    if (outcome === 'sent') {
      await ref.update({ status: 'sent', sentAt: FieldValue.serverTimestamp(), reason: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      run.sent++;
    } else {
      // `skipped` from send() means this deployment has no Resend key: a try that did not reach anybody.
      await ref.update({
        status: 'failed',
        reason: outcome === 'skipped' ? 'email is not switched on for the dashboard' : 'the email provider refused it, see the Email Log',
        updatedAt: FieldValue.serverTimestamp(),
      });
      run.failed++;
    }
  }
  return run;
}

/**
 * Send me a test: the copy on the form to the signed-in owner, with a sample
 * ticket and no name, so it shows how "Hi {first name}," reads when no name
 * is known. Nothing is claimed or recorded but the Email Log row.
 */
export async function sendReminderTest(to: string, copy: Pick<ReminderSettings, 'subject' | 'body' | 'replyTo'>, actor: string): Promise<SendOutcome> {
  return sendCheckoutReminder(db(), {
    to,
    ticketNames: ['Main Conference'],
    subject: copy.subject,
    body: copy.body,
    replyTo: copy.replyTo,
    issuedAt: Date.now(),
    actor,
    test: true,
  });
}
