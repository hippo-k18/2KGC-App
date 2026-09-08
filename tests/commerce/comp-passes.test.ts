/**
 * Complimentary passes: the allocation, and what it refuses.
 *
 * A sponsor tier that says "includes 4 full conference passes" is now a number
 * on the ticket type rather than a bullet in the marketing copy, and redeeming
 * one produces the same registration a purchase produces. What has to be true
 * of that, and is what each test here is named after:
 *
 *   - the fifth pass on a four-pass sponsorship is refused;
 *   - **two simultaneous redemptions of the last pass yield one registration
 *     and one refusal**, not two registrations. This is the test that matters.
 *     A read-then-write allocation passes every sequential test in this file
 *     and fails this one, and the way it fails in production is a second person
 *     at the door holding a ticket that should not exist;
 *   - a pass is an ordinary registration — same `ensureRegistration`, same
 *     `qrSecret`, same `claimCode` — and not a fourth registration product;
 *   - what remains is derived from the passes that exist, so a lost write
 *     cannot leave a counter claiming a seat is free when it is not;
 *   - correcting a name does not reissue a badge somebody is already holding.
 *
 * They run against the **Firestore emulator with the Admin SDK**, not through
 * `firestore.rules`: `compPasses` is server-only and has no match block, so a
 * rules-unit-testing harness would be testing the wrong thing.
 *
 * Run with: npm run test:commerce
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type RegistrationDoc } from '@kgc/shared';
import {
  compPassSeatId,
  compPassesForOrder,
  readCompPassAllocation,
  redeemCompPass,
  renameCompPass,
} from '../../scripts/src/lib/comp-passes.js';
import { registrationId } from '../../scripts/src/lib/ids.js';

/**
 * Refuse to run against anything real. These tests write registrations and
 * would corrupt the live ticket list if pointed at the project by a stray
 * environment variable.
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
  if (!getApps().length) initializeApp({ projectId: 'kgc-conference-app-and-website' });
  db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
});

/** Wipe only what these tests own, so a stray run cannot eat seeded data. */
async function clear(collection: string) {
  const snap = await db.collection(collection).where('eventId', '==', EVENT_ID).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  await Promise.all([
    clear(COLLECTIONS.registrations),
    clear(COLLECTIONS.orders),
    clear(COLLECTIONS.ticketTypes),
    clear(COLLECTIONS.compPasses),
  ]);
});

const GOLD = 'sponsor-gold';
const ORDER = 'manual_sponsor-gold_procurement@bloomberg.example.invalid';

/** A sponsor package that includes `passes` per unit, and one order for it. */
async function sellSponsorship(passes: number, quantity = 1, orderId = ORDER) {
  await db
    .collection(COLLECTIONS.ticketTypes)
    .doc(GOLD)
    .set({
      eventId: EVENT_ID,
      name: 'Gold Sponsorship',
      priceCents: 1500000,
      currency: 'usd',
      audience: 'sponsor',
      visible: false,
      sortOrder: 1,
      inPerson: true,
      tagline: 'Logo, booth and passes',
      includes: [`${passes} full conference passes`],
      includesWorkshops: true,
      includesVideoLibrary: false,
      quantitySold: 1,
      taxCode: 'txcd_20030000',
      complimentaryPasses: passes,
    });

  await db
    .collection(COLLECTIONS.orders)
    .doc(orderId)
    .set({
      eventId: EVENT_ID,
      externalId: orderId,
      provider: 'manual',
      channel: 'manual',
      email: 'procurement@bloomberg.example.invalid',
      buyerName: 'Dana Okonkwo',
      companyName: 'Bloomberg',
      status: 'paid',
      items: [
        {
          ticketTypeId: GOLD,
          ticketTypeName: 'Gold Sponsorship',
          quantity,
          unitPriceCents: 1500000,
        },
      ],
      totalCents: 1500000 * quantity,
      currency: 'usd',
      purchasedAt: new Date(),
    });
}

const named = (n: number) => ({
  name: `Attendee ${n}`,
  email: `attendee${n}@bloomberg.example.invalid`,
});

describe('the entitlement', () => {
  it('multiplies the package count by the quantity bought, so two sponsorships owe twice', () => {
    const perUnit = new Map([[GOLD, 4]]);
    const { total, sources } = compPassesForOrder(
      [{ ticketTypeId: GOLD, ticketTypeName: 'Gold Sponsorship', quantity: 2, unitPriceCents: 1 }],
      perUnit,
    );

    expect(total).toBe(8);
    expect(sources).toEqual([
      { ticketTypeId: GOLD, ticketTypeName: 'Gold Sponsorship', perUnit: 4, quantity: 2 },
    ]);
  });

  it('owes nothing for a package that declares no passes, whatever its includes list says', () => {
    // The whole defect this replaces: the bullet said four and the entitlement
    // was zero. It still is zero — the difference is that the count is now a
    // field somebody can set, rather than a sentence nothing reads.
    const { total } = compPassesForOrder(
      [
        {
          ticketTypeId: 'main-conference',
          ticketTypeName: 'Main Conference',
          quantity: 1,
          unitPriceCents: 79900,
        },
      ],
      new Map(),
    );
    expect(total).toBe(0);
  });

  it('derives what remains from the passes that exist, never from a stored count', async () => {
    await sellSponsorship(4);

    const before = await readCompPassAllocation(db, ORDER);
    expect(before?.total).toBe(4);
    expect(before?.remaining).toBe(4);

    await redeemCompPass(db, { orderId: ORDER, ...named(1), actor: 'demo@kgc.test' });
    await redeemCompPass(db, { orderId: ORDER, ...named(2), actor: 'demo@kgc.test' });

    const after = await readCompPassAllocation(db, ORDER);
    expect(after?.issued).toHaveLength(2);
    expect(after?.remaining).toBe(2);

    // Nothing anywhere stores the remainder. Deleting a pass by hand — the
    // repair an organizer would make — must move the number, which it cannot
    // do if a counter is the source of truth.
    await db.collection(COLLECTIONS.compPasses).doc(compPassSeatId(ORDER, 2)).delete();
    const repaired = await readCompPassAllocation(db, ORDER);
    expect(repaired?.remaining).toBe(3);
  });
});

describe('redeeming a pass', () => {
  it('produces the same registration a purchase produces, not a second kind of ticket', async () => {
    await sellSponsorship(4);

    const result = await redeemCompPass(db, {
      orderId: ORDER,
      ...named(1),
      actor: 'demo@kgc.test',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The id is the one `ensureRegistration` derives, which is what makes a
    // comped attendee and a paying one the same person to every other screen.
    expect(result.registrationId).toBe(registrationId(named(1).email));

    const reg = (
      await db.collection(COLLECTIONS.registrations).doc(result.registrationId).get()
    ).data() as RegistrationDoc;

    expect(reg.status).toBe('active');
    expect(reg.qrSecret).toBeTruthy();
    expect(reg.claimCode).toBeTruthy();
    // Named after the package that granted it, so ticket-session mapping and
    // the badge agree about what this person was admitted to.
    expect(reg.ticketType).toBe('Gold Sponsorship');
  });

  it('refuses the fifth pass on a four-pass sponsorship', async () => {
    await sellSponsorship(4);

    for (let i = 1; i <= 4; i += 1) {
      const ok = await redeemCompPass(db, { orderId: ORDER, ...named(i), actor: 'a@kgc.test' });
      expect(ok.ok).toBe(true);
    }

    const fifth = await redeemCompPass(db, { orderId: ORDER, ...named(5), actor: 'a@kgc.test' });
    expect(fifth.ok).toBe(false);
    if (fifth.ok) return;
    expect(fifth.error).toMatch(/all 4 complimentary passes/i);

    const passes = await db
      .collection(COLLECTIONS.compPasses)
      .where('eventId', '==', EVENT_ID)
      .get();
    expect(passes.size).toBe(4);

    // And no registration was minted for the person who was refused.
    const orphan = await db
      .collection(COLLECTIONS.registrations)
      .doc(registrationId(named(5).email))
      .get();
    expect(orphan.exists).toBe(false);
  });

  it('refuses a package that includes no passes rather than issuing one anyway', async () => {
    await sellSponsorship(0);

    const result = await redeemCompPass(db, {
      orderId: ORDER,
      ...named(1),
      actor: 'a@kgc.test',
    });
    expect(result.ok).toBe(false);
  });

  it('refuses to spend a second seat on somebody who already holds one', async () => {
    // `ensureRegistration` is idempotent on the address, so naming the same
    // person twice would burn a pass and produce no second attendee — the
    // sponsor would silently be one short.
    await sellSponsorship(4);

    await redeemCompPass(db, { orderId: ORDER, ...named(1), actor: 'a@kgc.test' });
    const again = await redeemCompPass(db, {
      orderId: ORDER,
      name: 'Attendee One',
      email: named(1).email.toUpperCase(),
      actor: 'a@kgc.test',
    });

    expect(again.ok).toBe(false);
    const allocation = await readCompPassAllocation(db, ORDER);
    expect(allocation?.remaining).toBe(3);
  });

  it('fills seats in order, so the seat number identifies the pass', async () => {
    await sellSponsorship(3);

    const first = await redeemCompPass(db, { orderId: ORDER, ...named(1), actor: 'a@kgc.test' });
    const second = await redeemCompPass(db, { orderId: ORDER, ...named(2), actor: 'a@kgc.test' });

    expect(first.ok && first.seat).toBe(1);
    expect(second.ok && second.seat).toBe(2);

    const seat1 = await db.collection(COLLECTIONS.compPasses).doc(compPassSeatId(ORDER, 1)).get();
    expect(seat1.exists).toBe(true);
    expect(seat1.data()?.email).toBe(named(1).email);
  });

  it('refuses an order that does not exist rather than inventing an allocation', async () => {
    const result = await redeemCompPass(db, {
      orderId: 'no_such_order',
      ...named(1),
      actor: 'a@kgc.test',
    });
    expect(result.ok).toBe(false);
  });
});

describe('the race that a counter would lose', () => {
  /**
   * The test this file exists for.
   *
   * Two organizers — or one organizer and a double-clicked button — redeeming
   * the *last* pass at the same moment. The writes are raced rather than
   * awaited in turn, because a read-then-write allocation is correct in
   * sequence and wrong in parallel, and asserting the happy path twice would
   * pass against exactly the implementation this is here to reject.
   */
  it('yields one registration and one refusal when two clicks race for the last pass', async () => {
    await sellSponsorship(1);

    const [a, b] = await Promise.all([
      redeemCompPass(db, { orderId: ORDER, ...named(1), actor: 'a@kgc.test' }),
      redeemCompPass(db, { orderId: ORDER, ...named(2), actor: 'b@kgc.test' }),
    ]);

    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const passes = await db
      .collection(COLLECTIONS.compPasses)
      .where('eventId', '==', EVENT_ID)
      .get();
    expect(passes.size).toBe(1);

    // The half that actually costs money: the loser must not be holding a
    // registration. A ticket minted before the allocation agreed to it is a
    // free pass nobody sold.
    const regs = await db
      .collection(COLLECTIONS.registrations)
      .where('eventId', '==', EVENT_ID)
      .get();
    expect(regs.size).toBe(1);

    const allocation = await readCompPassAllocation(db, ORDER);
    expect(allocation?.remaining).toBe(0);
  });

  it('hands out exactly the allocation when four clicks race for two passes', async () => {
    // The same guarantee away from the boundary: partial contention must not
    // over-issue either, and must not under-issue by refusing a seat that was
    // free.
    await sellSponsorship(2);

    const results = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        redeemCompPass(db, { orderId: ORDER, ...named(n), actor: `a${n}@kgc.test` }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(2);

    const passes = await db
      .collection(COLLECTIONS.compPasses)
      .where('eventId', '==', EVENT_ID)
      .get();
    expect(passes.size).toBe(2);
    expect(new Set(passes.docs.map((d) => d.data().seat))).toEqual(new Set([1, 2]));

    const regs = await db
      .collection(COLLECTIONS.registrations)
      .where('eventId', '==', EVENT_ID)
      .get();
    expect(regs.size).toBe(2);
  });
});

describe('correcting a pass', () => {
  it('changes the printed name without reissuing a badge somebody is holding', async () => {
    await sellSponsorship(2);

    const issued = await redeemCompPass(db, {
      orderId: ORDER,
      ...named(1),
      actor: 'a@kgc.test',
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const before = (
      await db.collection(COLLECTIONS.registrations).doc(issued.registrationId).get()
    ).data() as RegistrationDoc;

    const renamed = await renameCompPass(db, { orderId: ORDER, seat: 1, name: 'Ada Nakamura' });
    expect(renamed.ok).toBe(true);

    const after = (
      await db.collection(COLLECTIONS.registrations).doc(issued.registrationId).get()
    ).data() as RegistrationDoc;

    expect(after.name).toBe('Ada Nakamura');
    // The two values that must survive a correction: the QR the badge already
    // shows, and the code the attendee may already have pasted into the app.
    expect(after.qrSecret).toBe(before.qrSecret);
    expect(after.claimCode).toBe(before.claimCode);
  });

  it('does not spend another seat when a name is corrected', async () => {
    await sellSponsorship(2);
    await redeemCompPass(db, { orderId: ORDER, ...named(1), actor: 'a@kgc.test' });
    await renameCompPass(db, { orderId: ORDER, seat: 1, name: 'Ada Nakamura' });

    const allocation = await readCompPassAllocation(db, ORDER);
    expect(allocation?.issued).toHaveLength(1);
    expect(allocation?.remaining).toBe(1);
  });

  it('refuses to rename a seat nobody has been named against', async () => {
    await sellSponsorship(2);
    const result = await renameCompPass(db, { orderId: ORDER, seat: 2, name: 'Nobody Here' });
    expect(result.ok).toBe(false);
  });
});
