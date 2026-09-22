import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';

import { currentHolder, stillPaidElsewhere } from './fulfilment.js';

/**
 * The two questions a refund has to answer before it takes a ticket away:
 * whose ticket is this now, and is anything else still paying for it.
 *
 * Both were wrong in production within a week of each other and neither had a
 * test, because the only suite that could reach them needs the emulator and a
 * database it is allowed to empty. They take their store as an argument, so a
 * stand-in Firestore is all it costs to pin them here, where `npm test` runs.
 * `tests/commerce/fulfilment.test.ts` drives the real refund on real documents;
 * this pins the rules underneath it.
 *
 * Every case below is a way one of them has been, or could easily be, wrong:
 *
 *   - a refund cancelling the buyer's dead document and leaving the new
 *     holder's badge scanning at the door;
 *   - a chain of two transfers stopping at the middle one;
 *   - a cycle written by a repair gone wrong, looping inside a Stripe webhook
 *     until the request times out and Stripe retries it for three days;
 *   - the "bought twice" guard asked about only one of the two people a
 *     transferred ticket belongs to, so a second still-paid order stops
 *     protecting it.
 */

type Docs = Record<string, Record<string, unknown>>;

/**
 * Enough Firestore to answer the reads these two make: a document by id, and an
 * equality-filtered collection query. Anything else is deliberately absent —
 * the moment one of them needs more, this stops compiling rather than quietly
 * answering the wrong question.
 */
function fakeStore(data: { registrations?: Docs; orders?: Docs }): Firestore {
  const collections: Record<string, Docs> = {
    [COLLECTIONS.registrations]: data.registrations ?? {},
    [COLLECTIONS.orders]: data.orders ?? {},
  };

  const query = (name: string, filters: [string, unknown][]) => ({
    where: (field: string, _op: string, value: unknown) =>
      query(name, [...filters, [field, value]]),
    get: async () => ({
      docs: Object.entries(collections[name] ?? {})
        .filter(([, doc]) => filters.every(([field, value]) => doc[field] === value))
        .map(([id, doc]) => ({ id, data: () => doc })),
    }),
  });

  return {
    collection: (name: string) => ({
      doc: (id: string) => ({ get: async () => ({ data: () => collections[name]?.[id] }) }),
      where: (field: string, _op: string, value: unknown) => query(name, [[field, value]]),
    }),
  } as unknown as Firestore;
}

const registration = (o: Record<string, unknown>) => ({
  eventId: EVENT_ID,
  status: 'active',
  ...o,
});

const order = (o: Record<string, unknown>) => ({
  eventId: EVENT_ID,
  status: 'paid',
  ...o,
});

describe('currentHolder', () => {
  it('is the registration itself when the ticket never moved', async () => {
    const store = fakeStore({
      registrations: { reg_ada: registration({ email: 'ada@example.com', name: 'Ada Nakamura' }) },
    });

    expect(await currentHolder(store, 'reg_ada')).toEqual({
      id: 'reg_ada',
      email: 'ada@example.com',
      name: 'Ada Nakamura',
      status: 'active',
    });
  });

  it('follows a transfer to whoever holds the seat now', async () => {
    const store = fakeStore({
      registrations: {
        reg_ada: registration({
          email: 'ada@example.com',
          status: 'transferred',
          transferredTo: 'reg_ben',
        }),
        reg_ben: registration({ email: 'ben@example.com', name: 'Ben Olsen' }),
      },
    });

    const holder = await currentHolder(store, 'reg_ada');
    expect(holder?.id).toBe('reg_ben');
    expect(holder?.email).toBe('ben@example.com');
    expect(holder?.status).toBe('active');
  });

  it('follows a chain of two transfers to the end', async () => {
    // A ticket can be passed on more than once, and stopping at the first hop
    // cancels a document that is just as dead as the one it started from.
    const store = fakeStore({
      registrations: {
        reg_ada: registration({
          email: 'ada@example.com',
          status: 'transferred',
          transferredTo: 'reg_ben',
        }),
        reg_ben: registration({
          email: 'ben@example.com',
          status: 'transferred',
          transferredTo: 'reg_cara',
        }),
        reg_cara: registration({ email: 'cara@example.com' }),
      },
    });

    expect((await currentHolder(store, 'reg_ada'))?.id).toBe('reg_cara');
  });

  it('gives up on a cycle rather than looping inside a webhook', async () => {
    const store = fakeStore({
      registrations: {
        reg_ada: registration({
          email: 'ada@example.com',
          status: 'transferred',
          transferredTo: 'reg_ben',
        }),
        reg_ben: registration({
          email: 'ben@example.com',
          status: 'transferred',
          transferredTo: 'reg_ada',
        }),
      },
    });

    expect(await currentHolder(store, 'reg_ada')).toBeNull();
  });

  it('answers null for a registration that is not there', async () => {
    // An abandoned multi-seat cart writes an order with the buyer's address and
    // no registration. The caller must skip, not update a missing document.
    expect(await currentHolder(fakeStore({}), 'reg_nobody')).toBeNull();
  });

  it('answers null when the chain points at a document that has been deleted', async () => {
    const store = fakeStore({
      registrations: {
        reg_ada: registration({
          email: 'ada@example.com',
          status: 'transferred',
          transferredTo: 'reg_gone',
        }),
      },
    });

    expect(await currentHolder(store, 'reg_ada')).toBeNull();
  });

  it('will not step into another event', async () => {
    const store = fakeStore({
      registrations: { reg_ada: { eventId: 'some-other-event', email: 'ada@example.com' } },
    });

    expect(await currentHolder(store, 'reg_ada')).toBeNull();
  });
});

describe('stillPaidElsewhere', () => {
  it('is false when the only order is the one being refunded', async () => {
    const store = fakeStore({ orders: { ord_one: order({ email: 'ada@example.com' }) } });

    expect(await stillPaidElsewhere(store, ['ada@example.com'], 'ord_one')).toBe(false);
  });

  it('is true when the same person has a second paid order', async () => {
    // The workshop upgrade refunded, the main-conference ticket still paid for.
    const store = fakeStore({
      orders: {
        ord_main: order({ email: 'ada@example.com' }),
        ord_upgrade: order({ email: 'ada@example.com', status: 'refunded' }),
      },
    });

    expect(await stillPaidElsewhere(store, ['ada@example.com'], 'ord_upgrade')).toBe(true);
  });

  it("protects a transferred ticket through the buyer's other order", async () => {
    // Ada bought twice and gave one ticket to Ben. Ben has no orders at all, so
    // asking only the holder says nothing is paying for this seat and cancels
    // him. The order that still pays is on the buyer's address.
    const store = fakeStore({
      orders: {
        ord_main: order({ email: 'ada@example.com' }),
        ord_upgrade: order({ email: 'ada@example.com' }),
      },
    });

    expect(
      await stillPaidElsewhere(store, ['ada@example.com', 'ben@example.com'], 'ord_upgrade'),
    ).toBe(true);
  });

  it("protects a transferred ticket through the holder's own order", async () => {
    // The other direction: a colleague handed this seat who also bought one of
    // their own keeps the one they paid for.
    const store = fakeStore({
      orders: {
        ord_group: order({ email: 'ada@example.com' }),
        ord_ben: order({ email: 'ben@example.com' }),
      },
    });

    expect(
      await stillPaidElsewhere(store, ['ada@example.com', 'ben@example.com'], 'ord_group'),
    ).toBe(true);
  });

  it('counts a partially refunded order as still paying for the ticket', async () => {
    // $200 back on an $800 registration: they are still coming.
    const store = fakeStore({
      orders: {
        ord_partial: order({ email: 'ada@example.com', status: 'partially_refunded' }),
        ord_other: order({ email: 'ada@example.com', status: 'refunded' }),
      },
    });

    expect(await stillPaidElsewhere(store, ['ada@example.com'], 'ord_other')).toBe(true);
  });

  it('does not count an order that was never paid', async () => {
    const store = fakeStore({
      orders: {
        ord_pending: order({ email: 'ada@example.com', status: 'pending' }),
        ord_cancelled: order({ email: 'ada@example.com', status: 'cancelled' }),
        ord_refunded: order({ email: 'ada@example.com', status: 'refunded' }),
        ord_this: order({ email: 'ada@example.com' }),
      },
    });

    expect(await stillPaidElsewhere(store, ['ada@example.com'], 'ord_this')).toBe(false);
  });

  it('asks about the address as it is stored, whatever case it arrives in', async () => {
    const store = fakeStore({
      orders: {
        ord_main: order({ email: 'ada@example.com' }),
        ord_upgrade: order({ email: 'ada@example.com', status: 'refunded' }),
      },
    });

    expect(await stillPaidElsewhere(store, ['Ada.Nakamura@Example.com'], 'ord_upgrade')).toBe(
      false,
    );
    expect(await stillPaidElsewhere(store, [' Ada@Example.com '], 'ord_upgrade')).toBe(true);
  });

  it('ignores an address that is not there at all', async () => {
    const store = fakeStore({ orders: { ord_one: order({ email: 'ada@example.com' }) } });

    expect(await stillPaidElsewhere(store, [null, undefined, ''], 'ord_one')).toBe(false);
  });
});
