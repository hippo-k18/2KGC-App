/**
 * The checkout reminder (T363) on the emulator: the cron run, its claim, and
 * every reason it must not send. Resend is a stubbed `fetch` that counts
 * requests, so "sent once" is counted at the provider, not in our own log.
 *
 * Run with: npm run test:checkout-reminder
 *
 * Seeds use native `Date`, never `Timestamp`: this file resolves the root
 * `firebase-admin` and the dashboard's store is a different copy (AGENTS.md
 * gotcha 8).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { hubspotPersonKey } from '@kgc/scripts/src/lib/hubspot-sync';
import { contactId } from '@kgc/scripts/src/lib/ids';
import { db } from '@/lib/firestore';
import { planReminders, runCheckoutReminders, saveReminderSettings } from '@/lib/checkout-reminder';
import { REMINDER_SETTINGS_DOC } from '@/lib/checkout-reminder-core';
import { POST } from '@/app/api/cron/checkout-reminder/route';

const H = 3_600_000;
const D = 24 * H;
const ON = Date.UTC(2026, 9, 29, 12);
/** A day and a bit after a checkout that closed an hour after switching on. */
const DUE = ON + H + D + 60_000;

let resendBodies: Record<string, unknown>[] = [];
let resendStatus = 200;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with: npm run test:checkout-reminder');
});

beforeEach(async () => {
  for (const c of [COLLECTIONS.orders, COLLECTIONS.registrations, COLLECTIONS.contacts, COLLECTIONS.emailLog, COLLECTIONS.emailBodies, COLLECTIONS.checkoutReminders, COLLECTIONS.settings, COLLECTIONS.auditLog]) {
    const snap = await db().collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  resendBodies = [];
  resendStatus = 200;
  process.env.RESEND_API_KEY = 're_test_not_real';
  delete process.env.EMAIL_CAPTURE_DIR;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).startsWith('https://api.resend.com/')) throw new Error(`unexpected fetch ${url}`);
      resendBodies.push(JSON.parse(String(init?.body)));
      return resendStatus === 200
        ? new Response(JSON.stringify({ id: `re_${resendBodies.length}` }), { status: 200 })
        : new Response(JSON.stringify({ message: 'refused' }), { status: resendStatus });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

async function switchOn(over: Record<string, unknown> = {}) {
  await db()
    .collection(COLLECTIONS.settings)
    .doc(REMINDER_SETTINGS_DOC)
    .set({ enabled: true, enabledAt: new Date(ON), delayHours: 24, ...over });
}

async function abandoned(id: string, email: string, over: Record<string, unknown> = {}) {
  const at = new Date((over.closedAtMs as number | undefined) ?? ON + H);
  delete over.closedAtMs;
  await db()
    .collection(COLLECTIONS.orders)
    .doc(id)
    .set({ eventId: EVENT_ID, externalId: `cs_${id}`, provider: 'stripe', email, status: 'cancelled', totalCents: 0, refundedCents: 0, currency: 'usd', purchasedAt: at, updatedAt: at, ...over });
}

const record = async (email: string) => (await db().collection(COLLECTIONS.checkoutReminders).doc(hubspotPersonKey(email)).get()).data();

describe('the cron run', () => {
  it('sends nothing while the reminder is off', async () => {
    await abandoned('o1', 'ada@company.com');
    await switchOn({ enabled: false });
    expect(await runCheckoutReminders({ nowMs: DUE })).toMatchObject({ ran: false, sent: 0 });
    expect(resendBodies).toHaveLength(0);
    expect((await db().collection(COLLECTIONS.checkoutReminders).get()).size).toBe(0);
  });

  it('sends one reminder with the name, ticket, footer and one-click unsubscribe, and records it', async () => {
    await switchOn({ replyTo: 'tickets@knowledgegraph.tech' });
    await abandoned('o1', 'ada@company.com', {
      buyerName: 'Ada Lovelace',
      items: [{ ticketTypeId: 'main', ticketTypeName: 'Main Conference', quantity: 2, unitPriceCents: 79900 }],
    });

    expect(await runCheckoutReminders({ nowMs: DUE - 2 * 60_000 })).toMatchObject({ ran: true, sent: 0 });
    expect(resendBodies).toHaveLength(0);

    expect(await runCheckoutReminders({ nowMs: DUE })).toMatchObject({ sent: 1 });
    expect(resendBodies).toHaveLength(1);
    const mail = resendBodies[0] as { from: string; to: string[]; reply_to: string; subject: string; text: string; headers: Record<string, string> };
    expect(mail.from).toBe('Knowledge Graph Conference <contact@knowledgegraph.tech>');
    expect(mail.to).toEqual(['ada@company.com']);
    expect(mail.reply_to).toBe('tickets@knowledgegraph.tech');
    expect(mail.subject).toBe('Your KGC 2027 ticket is still available');
    expect(mail.text).toContain('Hi Ada, you started registering');
    expect(mail.text).toContain('You picked: Main Conference.');
    expect(mail.text).toContain('https://www.knowledgegraph.tech/tickets');
    expect(mail.text).toContain('109 West 39th Street');
    expect(mail.text).toMatch(/Unsubscribe: https:\/\/www\.knowledgegraph\.tech\/u\//);
    expect(mail.headers['List-Unsubscribe']).toMatch(/^<https:\/\/www\.knowledgegraph\.tech\/api\/unsubscribe\//);
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    expect(await record('ada@company.com')).toMatchObject({ status: 'sent', orderId: 'o1', attempts: 1 });
    // The unsubscribe link needs a contact to record against; it was made.
    expect((await db().collection(COLLECTIONS.contacts).doc(contactId('ada@company.com')).get()).data()).toMatchObject({ email: 'ada@company.com', lists: [] });
    const logs = (await db().collection(COLLECTIONS.emailLog).get()).docs.map((d) => d.data());
    expect(logs).toEqual([expect.objectContaining({ template: 'checkout-reminder', status: 'sent', orderId: 'o1', to: 'ada@company.com' })]);

    // Every later run leaves them alone.
    await runCheckoutReminders({ nowMs: DUE + 40 * D });
    expect(resendBodies).toHaveLength(1);
  });

  it('sends once when two runs overlap', async () => {
    await switchOn();
    await abandoned('o1', 'ada@company.com');
    await abandoned('o2', 'bilal@company.com');
    const [a, b] = await Promise.all([runCheckoutReminders({ nowMs: DUE }), runCheckoutReminders({ nowMs: DUE })]);
    expect(a.sent + b.sent).toBe(2);
    expect(resendBodies.map((m) => (m.to as string[])[0]).sort()).toEqual(['ada@company.com', 'bilal@company.com']);
  });

  it('sends one reminder for a person who left several checkouts, about the latest', async () => {
    await switchOn();
    await abandoned('o1', 'ada@company.com', { closedAtMs: ON + H });
    await abandoned('o2', 'Ada@Company.com', { closedAtMs: ON + 2 * H });
    await runCheckoutReminders({ nowMs: DUE + 2 * H });
    expect(resendBodies).toHaveLength(1);
    expect(await record('ada@company.com')).toMatchObject({ status: 'sent', orderId: 'o2' });
  });

  it('never reminds a checkout that closed before the reminder was switched on', async () => {
    await switchOn();
    await abandoned('old', 'ada@company.com', { closedAtMs: ON - H });
    await runCheckoutReminders({ nowMs: ON + 30 * D });
    expect(resendBodies).toHaveLength(0);
  });

  it('switching on through the settings stamps enabledAt, so a backlog is never mailed', async () => {
    await abandoned('old', 'ada@company.com', { closedAtMs: Date.now() - 3 * D });
    await saveReminderSettings({ enabled: true, delayHours: 24, subject: 'S', body: 'B', replyTo: 'contact@knowledgegraph.tech', skipList: [] }, 'owner@kgc.test');
    const s = (await db().collection(COLLECTIONS.settings).doc(REMINDER_SETTINGS_DOC).get()).data();
    // A Timestamp from the dashboard's own firebase-admin: checked by shape, not class.
    expect(typeof s?.enabledAt?.toMillis).toBe('function');
    await runCheckoutReminders({ nowMs: Date.now() + 2 * D });
    expect(resendBodies).toHaveLength(0);
  });

  it('never reminds an invoice, a chargeback or a manual order', async () => {
    await switchOn();
    await abandoned('inv', 'ada@company.com', { channel: 'invoice' });
    await abandoned('cb', 'bilal@company.com', { disputedAt: new Date(ON + H) });
    await abandoned('man', 'chen@company.com', { channel: 'manual' });
    await runCheckoutReminders({ nowMs: DUE });
    expect(resendBodies).toHaveLength(0);
  });

  it('skips, and records why, someone who bought since: a paid order or an active ticket', async () => {
    await switchOn();
    await abandoned('o1', 'ada@company.com');
    await db().collection(COLLECTIONS.orders).doc('paid').set({ eventId: EVENT_ID, email: 'ada@company.com', status: 'paid', channel: 'checkout', totalCents: 79900, currency: 'usd', purchasedAt: new Date(ON + 2 * H), registrationIds: ['r1'] });
    await abandoned('o2', 'bilal@company.com');
    await db().collection(COLLECTIONS.registrations).doc('r2').set({ eventId: EVENT_ID, email: 'someone@else.com', altEmails: ['bilal@company.com'], status: 'active' });

    expect(await runCheckoutReminders({ nowMs: DUE })).toMatchObject({ sent: 0, skipped: 2 });
    expect(resendBodies).toHaveLength(0);
    expect(await record('ada@company.com')).toMatchObject({ status: 'skipped', reason: 'bought a ticket since' });
    expect(await record('bilal@company.com')).toMatchObject({ status: 'skipped', reason: 'bought a ticket since' });
    // The next run does not rewrite the same skip.
    expect(await runCheckoutReminders({ nowMs: DUE + 15 * 60_000 })).toMatchObject({ skipped: 0 });
  });

  it('skips suppressed and test addresses', async () => {
    await switchOn({ skipList: ['staff@kgc.test'] });
    await abandoned('o1', 'gone@company.com');
    await db().collection(COLLECTIONS.contacts).doc(contactId('gone@company.com')).set({ eventId: EVENT_ID, email: 'gone@company.com', lists: [], unsubscribedAt: new Date(ON) });
    await abandoned('o2', 'dead@company.com');
    await db().collection(COLLECTIONS.emailLog).doc('bounce').set({ eventId: EVENT_ID, to: 'dead@company.com', template: 'bulk-message', status: 'sent', subject: 'x', at: new Date(ON), bouncedAt: new Date(ON) });
    await abandoned('o3', 'someone@example.com');
    await abandoned('o4', 'hartigandeely+t167@gmail.com');
    await abandoned('o5', 'staff+x@kgc.test');
    await abandoned('o6', 'owner@kgc.test');

    await runCheckoutReminders({ nowMs: DUE });
    expect(resendBodies.map((b) => b.to)).toEqual([]);
    const plan = await planReminders(DUE);
    expect(Object.fromEntries(plan.rows.map((r) => [r.email, r.decision.kind === 'skip' ? r.decision.reason : r.decision.kind]))).toEqual({
      'gone@company.com': 'unsubscribed',
      'dead@company.com': 'bounced',
      'someone@example.com': 'test address',
      'hartigandeely+t167@gmail.com': 'on the skip list',
      'staff+x@kgc.test': 'on the skip list',
      'owner@kgc.test': 'on the skip list',
    });
  });

  it('retries a failed send on later runs, at most twice', async () => {
    await switchOn();
    await abandoned('o1', 'ada@company.com');
    resendStatus = 422;
    for (let i = 0; i < 5; i++) await runCheckoutReminders({ nowMs: DUE + i * 15 * 60_000 });
    expect(resendBodies).toHaveLength(3);
    expect(await record('ada@company.com')).toMatchObject({ status: 'failed', attempts: 3 });
    // The same mail each time, so Resend's idempotency key would hold.
    expect(new Set(resendBodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  it('sends at most ten a run', async () => {
    await switchOn();
    for (let i = 0; i < 12; i++) await abandoned(`o${i}`, `p${i}@company.com`);
    expect(await runCheckoutReminders({ nowMs: DUE })).toMatchObject({ sent: 10 });
    expect(await runCheckoutReminders({ nowMs: DUE + 15 * 60_000 })).toMatchObject({ sent: 2 });
  });
});

describe('POST /api/cron/checkout-reminder', () => {
  const post = (auth?: string) =>
    POST(new NextRequest('http://127.0.0.1:3100/api/cron/checkout-reminder', { method: 'POST', headers: auth ? { authorization: auth } : {} }));

  it('refuses without the cron secret', async () => {
    expect((await post()).status).toBe(401);
    expect((await post('Bearer wrong-wrong-wrong-wrong')).status).toBe(401);
  });

  it('runs with it, and does nothing while off', async () => {
    await abandoned('o1', 'ada@company.com', { closedAtMs: Date.now() - 2 * D });
    const res = await post(`Bearer ${process.env.CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ran: false, sent: 0 });
    expect(resendBodies).toHaveLength(0);
  });
});
