import { describe, expect, it } from 'vitest';

import {
  outstandingSeatsByTier,
  soldByTier,
  soldCountDrift,
  type SoldCountOrder,
} from './sold-counts.js';

/**
 * The arithmetic behind "is this tier sold out?".
 *
 * Every case here is a way the stored counter has drifted or could drift from
 * the ledger, and every one of them is silent in production: the number looks
 * plausible, the tier closes early or late, and nothing on any screen explains
 * it. A wrong reconcile is worse than no reconcile — it would overwrite the
 * only number the sold-out check consults — so the fold is pinned rather than
 * trusted.
 */

const order = (o: Partial<SoldCountOrder>): SoldCountOrder => ({
  status: 'paid',
  channel: 'checkout',
  items: [{ ticketTypeId: 'main-conference', quantity: 1 }],
  ...o,
});

describe('soldByTier', () => {
  it('counts a paid seat', () => {
    expect(soldByTier([order({})])).toEqual(new Map([['main-conference', 1]]));
  });

  it('does not count a refunded order — that is the ratchet this undoes', () => {
    const counts = soldByTier([order({}), order({ status: 'refunded' })]);
    expect(counts.get('main-conference')).toBe(1);
  });

  it('still counts a partially refunded order, because the ticket is still valid', () => {
    // One seat of four went back; three people are still coming. Treating this
    // as a cancellation would free seats that are occupied.
    const counts = soldByTier([order({ status: 'partially_refunded' })]);
    expect(counts.get('main-conference')).toBe(1);
  });

  it('does not count an unpaid invoice', () => {
    // Capacity spoken for is not capacity sold. Counting it here would let an
    // invoice nobody has paid close a tier.
    const counts = soldByTier([order({ status: 'pending', channel: 'invoice' })]);
    expect(counts.size).toBe(0);
  });

  it('does not count a cancelled order', () => {
    expect(soldByTier([order({ status: 'cancelled' })]).size).toBe(0);
  });

  it('excludes demo orders, which are real documents by design', () => {
    // A rehearsal writes a genuine order so the demo is faithful. Letting it
    // into the counter would consume seats nobody bought.
    const counts = soldByTier([order({ channel: 'demo' })]);
    expect(counts.size).toBe(0);
  });

  it('sums the seats on a multi-line invoice — one order, several items', () => {
    // An invoice is *one* order with several `items`, not one order per seat.
    const counts = soldByTier([
      order({
        channel: 'invoice',
        items: [
          { ticketTypeId: 'main-conference', quantity: 4 },
          { ticketTypeId: 'workshops', quantity: 2 },
        ],
      }),
    ]);
    expect(counts.get('main-conference')).toBe(4);
    expect(counts.get('workshops')).toBe(2);
  });

  it('reads a missing quantity as one seat, not as zero', () => {
    // Orders written before invoicing existed carry no `quantity`; they were
    // all single-seat Checkout sales. Reading absent as zero would un-count
    // every historic order the first time this ran.
    const counts = soldByTier([order({ items: [{ ticketTypeId: 'all-access' }] })]);
    expect(counts.get('all-access')).toBe(1);
  });

  it('ignores a line with no ticket type rather than inventing a key', () => {
    const counts = soldByTier([order({ items: [{ quantity: 3 }] })]);
    expect(counts.size).toBe(0);
  });

  it('reports nothing for a tier with no sales, rather than zero', () => {
    // This function knows the orders and not the catalogue. A zero here would
    // be indistinguishable from a tier that no longer exists.
    expect(soldByTier([]).has('main-conference')).toBe(false);
  });
});

describe('outstandingSeatsByTier', () => {
  it('counts seats on a raised, unpaid invoice', () => {
    const counts = outstandingSeatsByTier([
      order({
        status: 'pending',
        channel: 'invoice',
        items: [{ ticketTypeId: 'main-conference', quantity: 6 }],
      }),
    ]);
    expect(counts.get('main-conference')).toBe(6);
  });

  it('does not count a paid invoice twice — it is a sold seat by then', () => {
    const counts = outstandingSeatsByTier([order({ status: 'paid', channel: 'invoice' })]);
    expect(counts.size).toBe(0);
  });

  it('does not count a pending card order, which has no invoice behind it', () => {
    const counts = outstandingSeatsByTier([order({ status: 'pending', channel: 'checkout' })]);
    expect(counts.size).toBe(0);
  });
});

describe('soldCountDrift', () => {
  it('reports the ratchet — stored higher than the ledger after a refund', () => {
    const drift = soldCountDrift(
      [{ id: 'main-conference', quantitySold: 3 }],
      [order({}), order({ status: 'refunded' }), order({ status: 'refunded' })],
    );
    expect(drift).toEqual([
      { ticketTypeId: 'main-conference', stored: 3, computed: 1, delta: -2 },
    ]);
  });

  it('reports a counter that drifted low, when a best-effort increment was lost', () => {
    const drift = soldCountDrift([{ id: 'workshops', quantitySold: 0 }], [
      order({ items: [{ ticketTypeId: 'workshops', quantity: 1 }] }),
    ]);
    expect(drift[0].delta).toBe(1);
  });

  it('says nothing about a tier that already agrees with the ledger', () => {
    expect(soldCountDrift([{ id: 'main-conference', quantitySold: 1 }], [order({})])).toEqual([]);
  });

  it('reports a tier claiming sales the ledger has never seen', () => {
    const drift = soldCountDrift([{ id: 'ghost', quantitySold: 4 }], []);
    expect(drift[0]).toEqual({ ticketTypeId: 'ghost', stored: 4, computed: 0, delta: -4 });
  });
});
