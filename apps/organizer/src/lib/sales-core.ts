import type { OrderDoc } from '@kgc/shared';

/**
 * The discount-code split behind the Summary screen, with no Firestore handle.
 *
 * ── Deliberately NOT `server-only` ──────────────────────────────────────────
 *
 * `commerce.ts` carries it and is unreachable from a test process, the same
 * arrangement `attendees-core.ts` has with `data.ts`. The grouping is the part
 * worth pinning, because every rule in it is a way the report could quietly lie
 * about money: a code that reads as two rows because somebody typed it in lower
 * case, a discount that disappears from the page because no code was attached
 * to it, or a refunded order still counted as a redemption.
 *
 * ── Why the code comes off the order and not out of Stripe ──────────────────
 *
 * Stripe owns the coupon table and `discount-codes.ts` reads it live, which is
 * right for "is this code still valid". It is the wrong source for "what did
 * this code earn": Stripe's redemption counter counts every checkout that used
 * the code, including the ones that were refunded afterwards, and it knows
 * nothing about an order this event later cancelled. The order document records
 * what was actually charged, so that is what this counts.
 */

/** The slice of an order the split reads. `OrderRow` already satisfies it. */
export interface CodedOrder {
  status: OrderDoc['status'];
  seatCount: number;
  /** What was charged, after the code came off. */
  totalCents: number;
  /** What the event keeps: total minus anything sent back. */
  netCents: number;
  /** What the code took off. */
  discountCents: number;
  promotionCode?: string;
}

export interface CodeSales {
  /** As the buyer typed it, folded the way Stripe stores it. */
  code: string;
  orders: number;
  /** Orders that went back in full. They are in `orders` too. */
  refunded: number;
  tickets: number;
  discountCents: number;
  grossCents: number;
  netCents: number;
}

export interface CodeSplit {
  codes: CodeSales[];
  /** Settled orders that carried no code at all. */
  ordersWithoutCode: number;
  /**
   * Money taken off orders that carry no code — a hand-built order priced below
   * the list, say. Kept separate rather than folded into a row, because
   * attributing it to a code would invent a redemption that never happened, and
   * dropping it would make the rows fail to add up to "Discounts applied".
   */
  discountWithoutCodeCents: number;
}

/**
 * Stripe upper-cases a promotion code, and an order written by hand may not
 * have. Folding here is what stops `speaker25` and `SPEAKER25` reading as two
 * codes that each earned half the money.
 */
export function codeKey(raw: string | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

/**
 * One row per discount code used, biggest earner first.
 *
 * Takes orders that are already filtered to the ones the rest of the Summary
 * counts — real, settled, not pending and not cancelled — so this function
 * never has to agree separately with the totals above it on the same page.
 */
export function salesByCode(orders: readonly CodedOrder[]): CodeSplit {
  const byCode = new Map<string, CodeSales>();
  let ordersWithoutCode = 0;
  let discountWithoutCodeCents = 0;

  for (const o of orders) {
    const code = codeKey(o.promotionCode);
    if (!code) {
      ordersWithoutCode += 1;
      discountWithoutCodeCents += o.discountCents;
      continue;
    }

    const row = byCode.get(code) ?? {
      code,
      orders: 0,
      refunded: 0,
      tickets: 0,
      discountCents: 0,
      grossCents: 0,
      netCents: 0,
    };
    row.orders += 1;
    row.refunded += o.status === 'refunded' ? 1 : 0;
    // A refunded order sold nothing in the end, so its seats do not count as
    // tickets the code moved. Its money stays visible in gross and net.
    row.tickets += o.status === 'refunded' ? 0 : o.seatCount;
    row.discountCents += o.discountCents;
    row.grossCents += o.totalCents;
    row.netCents += o.netCents;
    byCode.set(code, row);
  }

  return {
    // Net, not gross: the question this table answers is what each code was
    // worth once the refunds it attracted are out of it.
    codes: [...byCode.values()].sort((a, b) => b.netCents - a.netCents || a.code.localeCompare(b.code)),
    ordersWithoutCode,
    discountWithoutCodeCents,
  };
}
