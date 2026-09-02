import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type OrderDoc, type OrderLine } from '@kgc/shared';
import { normaliseEmail } from '@kgc/scripts/src/lib/ids';
import { db } from '@/lib/firestore';
import { invoiceOrderId } from '@/lib/registrations';

/**
 * The seat list for a multi-seat card purchase, written down before the buyer
 * is redirected and read back by the webhook.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * The buyer leaves this origin entirely at Checkout. Everything the webhook
 * learns about the purchase comes back through the Stripe session, and a
 * session carries exactly one place to put our own data: `metadata`, capped at
 * **500 characters per value**. `raiseInvoice` already stashes an attendee list
 * there and truncates it to 480, and `registrations.ts` records what that costs
 * — an invoice for enough people yields a cut-off JSON string, the parse
 * returns an empty list *by design*, and the webhook registers nobody at the
 * exact moment a company has just paid for eight tickets.
 *
 * So the seat list is not metadata. It is a Firestore document, written before
 * the redirect, keyed by the Checkout session id.
 *
 * ── Why it is an `orders` document rather than a new collection ─────────────
 *
 * Because the invoice path already made this decision and the shape is the one
 * the rest of the money path reads. `OrderDoc.items` is a list of `OrderLine`,
 * one per seat, each carrying `attendeeName` and `attendeeEmail`; `seatCount`
 * on the dashboard sums their quantities; `decideRefund` turns them back into
 * seats to return to `quantitySold`. A second collection holding the same
 * people in a different shape would need every one of those readers taught
 * about it, and the day they disagreed is the day a refund gives back one seat
 * out of three.
 *
 * It also costs nothing to model: a multi-seat cart written as `pending` is a
 * *started* purchase, which is what it is. If it is never paid,
 * `checkout.session.expired` flips it to `cancelled` and it lands on the
 * dashboard's Abandoned Registration screen, which previously had nothing at
 * all to show for a card checkout.
 *
 * ⚠️ **Only multi-seat carts are written here.** A single-seat purchase still
 * writes no order until it is paid, exactly as before. The seat list *is* the
 * reason for this document, a one-seat list is fully recoverable from
 * `customer_details` on the session, and flooding `orders` with a pending row
 * for every abandoned single-ticket checkout would change what every count on
 * the dashboard means in exchange for nothing.
 */

/**
 * The order id for a Checkout session.
 *
 * `registrations.ts` derives every order id — invoice or Checkout — from the
 * same hash of the external id, and exports it under the name the invoice path
 * happened to give it first. Aliased rather than re-derived: a second copy of
 * that hash is a second order document the day either copy changes, and the
 * symptom is a paid session fulfilling into a different document from the one
 * carrying its seat list.
 */
const orderIdForSession = invoiceOrderId;

export interface CartSeat {
  name: string;
  email: string;
  ticketType: string;
  ticketTypeId: string;
  priceCents: number;
}

/**
 * Record a started multi-seat purchase, with a line per seat.
 *
 * ⚠️ **This may not swallow its own errors, and it is the only write on the
 * checkout path that may not.** Everything else in fulfilment is best-effort
 * because the ticket already exists by the time it runs. This runs *before* any
 * money moves, and it is the only record of who the other seats are: losing it
 * means the buyer pays for three people and one of them gets a ticket. So
 * `startCheckout` refuses to redirect when this throws — an abandoned Stripe
 * session costs nothing, and a session nobody was sent to expires quietly.
 */
export async function recordCartOrder(input: {
  /** Stripe Checkout Session id. Also the order's idempotency key. */
  sessionId: string;
  /** The buyer, who is also seat one. */
  buyerEmail: string;
  buyerName: string;
  seats: CartSeat[];
  currency: string;
  campaignCode?: string;
}): Promise<string> {
  const oid = orderIdForSession(input.sessionId);

  /**
   * No `purchasedAt`, on purpose.
   *
   * `fulfilPurchase` stamps it as `prevOrder?.purchasedAt ?? Timestamp.now()`,
   * so a date written here would become the purchase date — dating the sale
   * from when the cart was built rather than when the money arrived. Seconds
   * apart for a card, days apart for a bank debit, and every revenue-by-day
   * figure on the dashboard reads from this field. Leaving it absent lets
   * fulfilment stamp the moment payment actually cleared, and the dashboard
   * already tolerates the gap (`iso(o.purchasedAt) ?? epoch`).
   */
  const order: Omit<OrderDoc, 'createdAt' | 'updatedAt' | 'purchasedAt'> = {
    eventId: EVENT_ID,
    externalId: input.sessionId,
    provider: 'stripe',
    channel: 'checkout',
    email: normaliseEmail(input.buyerEmail),
    buyerName: input.buyerName,
    // A promise to pay, and nothing more. The money has not moved and no
    // registration exists; `checkout.session.completed` is what changes that.
    status: 'pending',
    /**
     * One line per seat with `quantity: 1`, not one line of quantity N.
     *
     * `OrderLine` carries a single `attendeeEmail`, so a line of three seats
     * could name only one of the three people — and the other two would have no
     * record anywhere of who they are. The Stripe *line item* is where the
     * quantity is real; this is the register of who is coming.
     */
    items: input.seats.map((seat) => ({
      ticketTypeId: seat.ticketTypeId,
      // Denormalised deliberately: a tier can be renamed or deleted after the
      // sale, and an order that then prints a blank ticket name is useless to
      // whoever is reconciling it.
      ticketTypeName: seat.ticketType,
      quantity: 1,
      unitPriceCents: seat.priceCents,
      attendeeName: seat.name,
      // Folded here rather than at the reader, because `registrationId` folds
      // too: `Ada@Example.com` and `ada@example.com` must resolve to the one
      // registration whichever of them was typed into the form.
      attendeeEmail: normaliseEmail(seat.email),
    })),
    /**
     * The catalogue's arithmetic, which is a subtotal and not a total.
     *
     * Tax and any promotion code are applied by Stripe on their own page, and
     * the real figures come back on the session as `amount_subtotal`,
     * `amount_total` and `total_details`. `fulfilPurchase` overwrites all three
     * on payment. What is here is what the buyer was shown when they left, so a
     * pending row on the dashboard is not blank.
     */
    subtotalCents: input.seats.reduce((sum, s) => sum + s.priceCents, 0),
    taxCents: 0,
    discountCents: 0,
    totalCents: input.seats.reduce((sum, s) => sum + s.priceCents, 0),
    refundedCents: 0,
    currency: input.currency,
    campaignCode: input.campaignCode,
    // Nobody is registered yet, and this empty list is what says so.
    registrationIds: [],
  };

  await db()
    .collection(COLLECTIONS.orders)
    .doc(oid)
    .set(
      {
        ...order,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  return oid;
}

/**
 * The seat lines a Checkout session covers, read back at fulfilment.
 *
 * Returns the raw `OrderLine[]` rather than the tidier shape `seatsFromOrder`
 * produces, because the webhook does not merely read these — it has to **write
 * them back**. `fulfilPurchase` sets `items` to a single line describing the
 * buyer, and a Firestore merge replaces an array wholesale rather than merging
 * into it, so the other seats would be erased by the very write that fulfils
 * them. Handing back the lines verbatim is what lets the webhook restore them
 * unchanged instead of reconstructing prices it no longer has.
 *
 * An empty list means an ordinary single-seat purchase — no cart order was
 * written — and the caller falls back to the buyer alone.
 */
export async function cartLines(sessionId: string): Promise<OrderLine[]> {
  const snap = await db().collection(COLLECTIONS.orders).doc(orderIdForSession(sessionId)).get();
  if (!snap.exists) return [];
  const order = snap.data() as OrderDoc;
  return (order.items ?? []).filter((i) => i.attendeeEmail);
}

/**
 * Put the seat list back after fulfilment has overwritten it.
 *
 * ── The failure this exists to prevent ──────────────────────────────────────
 *
 * `fulfilPurchase` writes the order with `set(…, { merge: true })` and sets
 * `items` to a **single** line describing the buyer, because a Checkout session
 * was one ticket for one person when it was written. A Firestore merge treats
 * an array as one value and replaces it wholesale rather than merging into it,
 * so the very write that fulfils a three-seat purchase erases the record of who
 * seats two and three are — along with the two `OrderLine`s that
 * `decideRefund` would have turned back into seats to return to `quantitySold`,
 * and the two rows the dashboard counts as `seatCount`. A refund would then
 * give back one seat out of three, permanently, and no screen could correct it.
 *
 * So the webhook reads the lines before fulfilment and writes them back after.
 *
 * ⚠️ **Idempotent by construction.** Both fields are set to a value rather than
 * appended to, so a redelivered `checkout.session.completed` writes the same
 * array again. That matters: Stripe retries for up to three days, and an
 * `arrayUnion` here would have been correct on the first delivery and quietly
 * wrong on the second.
 *
 * The correct home for this is a `seats` parameter on `fulfilPurchase` itself,
 * which would let one write do the whole job. It lives here instead because
 * `registrations.ts` is owned elsewhere; folding it in is a small, safe change
 * and this comment is the note asking for it.
 */
export async function restoreCartOrder(input: {
  sessionId: string;
  lines: OrderLine[];
  registrationIds: string[];
}): Promise<void> {
  await db()
    .collection(COLLECTIONS.orders)
    .doc(orderIdForSession(input.sessionId))
    .update({
      items: input.lines,
      registrationIds: input.registrationIds,
      updatedAt: FieldValue.serverTimestamp(),
    });
}
