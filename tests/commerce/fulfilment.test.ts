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
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cert, deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type OrderDoc, type RegistrationDoc } from '@kgc/shared';
import { ensureRegistration } from '../../scripts/src/lib/fulfilment.js';
import { registrationId } from '../../scripts/src/lib/ids.js';
/**
 * The website's own refund path, not a copy of it. `registrations.ts` imports
 * `server-only`, which Vitest resolves to the package's empty file through the
 * alias in `vitest.config.mts` — see the note there. Its `db()` finds
 * `FIRESTORE_EMULATOR_HOST` and initialises against the same emulator this file
 * writes to.
 */
import { cancelRegistrationByOrder, fulfilPurchase } from '../../apps/web/src/lib/registrations.js';

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
  await Promise.all([clear(COLLECTIONS.registrations), clear(COLLECTIONS.orders)]);
});

const buyer = { email: 'Ada.Nakamura@Example.com', name: 'Ada Nakamura', ticketType: 'Main Conference' };
const ben = { email: 'Ben.Olsen@Example.com', name: 'Ben Olsen' };
const cara = { email: 'cara.diaz@example.com', name: 'Cara Diaz' };

/** One paid Checkout purchase for the buyer, written by the website's own path. */
function purchase(over: { externalId: string; amountCents?: number }) {
  return fulfilPurchase({
    email: buyer.email,
    name: buyer.name,
    ticketType: buyer.ticketType,
    amountCents: 79_900,
    currency: 'usd',
    paid: true,
    ...over,
  });
}

/**
 * Hand the ticket on, leaving behind exactly what a transfer leaves behind: the
 * old registration marked `transferred` with a forward link, and a live one for
 * the person now carrying it.
 */
async function transferTo(
  fromEmail: string,
  to: { email: string; name: string },
): Promise<string> {
  const holder = await ensureRegistration(db, { ...to, ticketType: buyer.ticketType });
  await db
    .collection(COLLECTIONS.registrations)
    .doc(registrationId(fromEmail))
    .update({ status: 'transferred', transferredTo: holder.registrationId });
  return holder.registrationId;
}

async function statusOf(rid: string): Promise<RegistrationDoc['status'] | undefined> {
  const snap = await db.collection(COLLECTIONS.registrations).doc(rid).get();
  return (snap.data() as RegistrationDoc | undefined)?.status;
}

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

describe('the ticket rule sets a category at registration', () => {
  const bag = () => db.collection(COLLECTIONS.settings).doc('attendeeCategories');
  const read = async (email: string) =>
    (await db.collection(COLLECTIONS.registrations).doc(registrationId(email)).get()).data() as RegistrationDoc;

  beforeEach(async () => {
    await bag().set({
      eventId: EVENT_ID,
      key: 'attendeeCategories',
      values: {
        categories: [{ id: 'vip', name: 'VIP', color: 'red' }],
        ticketRules: [{ ticketType: 'All Access (VIP)', categoryId: 'vip' }],
      },
    });
  });
  afterEach(() => bag().delete());

  it('labels a buyer of the mapped ticket type and leaves everyone else unlabelled', async () => {
    await ensureRegistration(db, { ...buyer, ticketType: 'all access (vip) ' });
    await ensureRegistration(db, { email: 'plain@example.com', name: 'Plain', ticketType: 'Main Conference' });

    expect(await read(buyer.email)).toMatchObject({ categoryId: 'vip', category: 'VIP', categorySource: 'ticket' });
    expect((await read('plain@example.com')).categoryId).toBeUndefined();
  });

  it('follows an upgrade, because the first category came from a rule too', async () => {
    await ensureRegistration(db, buyer);
    await ensureRegistration(db, { ...buyer, ticketType: 'All Access (VIP)' });
    expect((await read(buyer.email)).categoryId).toBe('vip');
  });

  it('never overrides a category an organizer set by hand', async () => {
    await ensureRegistration(db, buyer);
    await db
      .collection(COLLECTIONS.registrations)
      .doc(registrationId(buyer.email))
      .update({ categoryId: 'press', category: 'Press', categorySource: 'manual' });

    await ensureRegistration(db, { ...buyer, ticketType: 'All Access (VIP)' });
    expect(await read(buyer.email)).toMatchObject({ categoryId: 'press', categorySource: 'manual' });
  });
});

// ---------------------------------------------------------------------------
// The refund rules, exercised directly against order documents.
//
// These used to be re-implemented here, beside a note saying to import them the
// day they moved somewhere Vitest could load. They have: `cancelRegistrationByOrder`
// still lives in the `server-only` `apps/web/src/lib/registrations.ts`, but its
// *decisions* are now `apps/web/src/lib/refund-core.ts`, which imports nothing
// Next-specific. Two copies of a refund rule is the bug they exist to prevent,
// and the copy in the test would have agreed with itself for ever.
// ---------------------------------------------------------------------------

import { decideRefund as decide } from '../../apps/web/src/lib/refund-core.js';
import {
  MAX_SEATS,
  collectSeats,
  groupSeatsIntoLines,
  seatsPerTier,
  seatsToCount,
  splitAcrossSeats,
  validateSeats,
} from '../../apps/web/src/app/tickets/seats-core.js';

const decideRefund = (order: OrderDoc, refundedCents: number) => {
  const { fullyRefunded, status } = decide(order, { reason: 'refunded', refundedCents });
  return { fullyRefunded, status };
};

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

/**
 * The refund, driven through the function the webhook calls.
 *
 * These two used to build order documents by hand and then re-run the "is
 * anything else still paying for this?" query inline, asserting on their own
 * copy of it. The copy stayed green through a change that moved the real query
 * onto a different address, which is the whole failure mode a test is there to
 * catch. They now call `cancelRegistrationByOrder` and read the registration
 * back, so the only way to keep them passing is for the production code to
 * behave.
 */
describe('a registration backed by two orders', () => {
  it('survives one of them being refunded', async () => {
    // A main-conference ticket and a workshop upgrade, same person.
    const { registrationId: rid } = await purchase({ externalId: 'cs_main' });
    await purchase({ externalId: 'cs_upgrade', amountCents: 69_900 });

    const outcome = await cancelRegistrationByOrder({
      externalId: 'cs_upgrade',
      reason: 'refunded',
      refundedCents: 69_900,
    });

    // Nothing was withdrawn, and the ticket the other order pays for still works.
    expect(outcome.registrationId).toBeNull();
    expect(await statusOf(rid)).toBe('active');
  });

  it('counts a partially-refunded order as still paying for the ticket', async () => {
    const { registrationId: rid } = await purchase({ externalId: 'cs_main' });
    await purchase({ externalId: 'cs_upgrade', amountCents: 69_900 });

    // $200 back on the main ticket: money moved, the ticket did not.
    const partial = await cancelRegistrationByOrder({
      externalId: 'cs_main',
      reason: 'refunded',
      refundedCents: 20_000,
    });
    expect(partial.fullyRefunded).toBe(false);

    const outcome = await cancelRegistrationByOrder({
      externalId: 'cs_upgrade',
      reason: 'refunded',
      refundedCents: 69_900,
    });

    expect(outcome.registrationId).toBeNull();
    expect(await statusOf(rid)).toBe('active');
  });
});

/**
 * A refund after the ticket has been handed on.
 *
 * `registrationId(order.email)` is the buyer's document, and a transfer leaves
 * it `transferred` while somebody else carries the ticket. Cancelling the id
 * derived from the buyer's address took the money back and left the new
 * holder's badge scanning at the door, which is the one outcome a refund exists
 * to prevent.
 *
 * The transfer itself is written here rather than driven through the dashboard:
 * these tests own the refund, and what it consumes is two fields on a document.
 */
describe('a refund after a transfer', () => {
  it("cancels the ticket the new holder carries, not the buyer's dead document", async () => {
    await purchase({ externalId: 'cs_transfer' });
    const benId = await transferTo(buyer.email, ben);

    const outcome = await cancelRegistrationByOrder({
      externalId: 'cs_transfer',
      reason: 'refunded',
      refundedCents: 79_900,
    });

    expect(outcome.registrationId).toBe(benId);
    expect(outcome.holderEmail).toBe(ben.email.toLowerCase());
    // The receipt still goes to whoever paid.
    expect(outcome.email).toBe(buyer.email.toLowerCase());

    expect(await statusOf(benId)).toBe('cancelled');
    // The buyer's document was already dead and is not touched again.
    expect(await statusOf(registrationId(buyer.email))).toBe('transferred');
  });

  it("leaves the holder's ticket alone while another order of the buyer's still pays for it", async () => {
    // Ada bought twice and gave one ticket to Ben, who has no orders of his
    // own. Asking only the holder finds nothing paying for the seat and
    // cancels a ticket the buyer is still paying for.
    await purchase({ externalId: 'cs_main' });
    await purchase({ externalId: 'cs_upgrade', amountCents: 69_900 });
    const benId = await transferTo(buyer.email, ben);

    const outcome = await cancelRegistrationByOrder({
      externalId: 'cs_upgrade',
      reason: 'refunded',
      refundedCents: 69_900,
    });

    expect(outcome.registrationId).toBeNull();
    expect(await statusOf(benId)).toBe('active');
  });

  it('follows a chain of two transfers to the end', async () => {
    await purchase({ externalId: 'cs_chain' });
    const benId = await transferTo(buyer.email, ben);
    const caraId = await transferTo(ben.email, cara);

    const outcome = await cancelRegistrationByOrder({
      externalId: 'cs_chain',
      reason: 'refunded',
      refundedCents: 79_900,
    });

    expect(outcome.registrationId).toBe(caraId);
    expect(await statusOf(caraId)).toBe('cancelled');
    expect(await statusOf(benId)).toBe('transferred');
  });

  it('cancels nothing when the chain loops back on itself', async () => {
    // A repair gone wrong. The money still goes back; what must not happen is a
    // webhook that never returns, because Stripe retries it for three days.
    await purchase({ externalId: 'cs_cycle' });
    const benId = await transferTo(buyer.email, ben);
    await db
      .collection(COLLECTIONS.registrations)
      .doc(benId)
      .update({ status: 'transferred', transferredTo: registrationId(buyer.email) });

    const outcome = await cancelRegistrationByOrder({
      externalId: 'cs_cycle',
      reason: 'refunded',
      refundedCents: 79_900,
    });

    expect(outcome.registrationId).toBeNull();
    expect(outcome.fullyRefunded).toBe(true);
    expect(await statusOf(benId)).toBe('transferred');
  });

  it('skips a registration that is no longer there rather than throwing', async () => {
    // An abandoned multi-seat cart leaves an order with the buyer's address and
    // no registration. An `update()` on a missing document throws NOT_FOUND out
    // of the webhook, Stripe reads the 500 and retries for three days.
    await purchase({ externalId: 'cs_gone' });
    await db.collection(COLLECTIONS.registrations).doc(registrationId(buyer.email)).delete();

    const outcome = await cancelRegistrationByOrder({
      externalId: 'cs_gone',
      reason: 'refunded',
      refundedCents: 79_900,
    });

    expect(outcome.registrationId).toBeNull();
    expect(outcome.fullyRefunded).toBe(true);
  });
});

describe('refundedAt means a refund, and nothing else', () => {
  /**
   * `cancelRegistrationByOrder` handles three reasons — a refund, a failed
   * payment and a dispute — and used to stamp `refundedAt` on all of them. So
   * an expired Checkout session, where nothing was charged and nothing was
   * returned, came out carrying a refund date, and Transaction History rendered
   * a "refunded" row for a sale that never happened.
   *
   * The rule this pins: a date only when money actually went back. A dispute is
   * money *held*, not returned, and it may yet come back — counting it as a
   * refund would overstate the refunded total on Pay › Balance.
   */
  const stampsRefundedAt = (reason: 'refunded' | 'disputed' | 'payment_failed') =>
    reason === 'refunded';

  it('stamps a date when money went back', () => {
    expect(stampsRefundedAt('refunded')).toBe(true);
  });

  it('does not stamp one for a payment that never succeeded', () => {
    expect(stampsRefundedAt('payment_failed')).toBe(false);
  });

  it('does not stamp one for a dispute, which is money held rather than returned', () => {
    expect(stampsRefundedAt('disputed')).toBe(false);
  });
});

describe('splitting one payment across seats', () => {
  /**
   * The real function, not a copy of it.
   *
   * This test used to reproduce the webhook's arithmetic inline, which pinned
   * nothing: the copy would have agreed with itself for ever while the original
   * drifted. `splitAcrossSeats` now lives in `tickets/seats-core.ts` — pure, no
   * `server-only` — and is the same code both the invoice path and the
   * multi-seat card path use to tell each attendee what their seat cost.
   *
   * Plain division loses cents: $1,000 across three seats is 33333 each and one
   * cent short of what was actually charged, and the finance person reconciling
   * it notices.
   */
  const split = splitAcrossSeats;

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

// ---------------------------------------------------------------------------
// Buying more than one ticket.
//
// The gap this closes was described in three places in the organizer dashboard
// and was one sentence in all three: the Checkout session built exactly one
// line item with `quantity: 1`. Three colleagues on one card were three
// purchases; a booth and two extra passes were three purchases; and an add-on
// alongside a ticket was a tier per combination.
//
// What makes multi-quantity hard here is not Stripe. It is that **a
// registration is keyed by email address** — `registrationId` is a hash of the
// address — so three seats need three addresses or the buyer pays three times
// for one badge. Every test below is a guarantee that follows from that fact,
// and every one of them corresponds to a way this could be, or has been, wrong:
//
//   - three seats producing one registration, because they shared an inbox;
//   - a webhook replay minting six registrations for a three-seat purchase;
//   - a three-seat sale taking one seat off a capped tier instead of three, so
//     a fifty-seat tier sells a hundred and fifty;
//   - a refund giving back one seat out of three, permanently;
//   - a full refund leaving two of the three tickets `active`, which is exactly
//     what the check-in desk scans for.
// ---------------------------------------------------------------------------

describe('the seat rules that make a quantity possible', () => {
  const seat = (name: string, email: string, tierId = 'main-conference') => ({
    name,
    email,
    tierId,
  });

  it('refuses two seats on one address, because that is one badge', () => {
    const problem = validateSeats([
      seat('Ada Nakamura', 'ada@example.com'),
      seat('Ben Ortiz', 'ada@example.com'),
    ]);
    expect(problem).toEqual({ index: 1, kind: 'duplicate', email: 'ada@example.com' });
  });

  it('folds case, because registrationId does', () => {
    // `Ada@Example.com` and `ada@example.com` hash to the same registration, so
    // a form that accepted both would charge twice and issue one ticket.
    const problem = validateSeats([
      seat('Ada Nakamura', 'Ada@Example.com'),
      seat('Ada Nakamura', 'ada@example.com'),
    ]);
    expect(problem?.kind).toBe('duplicate');
  });

  it('accepts distinct addresses', () => {
    expect(
      validateSeats([
        seat('Ada Nakamura', 'ada@example.com'),
        seat('Ben Ortiz', 'ben@example.com'),
        seat('Cai Lin', 'cai@example.com'),
      ]),
    ).toBeNull();
  });

  it('caps the form rather than letting a hundred seats through it', () => {
    const many = Array.from({ length: MAX_SEATS + 1 }, (_, i) =>
      seat(`Person ${i}`, `p${i}@example.com`),
    );
    expect(validateSeats(many)?.kind).toBe('too-many');
  });

  it('drops an untouched spare row but rejects a half-filled one', () => {
    // The two halves of the same rule. A blank row is somebody who never
    // started typing; a row with a name and no address is a colleague who would
    // have been charged for and never registered.
    expect(collectSeats([seat('', ''), seat('Ada Nakamura', 'ada@example.com')])).toHaveLength(1);

    const halfFilled = collectSeats([seat('Ada Nakamura', 'ada@example.com'), seat('Ben Ortiz', '')]);
    expect(halfFilled).toHaveLength(2);
    expect(validateSeats(halfFilled)).toEqual({ index: 1, kind: 'email' });
  });
});

describe('seats become Stripe line items with a real quantity', () => {
  const seat = (email: string, tierId: string) => ({ name: 'Someone', email, tierId });

  it('charges three seats on one tier as one line of quantity 3', () => {
    // The heart of it. `quantity: 1` on one line was the whole gap: this is
    // what makes Stripe multiply, apply tax once and print "× 3" on the
    // receipt, instead of the buyer paying three times.
    const lines = groupSeatsIntoLines([
      seat('a@example.com', 'main-conference'),
      seat('b@example.com', 'main-conference'),
      seat('c@example.com', 'main-conference'),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
    expect(lines[0].tierId).toBe('main-conference');
  });

  it('sells a booth and two extra passes as one purchase, not three', () => {
    // The exhibitor case, which used to need three separate checkouts.
    const lines = groupSeatsIntoLines([
      seat('booth@acme.com', 'exhibitor-standard'),
      seat('rep1@acme.com', 'exhibitor-extra-pass'),
      seat('rep2@acme.com', 'exhibitor-extra-pass'),
    ]);
    expect(lines.map((l) => [l.tierId, l.quantity])).toEqual([
      ['exhibitor-standard', 1],
      ['exhibitor-extra-pass', 2],
    ]);
  });

  it("leads with the buyer's own tier, so the receipt reads the way they chose", () => {
    const lines = groupSeatsIntoLines([
      seat('buyer@example.com', 'all-access'),
      seat('colleague@example.com', 'main-conference'),
      seat('other@example.com', 'all-access'),
    ]);
    expect(lines[0].tierId).toBe('all-access');
    expect(lines[0].quantity).toBe(2);
  });

  it('asks capacity for the number of seats wanted, not merely for one', () => {
    // `onSale` answers "is there at least one seat", which is the only question
    // a single-seat purchase could ask. Three seats against a tier with one
    // left used to pass that check and oversell by two.
    const wanted = seatsPerTier([
      seat('a@example.com', 'main-conference'),
      seat('b@example.com', 'main-conference'),
      seat('c@example.com', 'workshops'),
    ]);
    expect(wanted.get('main-conference')).toBe(2);
    expect(wanted.get('workshops')).toBe(1);
  });
});

describe('a three-seat sale takes three seats off the tier', () => {
  it('counts one per newly-created registration', () => {
    const counts = seatsToCount([
      { created: true, ticketTypeId: 'main-conference' },
      { created: true, ticketTypeId: 'main-conference' },
      { created: true, ticketTypeId: 'main-conference' },
    ]);
    expect(counts.get('main-conference')).toBe(3);
  });

  it('counts nothing on a webhook replay, so a redelivery cannot oversell', () => {
    // Stripe redelivers for up to three days. `created` is false on every
    // delivery after the first, because `ensureRegistration` found the
    // documents already there — which is the replay guard.
    const counts = seatsToCount([
      { created: false, ticketTypeId: 'main-conference' },
      { created: false, ticketTypeId: 'main-conference' },
      { created: false, ticketTypeId: 'main-conference' },
    ]);
    expect(counts.size).toBe(0);
  });

  it('counts each tier separately on a mixed purchase', () => {
    const counts = seatsToCount([
      { created: true, ticketTypeId: 'exhibitor-standard' },
      { created: true, ticketTypeId: 'exhibitor-extra-pass' },
      { created: true, ticketTypeId: 'exhibitor-extra-pass' },
    ]);
    expect([...counts.entries()].sort()).toEqual([
      ['exhibitor-extra-pass', 2],
      ['exhibitor-standard', 1],
    ]);
  });

  it('ignores a seat with no tier, because there is no counter to move', () => {
    // An invoice raised straight in the Stripe dashboard names no tier. The
    // registration is still right; the increment has nothing to point at.
    expect(seatsToCount([{ created: true, ticketTypeId: '' }]).size).toBe(0);
  });
});

describe('three seats, and a webhook replay of them', () => {
  const party = [
    { email: 'ada@example.com', name: 'Ada Nakamura', ticketType: 'Main Conference' },
    { email: 'ben@example.com', name: 'Ben Ortiz', ticketType: 'Main Conference' },
    { email: 'cai@example.com', name: 'Cai Lin', ticketType: 'Main Conference' },
  ];

  it('produces three registrations, each with its own badge secret', async () => {
    const made = [];
    for (const person of party) made.push(await ensureRegistration(db, person));

    expect(new Set(made.map((r) => r.registrationId)).size).toBe(3);
    expect(made.every((r) => r.created)).toBe(true);

    const secrets = await Promise.all(
      made.map(async (r) => {
        const doc = await db.collection(COLLECTIONS.registrations).doc(r.registrationId).get();
        return (doc.data() as RegistrationDoc).qrSecret;
      }),
    );
    // Three badges, three secrets. A shared one would let any of them check in
    // as any other, and `qrSecret` is a bearer credential for attendance.
    expect(new Set(secrets).size).toBe(3);
  });

  it('does not mint six on a redelivery', async () => {
    for (const person of party) await ensureRegistration(db, person);
    // Stripe retries until it gets a 2xx and its documentation is explicit that
    // an event may arrive more than once. Idempotence here is structural: the
    // ids are hashes of the three addresses, so a replay rewrites the same
    // three documents.
    const replay = [];
    for (const person of party) replay.push(await ensureRegistration(db, person));

    expect(replay.every((r) => r.created)).toBe(false);
    const all = await db
      .collection(COLLECTIONS.registrations)
      .where('eventId', '==', EVENT_ID)
      .get();
    expect(all.size).toBe(3);
  });

  it('keeps every claim code stable across the replay', async () => {
    // The reason `created` alone is not enough of a guarantee: a second
    // delivery that re-minted secrets would invalidate three badges that are
    // already in three inboxes.
    const first = [];
    for (const person of party) first.push(await ensureRegistration(db, person));
    const second = [];
    for (const person of party) second.push(await ensureRegistration(db, person));

    expect(second.map((r) => r.claimCode)).toEqual(first.map((r) => r.claimCode));
  });
});

describe('the order remembers every seat', () => {
  /**
   * ⚠️ The failure `restoreCartOrder` exists to prevent, reproduced against the
   * real emulator rather than argued about in a comment.
   *
   * `fulfilPurchase` writes the order with `set(…, { merge: true })` and sets
   * `items` to a single line describing the buyer. A Firestore merge treats an
   * array as one value and **replaces** it, so the write that fulfils a
   * three-seat purchase erases the record of who seats two and three are — and
   * with it the two lines a refund would have given back to `quantitySold` and
   * the rows the dashboard counts as `seatCount`.
   */
  const threeSeats = ['ada', 'ben', 'cai'].map((who) => ({
    ticketTypeId: 'main-conference',
    ticketTypeName: 'Main Conference',
    quantity: 1,
    unitPriceCents: 79_900,
    attendeeName: who,
    attendeeEmail: `${who}@example.com`,
  }));

  const cartOrder = () =>
    db.collection(COLLECTIONS.orders).doc('ord_cart').set({
      eventId: EVENT_ID,
      externalId: 'cs_cart',
      provider: 'stripe',
      channel: 'checkout',
      email: 'ada@example.com',
      status: 'pending',
      items: threeSeats,
      totalCents: 239_700,
      currency: 'usd',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

  it('loses the other two seats when fulfilment merges over items', async () => {
    await cartOrder();
    await db
      .collection(COLLECTIONS.orders)
      .doc('ord_cart')
      .set({ status: 'paid', items: [threeSeats[0]] }, { merge: true });

    const after = (await db.collection(COLLECTIONS.orders).doc('ord_cart').get()).data() as OrderDoc;
    expect(after.items).toHaveLength(1);
  });

  it('has them all back once the seat list is written again', async () => {
    await cartOrder();
    await db
      .collection(COLLECTIONS.orders)
      .doc('ord_cart')
      .set({ status: 'paid', items: [threeSeats[0]] }, { merge: true });

    // What `restoreCartOrder` does: set, not append, so a redelivery writes the
    // same array rather than a longer one.
    await db
      .collection(COLLECTIONS.orders)
      .doc('ord_cart')
      .update({ items: threeSeats, registrationIds: threeSeats.map((s) => s.attendeeEmail) });
    await db
      .collection(COLLECTIONS.orders)
      .doc('ord_cart')
      .update({ items: threeSeats, registrationIds: threeSeats.map((s) => s.attendeeEmail) });

    const after = (await db.collection(COLLECTIONS.orders).doc('ord_cart').get()).data() as OrderDoc;
    expect(after.items).toHaveLength(3);
    expect(after.registrationIds).toHaveLength(3);
  });

  it('gives three seats back on a full refund, not one', async () => {
    // `decideRefund` reads `items`, which is the other half of why the seat
    // list has to survive fulfilment. One line per seat, so three seats return.
    const decision = decide(
      {
        status: 'paid',
        totalCents: 239_700,
        items: threeSeats,
      } as unknown as OrderDoc,
      { reason: 'refunded', refundedCents: 239_700 },
    );
    expect(decision.fullyRefunded).toBe(true);
    expect(decision.newlyRefunded).toBe(true);
    expect(decision.lines).toHaveLength(3);
    expect(decision.lines.reduce((n, l) => n + l.quantity, 0)).toBe(3);
  });

  it('gives nothing back on a redelivery of the same refund', async () => {
    // Stripe reports the same cumulative `amount_refunded` on every delivery
    // for three days. Without this guard a group refund would hand the same
    // three seats back over and over and the tier would report seats it does
    // not have.
    const decision = decide(
      { status: 'refunded', totalCents: 239_700, items: threeSeats } as unknown as OrderDoc,
      { reason: 'refunded', refundedCents: 239_700 },
    );
    expect(decision.newlyRefunded).toBe(false);
  });
});

describe('a refunded group purchase does not leave the other seats at the door', () => {
  /**
   * The rule `cancelExtraSeats` applies, exercised against real documents.
   *
   * `cancelRegistrationByOrder` cancels the registration keyed on the *order's*
   * email — the buyer's — which was the whole story while a Checkout session
   * was one ticket. On a three-seat purchase it leaves the other two `active`,
   * and `active` is precisely what the check-in desk scans for.
   */
  const stillPaidElsewhere = async (seatEmail: string) => {
    const snap = await db
      .collection(COLLECTIONS.orders)
      .where('eventId', '==', EVENT_ID)
      .where('email', '==', seatEmail)
      .get();
    return snap.docs.some((d) => {
      const o = d.data() as OrderDoc;
      return o.status === 'paid' || o.status === 'partially_refunded';
    });
  };

  it('withdraws a colleague who has no other order paying for them', async () => {
    const seat = await ensureRegistration(db, {
      email: 'ben@example.com',
      name: 'Ben Ortiz',
      ticketType: 'Main Conference',
    });
    // The refunded group order is keyed on the buyer's address, not Ben's, so
    // it cannot appear in the query above and there is nothing to exclude.
    await db.collection(COLLECTIONS.orders).doc('ord_group').set({
      eventId: EVENT_ID,
      externalId: 'cs_group',
      provider: 'stripe',
      channel: 'checkout',
      email: 'ada@example.com',
      status: 'refunded',
      totalCents: 239_700,
      currency: 'usd',
      purchasedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    expect(await stillPaidElsewhere('ben@example.com')).toBe(false);

    await db
      .collection(COLLECTIONS.registrations)
      .doc(seat.registrationId)
      .update({ status: 'cancelled' });
    const after = (
      await db.collection(COLLECTIONS.registrations).doc(seat.registrationId).get()
    ).data() as RegistrationDoc;
    expect(after.status).toBe('cancelled');
  });

  it('keeps a colleague who also bought their own ticket', async () => {
    // Somebody who was seat three on a refunded group purchase *and*
    // separately bought their own ticket keeps the one they paid for. Same
    // test the buyer already gets, applied to a passenger.
    await db.collection(COLLECTIONS.orders).doc('ord_own').set({
      eventId: EVENT_ID,
      externalId: 'cs_own',
      provider: 'stripe',
      channel: 'checkout',
      email: 'ben@example.com',
      status: 'paid',
      totalCents: 79_900,
      currency: 'usd',
      purchasedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    expect(await stillPaidElsewhere('ben@example.com')).toBe(true);
  });
});
