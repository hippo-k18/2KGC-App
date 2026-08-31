/**
 * Recomputing `ticketTypes.quantitySold` from the `orders` ledger.
 *
 * ── Why this has to exist ───────────────────────────────────────────────────
 *
 * `quantitySold` is incremented at fulfilment and **never decremented**. That
 * is a deliberate simplification everywhere it appears — the increment is
 * best-effort and must never fail a sale — but it makes the number a one-way
 * ratchet: ten refunds permanently consume ten seats of a capped tier, and the
 * only lever an organizer has is to inflate `quantityTotal`, which then lies on
 * every "12 / 16 sold" readout on the dashboard.
 *
 * The increments also swallow their own failures (`apps/web/src/lib/
 * catalogue.ts`, `apps/organizer/src/lib/manual-orders.ts` both log and carry
 * on), so the counter can drift *low* as well as high. Either way the number
 * that decides whether a tier is sold out has never had anything to check it
 * against.
 *
 * The ledger does. `orders` records what was actually charged, one
 * `OrderLine.ticketTypeId` per tier per order, and it is the only thing on the
 * money path that is written transactionally with the sale rather than after
 * it. So the counter is derivable, and this is the derivation.
 *
 * ── Which orders count as a sold seat ───────────────────────────────────────
 *
 * `paid` and `partially_refunded` — the same pair `salesSummary()` treats as
 * counted revenue, and for the same reason. A partial refund leaves a valid
 * ticket (one seat of four went back; three people are still coming), so the
 * seat is still consumed. `refunded` is not counted: that is precisely the
 * shrinkage this exists to undo. `pending` is not counted either — an invoice
 * that has been raised and not paid has no seat behind it yet, and counting it
 * would let an unpaid invoice close a tier.
 *
 * ⚠️ That last choice is the reason this is a *reconcile* rather than a live
 * derivation: an unpaid invoice is capacity that is spoken for but not sold,
 * and the sold counter is not where that belongs. See `outstandingSeatsByTier`
 * for the other half.
 *
 * Pure and dependency-free so it can be tested against fixtures without an
 * emulator, and so exactly one implementation serves both the ops script and
 * the dashboard's drift readout.
 */

/** The slice of an order this computation needs. */
export interface SoldCountOrder {
  status: 'paid' | 'refunded' | 'partially_refunded' | 'pending' | 'cancelled';
  /** `demo` orders are test purchases and are excluded. */
  channel?: 'checkout' | 'invoice' | 'manual' | 'demo';
  items?: { ticketTypeId?: string; quantity?: number }[];
}

/** Statuses that consume a seat. */
function consumesSeat(status: SoldCountOrder['status']): boolean {
  return status === 'paid' || status === 'partially_refunded';
}

/**
 * A line's seat count.
 *
 * `quantity` is absent on orders written before invoicing existed, and absent
 * means one — those were all single-seat Checkout sales. Reading it as zero
 * would silently un-count every historic order.
 */
function seatsOf(line: { quantity?: number }): number {
  const q = line.quantity;
  return typeof q === 'number' && Number.isFinite(q) && q > 0 ? Math.floor(q) : 1;
}

/**
 * Seats sold per tier id, from the ledger.
 *
 * Tiers with no sales are absent rather than zero — the caller knows the
 * catalogue and this function only knows the orders, so inventing a zero here
 * would be indistinguishable from "this tier does not exist any more".
 */
export function soldByTier(orders: SoldCountOrder[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const o of orders) {
    if (o.channel === 'demo') continue;
    if (!consumesSeat(o.status)) continue;
    for (const line of o.items ?? []) {
      // An order written before `ticketTypeId` was carried, or pointing at a
      // tier since deleted, cannot be attributed. Counting it under a made-up
      // key would move seats into a tier nobody sells.
      if (!line.ticketTypeId) continue;
      counts.set(line.ticketTypeId, (counts.get(line.ticketTypeId) ?? 0) + seatsOf(line));
    }
  }
  return counts;
}

/**
 * Seats on invoices that have been raised and not paid.
 *
 * Not part of `quantitySold` — nobody has bought these — but the number an
 * organizer needs beside it, because capacity is checked when an invoice is
 * *raised* and not again when it is paid. On net-30 terms that is a thirty-day
 * window in which a capped tier can be sold out from under an invoice, and the
 * oversell arrives as a fait accompli. Surfacing "12 sold, 6 more invoiced,
 * cap 16" is what turns that into a decision somebody makes on purpose.
 */
export function outstandingSeatsByTier(orders: SoldCountOrder[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const o of orders) {
    if (o.channel === 'demo') continue;
    if (o.status !== 'pending' || o.channel !== 'invoice') continue;
    for (const line of o.items ?? []) {
      if (!line.ticketTypeId) continue;
      counts.set(line.ticketTypeId, (counts.get(line.ticketTypeId) ?? 0) + seatsOf(line));
    }
  }
  return counts;
}

export interface SoldCountDrift {
  ticketTypeId: string;
  /** What the tier document currently claims. */
  stored: number;
  /** What the ledger says. */
  computed: number;
  /** `computed - stored`. Negative means the counter has ratcheted too high. */
  delta: number;
}

/**
 * What a reconcile would change, as data.
 *
 * Returned rather than applied so the ops script can print a plan and refuse to
 * write without `--apply`. A job that silently rewrites the number deciding
 * whether a tier is sold out is a job nobody should run on the morning of an
 * event without reading it first.
 *
 * Tiers absent from the ledger are still reported when they claim a non-zero
 * count, because "the catalogue says 4 sold and there are no orders" is exactly
 * the drift worth seeing.
 */
export function soldCountDrift(
  tiers: { id: string; quantitySold: number }[],
  orders: SoldCountOrder[],
): SoldCountDrift[] {
  const computedAll = soldByTier(orders);
  return tiers
    .map((t) => {
      const computed = computedAll.get(t.id) ?? 0;
      return {
        ticketTypeId: t.id,
        stored: t.quantitySold,
        computed,
        delta: computed - t.quantitySold,
      };
    })
    .filter((d) => d.delta !== 0)
    .sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId));
}
