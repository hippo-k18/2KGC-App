/**
 * The specs around the price: the sold counter, the grouped "what's included"
 * list, and the sales window's timezone.
 *
 * The price chain itself is pinned by `fulfilment.test.ts` and is not retested
 * here. What this file covers is everything the audit found *around* it, and
 * every case is one that fails silently in production:
 *
 *   - a sold counter that only ever goes up, so a capped tier's inventory
 *     shrinks permanently with every refund;
 *   - the grouped bullet list, which is what the two headline tickets actually
 *     render on the public site — so a parse that loses a heading loses ticket
 *     copy a buyer reads;
 *   - a sales window parsed in the server's zone, which closes an early-bird
 *     deadline four hours early on a UTC host and prints the right time anyway.
 *
 * The sold-count fold is exercised through a real Firestore round trip rather
 * than over hand-built objects — `sold-counts.test.ts` in the scripts workspace
 * already pins the arithmetic, and what is worth checking here is that the
 * shape written by the fulfilment path is the shape the fold reads.
 *
 * Run with: npm run test:commerce
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, TIME_ZONE, type OrderDoc } from '@kgc/shared';
import {
  outstandingSeatsByTier,
  soldByTier,
  soldCountDrift,
  type SoldCountOrder,
} from '../../scripts/src/lib/sold-counts.js';
import { fromWallClock, toWallClockInZone } from '../../scripts/src/lib/time.js';
import {
  groupsToText,
  parseGroups,
} from '../../apps/organizer/src/app/(dash)/tickets/ticket-setup/1-1-create-tickets/groups.js';

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

async function clear(collection: string) {
  const snap = await db.collection(collection).where('eventId', '==', EVENT_ID).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  await clear(COLLECTIONS.orders);
});

/** One order in the shape the fulfilment path actually writes. */
async function writeOrder(id: string, o: Partial<OrderDoc>) {
  await db
    .collection(COLLECTIONS.orders)
    .doc(id)
    .set({
      eventId: EVENT_ID,
      externalId: id,
      provider: 'stripe',
      channel: 'checkout',
      email: `${id}@example.com`,
      status: 'paid',
      items: [
        {
          ticketTypeId: 'main-conference',
          ticketTypeName: 'Main Conference',
          quantity: 1,
          unitPriceCents: 79_900,
        },
      ],
      totalCents: 79_900,
      currency: 'usd',
      purchasedAt: Timestamp.now(),
      ...o,
    });
}

async function readOrders(): Promise<SoldCountOrder[]> {
  const snap = await db.collection(COLLECTIONS.orders).where('eventId', '==', EVENT_ID).get();
  return snap.docs.map((d) => d.data() as SoldCountOrder);
}

describe('the sold count, recomputed from the ledger', () => {
  it('gives back the seats a refund consumed — the ratchet this exists to undo', async () => {
    await writeOrder('paid-1', {});
    await writeOrder('paid-2', {});
    await writeOrder('refunded-1', { status: 'refunded', refundedCents: 79_900 });

    const counts = soldByTier(await readOrders());
    expect(counts.get('main-conference')).toBe(2);

    // The tier document still claims three, because nothing decrements it.
    const drift = soldCountDrift([{ id: 'main-conference', quantitySold: 3 }], await readOrders());
    expect(drift).toEqual([
      { ticketTypeId: 'main-conference', stored: 3, computed: 2, delta: -1 },
    ]);
  });

  it('counts an invoice as one order with several seats, not one order per seat', async () => {
    // The shape is the trap: an invoice writes one document whose `items` carry
    // the quantities. Counting documents would say 1 where the room needs 6.
    await writeOrder('inv-1', {
      channel: 'invoice',
      items: [
        { ticketTypeId: 'main-conference', ticketTypeName: 'Main Conference', quantity: 4, unitPriceCents: 79_900 },
        { ticketTypeId: 'workshops', ticketTypeName: 'Workshops', quantity: 2, unitPriceCents: 69_900 },
      ],
      totalCents: 459_400,
    });

    const counts = soldByTier(await readOrders());
    expect(counts.get('main-conference')).toBe(4);
    expect(counts.get('workshops')).toBe(2);
  });

  it('keeps a partially refunded seat sold, because the ticket is still valid', async () => {
    await writeOrder('part-1', { status: 'partially_refunded', refundedCents: 10_000 });
    expect(soldByTier(await readOrders()).get('main-conference')).toBe(1);
  });

  it('leaves an unpaid invoice out of the sold count and reports it separately', async () => {
    // Capacity spoken for is not capacity sold — but it is the number that
    // decides whether the next card sale oversells the room, because the
    // capacity check happens when the invoice is raised and not when it is paid.
    await writeOrder('inv-pending', {
      status: 'pending',
      channel: 'invoice',
      items: [{ ticketTypeId: 'main-conference', ticketTypeName: 'Main Conference', quantity: 6, unitPriceCents: 79_900 }],
    });

    const orders = await readOrders();
    expect(soldByTier(orders).size).toBe(0);
    expect(outstandingSeatsByTier(orders).get('main-conference')).toBe(6);
  });

  it('excludes a demo order, which is a real document by design', async () => {
    await writeOrder('demo-1', { channel: 'demo' });
    expect(soldByTier(await readOrders()).size).toBe(0);
  });
});

describe('the grouped "what’s included" list', () => {
  it('round-trips the shape the seeded headline tiers actually carry', () => {
    // This is `all-access` as `scripts/src/lib/ticket-types.ts` seeds it,
    // including the third group that is a heading with no bullets. If that
    // group is lost in a round trip, saving the ticket silently deletes a line
    // from the panel a buyer reads.
    const groups = [
      {
        heading: 'All In-person Sessions',
        items: ['Both workshop days, Monday and Tuesday', 'Every conference session'],
      },
      { heading: 'All Virtual Sessions', items: ['Live streams of every session'] },
      { heading: 'KGC Video Library Subscription (3 months)', items: [] },
    ];

    expect(parseGroups(groupsToText(groups))).toEqual(groups);
  });

  it('reads a flush-left line as a heading and a dashed line as its bullet', () => {
    expect(parseGroups('Heading\n- one\n- two')).toEqual([
      { heading: 'Heading', items: ['one', 'two'] },
    ]);
  });

  it('accepts the bullet characters people actually paste in', () => {
    expect(parseGroups('Heading\n• one\n* two')).toEqual([
      { heading: 'Heading', items: ['one', 'two'] },
    ]);
  });

  it('refuses a bullet with no heading above it rather than inventing one', () => {
    // Filing bullets under a heading nobody typed is how ticket copy ends up
    // saying something the organizer did not write.
    expect(parseGroups('- orphan')).toBeNull();
  });

  it('treats an empty box as "no groups", which falls back to the flat list', () => {
    expect(parseGroups('')).toEqual([]);
    expect(parseGroups('\n\n  \n')).toEqual([]);
  });

  it('drops blank lines between groups without starting a new one', () => {
    expect(parseGroups('A\n- one\n\n\nB\n- two')).toEqual([
      { heading: 'A', items: ['one'] },
      { heading: 'B', items: ['two'] },
    ]);
  });

  it('ignores a bare dash rather than adding an empty bullet', () => {
    expect(parseGroups('A\n- one\n-\n')).toEqual([{ heading: 'A', items: ['one'] }]);
  });
});

describe('the sales window', () => {
  it('closes an early-bird deadline at the event’s midnight, not the server’s', () => {
    // 23:59 on 30 April in New York is 03:59Z on 1 May. Parsed with a bare
    // `new Date()` on a UTC host it would be 23:59Z — four hours of sales
    // earlier than the organizer meant, on the day it matters most.
    const closes = fromWallClock('2027-04-30T23:59', TIME_ZONE);
    expect(closes.toDate().toISOString()).toBe('2027-05-01T03:59:00.000Z');
  });

  it('uses the right offset either side of the daylight-saving change', () => {
    // A window that opens in January (EST, UTC-5) and closes in May (EDT,
    // UTC-4). Storing a fixed offset would put one of the two an hour out.
    expect(fromWallClock('2027-01-15T09:00', TIME_ZONE).toDate().toISOString()).toBe(
      '2027-01-15T14:00:00.000Z',
    );
    expect(fromWallClock('2027-05-15T09:00', TIME_ZONE).toDate().toISOString()).toBe(
      '2027-05-15T13:00:00.000Z',
    );
  });

  it('round-trips a wall clock through the instant and back unchanged', () => {
    // What reopening the ticket editor does. If this drifts, every save shifts
    // the deadline by the offset again.
    for (const local of ['2027-04-30T23:59', '2027-01-15T09:00', '2027-07-04T00:00']) {
      expect(toWallClockInZone(fromWallClock(local, TIME_ZONE).toDate(), TIME_ZONE)).toBe(local);
    }
  });

  it('refuses an ISO instant, because the zone is supplied separately', () => {
    expect(() => fromWallClock('2027-04-30T23:59:00Z', TIME_ZONE)).toThrow();
  });
});
