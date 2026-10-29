/**
 * What an order's status is called on the dashboard (T357).
 *
 * ── Why `cancelled` is not shown as "cancelled" ─────────────────────────────
 *
 * `OrderDoc.status` is `cancelled` for two unrelated things. Almost all of them
 * are Stripe Checkout sessions that expired with no payment ever attempted:
 * `cancelUnpaidOrder` in `apps/web` writes a $0 stub for a single-seat checkout,
 * or flips a pending multi-seat cart. The rest are chargebacks, told apart by
 * `disputedAt`. A course-team member read "cancelled" as somebody who stopped a
 * payment halfway, which is neither. So the dashboard names the two cases, and
 * the stored value stays as it is: the website, the webhook and every export
 * consumer still read `cancelled`.
 *
 * A chargeback cancels the order when the dispute is opened, not when it is
 * lost (`charge.dispute.created`), so the hint says what happened to the
 * tickets and leaves the outcome to Stripe.
 *
 * Plain TypeScript: no Firestore import, no React. Tested beside it.
 */

export type OrderStatusTone = 'green' | 'red' | 'orange' | 'grey';

export interface OrderStatusLabel {
  /** What the chip, the filter tab and the export's readable column say. */
  label: string;
  /** The chip colour. Red is kept for money that went back or is contested. */
  tone: OrderStatusTone;
  /** One or two sentences for a tooltip, where the label alone can mislead. */
  hint?: string;
}

export const NOT_COMPLETED_HINT =
  'Started checkout but never paid. The payment page closed after 60 minutes. No money was taken.';

export const CHARGEBACK_HINT =
  'The buyer disputed the payment with their bank, so the tickets were withdrawn. The dispute is handled in Stripe.';

/**
 * The Attendee Orders filter an order falls under. `cancelled` splits in two,
 * so the "Not completed" tab never counts a chargeback. An old link with
 * `?status=cancelled` still matches both (`matchesOrderFilter`).
 */
export function orderFilterOf(order: { status: string; disputedAt?: unknown }): string {
  if (order.status === 'cancelled') return order.disputedAt ? 'chargeback' : 'not_completed';
  return order.status;
}

export function matchesOrderFilter(order: { status: string; disputedAt?: unknown }, filter: string): boolean {
  if (!filter) return true;
  if (filter === 'cancelled') return order.status === 'cancelled';
  return orderFilterOf(order) === filter;
}

export function orderStatusLabel(order: { status: string; disputedAt?: unknown }): OrderStatusLabel {
  switch (order.status) {
    case 'paid':
      return { label: 'paid', tone: 'green' };
    case 'refunded':
      return { label: 'refunded', tone: 'red' };
    case 'partially_refunded':
      return { label: 'partially refunded', tone: 'orange' };
    case 'pending':
      return { label: 'pending', tone: 'grey' };
    case 'cancelled':
      return order.disputedAt
        ? { label: 'Chargeback', tone: 'red', hint: CHARGEBACK_HINT }
        : { label: 'Not completed', tone: 'grey', hint: NOT_COMPLETED_HINT };
    default:
      return { label: order.status.replace(/_/g, ' '), tone: 'grey' };
  }
}
