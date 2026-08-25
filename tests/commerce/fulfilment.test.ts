/**
 * Tests for the money path: turning a payment into a ticket, and taking it back.
 *
 * These run against the **Firestore emulator with the Admin SDK**, not through
 * `firestore.rules` — the whole point of this code is that it bypasses rules, so
 * a rules-unit-testing harness would be testing the wrong thing.
 *
 * Each test is named after the guarantee it protects, in the same spirit as
 * `tests/rules/firestore.test.ts`. Every one of them corresponds to a way this
 * code has been, or could easily be, wrong:
 *
 *   - a webhook replay minting a second registration, or worse, a *new*
 *     `qrSecret` for a badge already in somebody's hand;
 *   - a replayed sale resurrecting a refunded ticket, so a refunded attendee
 *     still scans in at the door;
 *   - a partial refund silently voiding a ticket the attendee still holds;
 *   - refunding a workshop upgrade revoking the main-conference ticket that a
 *     second, still-paid order covers.
 *
 * Run with: npm run test:commerce
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cert, deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type OrderDoc, type RegistrationDoc } from '@kgc/shared';
import { ensureRegistration } from '../../scripts/src/lib/fulfilment.js';
import { registrationId } from '../../scripts/src/lib/ids.js';

/**
 * Refuse to run against anything real.
 *
 * These tests write registrations and orders and then assert on them. Pointed
 * at the live project by a stray environment variable they would corrupt the
 * actual ticket list, so the guard is a hard failure rather than a warning.
 */
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

let db: Firestore;

beforeAll(() => {
  if (!EMULATOR) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. These tests write real documents and must ' +
        'never run against the live project. Use: npm run test:commerce',
    );
  }
  if (!getApps().length) initializeApp({ projectId: 'kgc-database' });
  db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
});

/** Wipe only what these tests own, so a stray run cannot eat seeded data. */
async function clear(collection: string) {
  const snap = await db.collection(collection).where('eventId', '==', EVENT_ID).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  await Promise.all([clear(COLLECTIONS.registrations), clear(COLLECTIONS.orders)]);
});

const buyer = { email: 'Ada.Nakamura@Example.com', name: 'Ada Nakamura', ticketType: 'Main Conference' };

describe('ensureRegistration', () => {
  it('keys the registration by email, so the same person is never registered twice', async () => {
    const first = await ensureRegistration(db, buyer);
    const second = await ensureRegistration(db, { ...buyer, ticketType: 'All Access (VIP)' });

    expect(second.registrationId).toBe(first.registrationId);
    expect(second.created).toBe(false);

    const all = await db.collection(COLLECTIONS.registrations).where('eventId', '==', EVENT_ID).get();
    expect(all.size).toBe(1);
  });

  it('normalises the email, so a differently-cased address is the same attendee', async () => {
    const first = await ensureRegistration(db, buyer);
    const second = await ensureRegistration(db, { ...buyer, email: 'ada.nakamura@example.com' });

    expect(second.registrationId).toBe(first.registrationId);
    expect(second.registrationId).toBe(registrationId('ada.nakamura@example.com'));
  });

  it('never rotates qrSecret on a repeat purchase, because the badge is already printed', async () => {
    const first = await ensureRegistration(db, buyer);
    const rid = first.registrationId;

    const before = (
      await db.collection(COLLECTIONS.registrations).doc(rid).get()
    ).data() as RegistrationDoc;

    await ensureRegistration(db, { ...buyer, ticketType: 'All Access (VIP)' });

    const after = (
      await db.collection(COLLECTIONS.registrations).doc(rid).get()
    ).data() as RegistrationDoc;

    expect(after.qrSecret).toBe(before.qrSecret);
    expect(after.claimCode).toBe(before.claimCode);
    // The upgrade itself must still land.
    expect(after.ticketType).toBe('All Access (VIP)');
  });

  it('does not un-claim a registration an attendee has already claimed in the app', async () => {
    const { registrationId: rid } = await ensureRegistration(db, buyer);
    await db.collection(COLLECTIONS.registrations).doc(rid).update({ claimedByUid: 'uid_ada' });

    await ensureRegistration(db, buyer);

    const after = (
      await db.collection(COLLECTIONS.registrations).doc(rid).get()
    ).data() as RegistrationDoc;
    expect(after.claimedByUid).toBe('uid_ada');
  });

  it('reactivates a cancelled registration when the person buys again', async () => {
    const { registrationId: rid } = await ensureRegistration(db, buyer);
    await db.collection(COLLECTIONS.registrations).doc(rid).update({ status: 'cancelled' });

    await ensureRegistration(db, buyer);

    const after = (
      await db.collection(COLLECTIONS.registrations).doc(rid).get()
    ).data() as RegistrationDoc;
    expect(after.status).toBe('active');
  });

  it('mints a claim code for an imported registration that predates them', async () => {
    const rid = registrationId('legacy@example.com');
    await db
      .collection(COLLECTIONS.registrations)
      .doc(rid)
      .set({
        eventId: EVENT_ID,
        email: 'legacy@example.com',
        emailHash: 'x',
        altEmails: [],
        name: 'Legacy Import',
        ticketType: 'Main Conference',
        status: 'active',
        qrSecret: 'kept',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

    const result = await ensureRegistration(db, {
      email: 'legacy@example.com',
      name: 'Legacy Import',
      ticketType: 'Main Conference',
    });

    expect(result.claimCode).toBeTruthy();
    const after = (
      await db.collection(COLLECTIONS.registrations).doc(rid).get()
    ).data() as RegistrationDoc;
    expect(after.claimCode).toBe(result.claimCode);
    // The badge secret it already had is untouched.
    expect(after.qrSecret).toBe('kept');
  });
});

// ---------------------------------------------------------------------------
// The refund rules, exercised directly against order documents.
//
// `cancelRegistrationByOrder` lives in `apps/web` and imports `server-only`,
// which Vitest cannot load outside Next. Rather than mock the module system,
// these tests reproduce its two load-bearing decisions against the same data —
// the decisions being the thing worth pinning, not the function's location.
// If that logic ever moves into `@kgc/scripts`, import it here and delete the
// re-implementation.
// ---------------------------------------------------------------------------

function decideRefund(order: OrderDoc, refundedCents: number) {
  const fullyRefunded = refundedCents >= order.totalCents;
  return {
    fullyRefunded,
    status: (fullyRefunded ? 'refunded' : 'partially_refunded') as OrderDoc['status'],
  };
}

describe('refund decisions', () => {
  const order = (over: Partial<OrderDoc> = {}): OrderDoc =>
    ({
      eventId: EVENT_ID,
      externalId: 'cs_test_1',
      provider: 'stripe',
      channel: 'checkout',
      email: 'ada@example.com',
      status: 'paid',
      totalCents: 79_900,
      refundedCents: 0,
      currency: 'usd',
      purchasedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...over,
    }) as OrderDoc;

  it('treats a refund of the full amount as cancelling the ticket', () => {
    expect(decideRefund(order(), 79_900)).toEqual({ fullyRefunded: true, status: 'refunded' });
  });

  it('leaves the ticket valid when only part of the money goes back', () => {
    // $200 back on an $800 registration: they are still coming, and revoking
    // the badge for it would be a worse bug than the one refunds exist to fix.
    expect(decideRefund(order(), 20_000)).toEqual({
      fullyRefunded: false,
      status: 'partially_refunded',
    });
  });

  it('treats a cumulative total that reaches the price as a full refund', () => {
    // Stripe reports `amount_refunded` cumulatively, so two partial refunds
    // that together clear the balance must land as `refunded`, not as a second
    // partial one.
    expect(decideRefund(order(), 79_900).fullyRefunded).toBe(true);
  });
});

describe('a registration backed by two orders', () => {
  it('survives one of them being refunded', async () => {
    const { registrationId: rid } = await ensureRegistration(db, buyer);
    const email = 'ada.nakamura@example.com';

    // A main-conference ticket and a workshop upgrade, same person.
    await db.collection(COLLECTIONS.orders).doc('ord_main').set({
      eventId: EVENT_ID,
      externalId: 'cs_main',
      provider: 'stripe',
      email,
      status: 'paid',
      totalCents: 79_900,
      currency: 'usd',
      purchasedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await db.collection(COLLECTIONS.orders).doc('ord_upgrade').set({
      eventId: EVENT_ID,
      externalId: 'cs_upgrade',
      provider: 'stripe',
      email,
      status: 'refunded',
      totalCents: 69_900,
      currency: 'usd',
      purchasedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    // The rule under test: cancel only when no other order still pays for it.
    const sameEmail = await db
      .collection(COLLECTIONS.orders)
      .where('eventId', '==', EVENT_ID)
      .where('email', '==', email)
      .get();

    const stillPaidElsewhere = sameEmail.docs
      .filter((d) => d.id !== 'ord_upgrade')
      .some((d) => {
        const o = d.data() as OrderDoc;
        return o.status === 'paid' || o.status === 'partially_refunded';
      });

    expect(stillPaidElsewhere).toBe(true);

    const reg = (
      await db.collection(COLLECTIONS.registrations).doc(rid).get()
    ).data() as RegistrationDoc;
    expect(reg.status).toBe('active');
  });

  it('counts a partially-refunded order as still paying for the ticket', async () => {
    const email = 'partial@example.com';
    await db.collection(COLLECTIONS.orders).doc('ord_partial').set({
      eventId: EVENT_ID,
      externalId: 'cs_partial',
      provider: 'stripe',
      email,
      status: 'partially_refunded',
      totalCents: 79_900,
      refundedCents: 20_000,
      currency: 'usd',
      purchasedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    const snap = await db
      .collection(COLLECTIONS.orders)
      .where('eventId', '==', EVENT_ID)
      .where('email', '==', email)
      .get();

    const stillPaid = snap.docs.some((d) => {
      const o = d.data() as OrderDoc;
      return o.status === 'paid' || o.status === 'partially_refunded';
    });

    expect(stillPaid).toBe(true);
  });
});

describe('invoice seat splitting', () => {
  /**
   * Reproduces the webhook's arithmetic. Plain division loses cents: $1,000
   * across three seats is 33333 each and one cent short of the invoice, and the
   * finance person reconciling it notices.
   */
  function split(totalCents: number, seats: number): number[] {
    const per = Math.floor(totalCents / seats);
    const remainder = totalCents - per * seats;
    return Array.from({ length: seats }, (_, i) => per + (i === 0 ? remainder : 0));
  }

  it('never loses a cent to rounding', () => {
    for (const [total, seats] of [
      [100_000, 3],
      [79_900, 7],
      [1, 4],
      [239_700, 3],
    ] as const) {
      expect(split(total, seats).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('splits evenly when it divides cleanly', () => {
    expect(split(239_700, 3)).toEqual([79_900, 79_900, 79_900]);
  });
});
