/**
 * What a refund event means for an order — the decision, without the writes.
 *
 * Split out of `registrations.ts` for the reason `conflicts-core.ts` is split
 * out of `conflicts.ts`: that module imports `server-only` and therefore cannot
 * be loaded by Vitest at all, so until now `tests/commerce/fulfilment.test.ts`
 * pinned these rules by **re-implementing them** beside the real ones and
 * saying so in a comment. Two copies of a refund rule is exactly the shape of
 * bug this file exists to prevent, and the copy in the test would agree with
 * itself for ever while the real one drifted.
 *
 * Three decisions live here, and each of them has a way of being silently
 * wrong.
 *
 * **A partial refund is not a cancelled ticket.** Refunding $200 of an $800
 * registration — a workshop day dropped, a goodwill gesture — leaves somebody
 * who is still coming. Revoking their badge for it is worse than the bug
 * refunds exist to fix, because it is silent until they are at the door.
 *
 * **A refund is not a chargeback and neither is a failed payment.** All three
 * arrive here, and only one of them means money went back.
 *
 * **A replay is not a second refund.** Stripe redelivers `charge.refunded` for
 * up to three days and reports the same cumulative `amount_refunded` on every
 * delivery, so "is this a full refund?" answers yes every time. Anything that
 * must happen once — giving a seat back to `quantitySold`, withdrawing an
 * entitlement — has to ask `newlyRefunded` instead, which is answered from the
 * order's status *before* this delivery touched it.
 */

import type { OrderDoc } from '@kgc/shared';

export type RefundReason = 'refunded' | 'disputed' | 'payment_failed';

export interface RefundDecision {
  /** False for a partial refund, which leaves the ticket valid. */
  fullyRefunded: boolean;
  /** True only on the delivery that actually voided the ticket. The replay guard. */
  newlyRefunded: boolean;
  status: OrderDoc['status'];
  /** A date only when money actually went back. See below. */
  stampRefundedAt: boolean;
  /** The seats to give back, one entry per order line that names a tier. */
  lines: { ticketTypeId: string; quantity: number }[];
}

export function decideRefund(
  order: Pick<OrderDoc, 'status' | 'totalCents' | 'items'>,
  input: {
    reason: RefundReason;
    /**
     * Cumulative amount refunded on the charge, in minor units, as Stripe
     * reports it. Absent means "treat as a full refund", which is the right
     * reading for a dispute or a failed payment.
     */
    refundedCents?: number;
  },
): RefundDecision {
  const refunded = input.refundedCents ?? order.totalCents;
  const fullyRefunded = input.reason !== 'refunded' || refunded >= order.totalCents;

  const status: OrderDoc['status'] =
    input.reason === 'refunded' ? (fullyRefunded ? 'refunded' : 'partially_refunded') : 'cancelled';

  /**
   * Already void before this delivery arrived?
   *
   * `partially_refunded` is deliberately *not* in this set. A seat that was
   * still sold a moment ago and is not now has genuinely just been released,
   * and whoever counts seats has to hear about it exactly once — on the
   * delivery that made it true, not on the one that made it half true.
   */
  const wasVoid = order.status === 'refunded' || order.status === 'cancelled';

  return {
    fullyRefunded,
    newlyRefunded: fullyRefunded && !wasVoid,
    status,
    /**
     * `refundedAt` marks a refund and nothing else.
     *
     * This used to be stamped for all three reasons, so an expired Checkout
     * session — nothing charged, nothing returned — came out carrying a refund
     * date, and Transaction History rendered a "refunded" row for a sale that
     * never happened. A dispute is excluded for a different reason: a
     * chargeback is money *held*, not money returned, and it may yet come back.
     */
    stampRefundedAt: input.reason === 'refunded',
    lines: (order.items ?? [])
      .filter((i) => i.ticketTypeId)
      .map((i) => ({ ticketTypeId: i.ticketTypeId, quantity: i.quantity ?? 1 })),
  };
}
