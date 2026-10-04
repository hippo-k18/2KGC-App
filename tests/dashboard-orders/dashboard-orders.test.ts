/**
 * What the dashboard does to orders: manual orders, erasing a person, and the
 * abandoned-checkout list (T135, T136). Real dashboard code against the
 * Firestore emulator; email is unset, so confirmations log as skipped.
 *
 * Run with: npm run test:dashboard-orders
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
    [COLLECTIONS.registrations, COLLECTIONS.orders, COLLECTIONS.ticketTypes, COLLECTIONS.auditLog, COLLECTIONS.emailLog, COLLECTIONS.users].map(wipe),
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
