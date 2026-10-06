/**
 * What the dashboard does to orders: manual orders, erasing a person, and the
 * abandoned-checkout list (T135, T136). Real dashboard code against the
 * Firestore emulator; email is unset, so confirmations log as skipped.
 *
 * Run with: npm run test:dashboard-orders
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireOrganizer: async () => 'organizer@example.com',
  requirePassphrase: () => false,
}));
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type OrderDoc, type RegistrationDoc } from '@kgc/shared';
import { registrationId } from '@kgc/scripts/src/lib/ids';
import { db as dashDb } from '@/lib/firestore';
import { isAbandoned } from '@/lib/commerce';
import { recordManualOrder } from '@/lib/manual-orders';
import { erasePerson, resolvePerson } from '@/lib/person-data';

let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:dashboard-orders');
  }
  db = dashDb() as unknown as Firestore;
});

async function wipe(collection: string) {
  const snap = await db.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  delete process.env.RESEND_API_KEY;
  await Promise.all(
    [COLLECTIONS.registrations, COLLECTIONS.orders, COLLECTIONS.ticketTypes, COLLECTIONS.auditLog, COLLECTIONS.emailLog, COLLECTIONS.users, COLLECTIONS.stripeIgnored].map(wipe),
  );
  for (const [id, name, total] of [
    ['main-conference', 'Main Conference', 100],
    ['virtual', 'Virtual', 100],
    ['platinum', 'Platinum Sponsor', 1],
  ] as const) {
    await db.collection(COLLECTIONS.ticketTypes).doc(id).set({
      eventId: EVENT_ID,
      name,
      priceCents: 50_000,
      currency: 'usd',
      quantityTotal: total,
      quantitySold: 0,
    });
  }
});

const sold = async (tier: string) => (await db.collection(COLLECTIONS.ticketTypes).doc(tier).get()).data()?.quantitySold;
const manualOrders = async () =>
  (await db.collection(COLLECTIONS.orders).where('channel', '==', 'manual').get()).docs.map((d) => d.data() as OrderDoc);

const manual = (over: Partial<Parameters<typeof recordManualOrder>[0]> = {}) =>
  recordManualOrder({
    email: 'ada@example.com',
    name: 'Ada Nakamura',
    ticketTypeId: 'main-conference',
    amountCents: 50_000,
    note: 'Cheque 1001',
    actor: 'organizer@example.com',
    ...over,
  });

describe('manual orders (S8/TK-283, N1)', () => {
  it('a second order for the same person and package adds a ticket, and keeps the first order', async () => {
    expect((await manual({ requestId: 'req-first-0001' })).ok).toBe(true);
    expect((await manual({ requestId: 'req-second-002', amountCents: 20_000, note: 'Wire 2002' })).ok).toBe(true);

    const orders = await manualOrders();
    expect(orders.map((o) => [o.totalCents, o.outOfBandNote]).sort()).toEqual([
      [20_000, 'Wire 2002'],
      [50_000, 'Cheque 1001'],
    ]);
    expect(await sold('main-conference')).toBe(2);
    const regs = await db.collection(COLLECTIONS.registrations).where('email', '==', 'ada@example.com').get();
    expect(regs.size).toBe(2);
    expect(new Set(orders.flatMap((o) => o.registrationIds)).size).toBe(2);
  });

  it('the same form posted twice at once is one order and one seat', async () => {
    const [a, b] = await Promise.all([manual({ requestId: 'req-double-001' }), manual({ requestId: 'req-double-001' })]);
    expect(a.ok && b.ok).toBe(true);
    expect(await manualOrders()).toHaveLength(1);
    expect(await sold('main-conference')).toBe(1);
  });

  it('refuses a sold-out package instead of issuing a ticket past capacity', async () => {
    expect((await manual({ ticketTypeId: 'platinum', email: 'acme@example.com', requestId: 'req-plat-0001' })).ok).toBe(true);
    const second = await manual({ ticketTypeId: 'platinum', email: 'globex@example.com', requestId: 'req-plat-0002' });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/sold out/);
    expect(await sold('platinum')).toBe(1);
    expect(await manualOrders()).toHaveLength(1);
  });

  it('gives somebody who already holds a paid ticket a second ticket, not a rewritten one (N1)', async () => {
    const rid = registrationId('ada@example.com');
    await db.collection(COLLECTIONS.orders).doc('ord_paid_virtual').set({
      eventId: EVENT_ID, externalId: 'cs_x', provider: 'stripe', channel: 'checkout', email: 'ada@example.com',
      status: 'paid', totalCents: 12_900, currency: 'usd', registrationIds: [rid],
      items: [{ ticketTypeId: 'virtual', ticketTypeName: 'Virtual', quantity: 1, unitPriceCents: 12_900 }],
    });
    await db.collection(COLLECTIONS.registrations).doc(rid).set({
      eventId: EVENT_ID, email: 'ada@example.com', name: 'Ada Nakamura', ticketType: 'Virtual', status: 'active',
      orderId: 'ord_paid_virtual', seat: 0, claimCode: 'ABCD-EFGH', qrSecret: 'q'.repeat(32), altEmails: [],
    });

    const res = await manual({ requestId: 'req-n1-000001' });
    expect(res.ok).toBe(true);
    expect(res.registrationId).not.toBe(rid);
    expect(((await db.collection(COLLECTIONS.registrations).doc(rid).get()).data() as RegistrationDoc).ticketType).toBe('Virtual');
  });
});

describe('erasing a person (TK-502)', () => {
  it('gives their seat back and takes their ticket off the order, which stays paid', async () => {
    const res = await manual({ requestId: 'req-erase-0001' });
    const rid = res.registrationId!;
    expect(await sold('main-conference')).toBe(1);

    const identity = await resolvePerson({ registrationId: rid });
    const erased = await erasePerson(identity!, 'ada@example.com', 'organizer@example.com');
    expect(erased.ok).toBe(true);

    expect((await db.collection(COLLECTIONS.registrations).doc(rid).get()).exists).toBe(false);
    expect(await sold('main-conference')).toBe(0);
    const [order] = await manualOrders();
    expect(order.status).toBe('paid');
    expect(order.registrationIds).toEqual([]);
    expect(order.erasedRegistrationIds).toEqual([rid]);
    expect(order.releasedSeats).toEqual({ [rid]: 'main-conference' });
    expect(order.email).toBeFalsy();
  });

  it('leaves Attendee Orders and the email log readable afterwards (T138B, TK-301)', async () => {
    const res = await manual({ requestId: 'req-erase-0002' });
    await manual({ requestId: 'req-other-0001', email: 'ben@example.com', name: 'Ben Olsen' });
    const identity = await resolvePerson({ registrationId: res.registrationId! });
    await erasePerson(identity!, 'ada@example.com', 'organizer@example.com');
    // An emailLog row whose recipient was erased.
    await db.collection(COLLECTIONS.emailLog).add({ eventId: EVENT_ID, to: null, template: 'purchase-confirmation', subject: 'x', status: 'sent', at: new Date() });

    const { listOrders, recentEmails } = await import('@/lib/commerce');
    const rows = await listOrders();
    expect(rows.map((r) => typeof r.email)).toEqual(['string', 'string']);
    expect((await recentEmails()).every((e) => typeof e.to === 'string')).toBe(true);

    const { renderToStaticMarkup } = await import('../../apps/organizer/node_modules/react-dom/server.js');
    const { default: AttendeeOrdersPage } = await import('@/app/(dash)/tickets/orders-and-transactions/attendee-orders/page');
    for (const q of ['', 'ben']) {
      const el = await AttendeeOrdersPage({ searchParams: Promise.resolve(q ? { q } : {}) });
      const html = renderToStaticMarkup(el);
      expect(html).toContain('ben@');
    }
  });
});

describe('abandoned checkouts (TK-303)', () => {
  const row = (over: Partial<Parameters<typeof isAbandoned>[0]>) => ({ status: 'cancelled' as const, registrationIds: [], ...over });

  it('lists an unpaid cancelled checkout', () => {
    expect(isAbandoned(row({}))).toBe(true);
  });

  it('leaves out a paid order a chargeback cancelled, with or without disputedAt', () => {
    expect(isAbandoned(row({ disputedAt: '2026-10-01T12:00:00.000Z' }))).toBe(false);
    expect(isAbandoned(row({ registrationIds: ['reg_1'] }))).toBe(false);
  });

  it('leaves out every other status', () => {
    expect(isAbandoned(row({ status: 'paid' }))).toBe(false);
    expect(isAbandoned(row({ status: 'pending' }))).toBe(false);
  });
});

describe('sales figures count ticket orders only (T142)', () => {
  it('leaves a refund stub with no ticket line out of revenue', async () => {
    await manual({ requestId: 'req-sale-000001' });
    // What a Payment Link refund wrote before T136: no lines, only a refunded amount.
    await db.collection(COLLECTIONS.orders).doc('ord_stub').set({
      eventId: EVENT_ID, externalId: 'cs_plink', provider: 'stripe', email: '', status: 'refunded',
      totalCents: 0, refundedCents: 17_500, currency: 'usd', purchasedAt: new Date(),
    });
    const { salesSummary } = await import('@/lib/commerce');
    const sales = await salesSummary();
    expect(sales.grossCents).toBe(50_000);
    expect(sales.refundedCents).toBe(0);
    expect(sales.netCents).toBe(50_000);
  });

  it('lists ignored Stripe activity, newest first, and none of it as an order', async () => {
    await db.collection(COLLECTIONS.stripeIgnored).doc('a').set({ eventId: EVENT_ID, eventType: 'invoice.paid', kind: 'invoice', stripeId: 'in_1', amountCents: 500_000, currency: 'usd', email: null, at: new Date('2026-10-01T12:00:00Z') });
    await db.collection(COLLECTIONS.stripeIgnored).doc('b').set({ eventId: EVENT_ID, eventType: 'checkout.session.completed', kind: 'payment', stripeId: 'cs_1', amountCents: 250_000, currency: 'usd', email: 'sponsor@example.com', at: new Date('2026-10-02T12:00:00Z') });
    const { recentIgnoredStripe, listOrders } = await import('@/lib/commerce');
    const rows = await recentIgnoredStripe();
    expect(rows.map((r) => r.stripeId)).toEqual(['cs_1', 'in_1']);
    expect(rows[1].email).toBeUndefined();
    expect(await listOrders()).toHaveLength(0);
  });
});

describe('Workshops recorded from the dashboard (T169)', () => {
  beforeEach(async () => {
    await db.collection(COLLECTIONS.ticketTypes).doc('workshops').set({
      eventId: EVENT_ID, name: 'Workshops', priceCents: 19_900, currency: 'usd', quantitySold: 0,
      kind: 'extra', addOnFor: 'main-conference', includesWorkshops: true,
    });
    await db.collection(COLLECTIONS.ticketTypes).doc('all-access').set({
      eventId: EVENT_ID, name: 'All Access (VIP)', priceCents: 69_900, currency: 'usd', quantitySold: 0,
      includesWorkshops: true,
    });
  });

  const workshops = (over: Partial<Parameters<typeof recordManualOrder>[0]> = {}) =>
    manual({ ticketTypeId: 'workshops', amountCents: 19_900, note: 'Cheque 3003', ...over });

  it('refuses Workshops for somebody with no Main Conference, and records nothing', async () => {
    const res = await workshops({ requestId: 'req-ws-none-01' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Workshops is added to a Main Conference ticket, and ada@example.com has none/);
    expect(await manualOrders()).toHaveLength(0);
    expect(await sold('workshops')).toBe(0);
  });

  it('refuses Workshops for an All Access holder and for Virtual', async () => {
    expect((await manual({ ticketTypeId: 'all-access', requestId: 'req-ws-aa-0001' })).ok).toBe(true);
    expect((await workshops({ requestId: 'req-ws-aa-0002' })).error).toMatch(/holds All Access \(VIP\), which already includes Workshops/);
    expect((await manual({ email: 'bo@example.com', ticketTypeId: 'virtual', requestId: 'req-ws-vi-0001' })).ok).toBe(true);
    expect((await workshops({ email: 'bo@example.com', requestId: 'req-ws-vi-0002' })).error).toMatch(/bo@example.com holds Virtual/);
  });

  it('adds Workshops to the Main Conference badge, which the desk and the list then show', async () => {
    const main = await manual({ requestId: 'req-ws-main-01' });
    const res = await workshops({ requestId: 'req-ws-add-001' });
    expect(res.ok).toBe(true);
    expect(res.registrationId).toBe(main.registrationId);
    expect(res.message).toMatch(/added to their existing ticket \(Main Conference \+ Workshops\)/);

    const r = (await db.collection(COLLECTIONS.registrations).doc(main.registrationId!).get()).data() as RegistrationDoc;
    expect(r.ticketType).toBe('Main Conference');
    expect(r.extraNames).toEqual(['Workshops']);
    const order = (await manualOrders()).find((o) => o.totalCents === 19_900)!;
    expect(order.extraRegistrationIds).toEqual([main.registrationId]);
    expect(await sold('workshops')).toBe(1);
    expect((await db.collection(COLLECTIONS.registrations).where('email', '==', 'ada@example.com').get()).size).toBe(1);

    // The confirmation is "added to your ticket", not a new ticket.
    const mails = (await db.collection(COLLECTIONS.emailLog).get()).docs.map((d) => d.data());
    expect(mails.map((m) => m.template).sort()).toEqual(['extra-added', 'purchase-confirmation']);

    // Check-in desk, attendee list and badges all read the whole label.
    const { listRegistrations } = await import('@/lib/checkin');
    const desk = (await listRegistrations()).find((x) => x.row.id === main.registrationId)!;
    expect(desk.row.ticketType).toBe('Main Conference + Workshops');
    const { listAttendees } = await import('@/lib/data');
    const row = (await listAttendees()).find((a) => a.registrationId === main.registrationId)!;
    expect(row.ticketLabel).toBe('Main Conference + Workshops');
    expect(row.ticketType).toBe('Main Conference');
  });

  it('marks an invoice paid with Main Conference and Workshops for one person as one badge', async () => {
    const { markInvoicePaidOutOfBand } = await import('@/lib/invoice-admin');
    const id = 'ord_inv_ws_0001';
    await db.collection(COLLECTIONS.orders).doc(id).set({
      eventId: EVENT_ID, externalId: 'in_ws_1', provider: 'stripe', channel: 'invoice', email: 'billing@acme.example',
      status: 'pending', totalCents: 79_800, currency: 'usd',
      items: [
        { ticketTypeId: 'workshops', ticketTypeName: 'Workshops', quantity: 1, unitPriceCents: 19_900, attendeeName: 'Ada Nakamura', attendeeEmail: 'ada@example.com' },
        { ticketTypeId: 'main-conference', ticketTypeName: 'Main Conference', quantity: 1, unitPriceCents: 59_900, attendeeName: 'Ada Nakamura', attendeeEmail: 'ada@example.com' },
      ],
    });
    const rids = await markInvoicePaidOutOfBand({
      order: { id, totalCents: 79_800, currency: 'usd', poNumber: undefined } as never,
      actor: 'organizer@example.com',
      note: 'Wire 4004',
    });
    expect(rids).toHaveLength(1);
    const r = (await db.collection(COLLECTIONS.registrations).doc(rids[0]!).get()).data() as RegistrationDoc;
    expect([r.ticketType, r.extraNames]).toEqual(['Main Conference', ['Workshops']]);
    expect(await sold('workshops')).toBe(1);
    expect(await sold('main-conference')).toBe(1);
  });
});
