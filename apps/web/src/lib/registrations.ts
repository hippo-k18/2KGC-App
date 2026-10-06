import 'server-only';

import { createHash } from 'node:crypto';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  ticketLabel,
  type OrderDoc,
  type RegistrationDoc,
} from '@kgc/shared';
// The importer's id helpers, imported rather than re-implemented. A second
// copy of `registrationId` would drift, and the day it drifted the importer
// and this site would start writing two documents per attendee.
import { normaliseEmail, registrationId } from '@kgc/scripts/src/lib/ids';
import {
  currentHolder,
  ensureRegistration as sharedEnsureRegistration,
  removeOrderExtras,
  stillPaidElsewhere,
  type FulfilledRegistration as SharedFulfilled,
} from '@kgc/scripts/src/lib/fulfilment';
import { db } from './firestore';
import { decideRefund } from './refund-core';

/**
 * Fulfilment: turning a completed purchase into a registration the mobile app
 * can claim. This is the one write path on the public site, and the only
 * reason the site exists in this shape — website → ticket → app → QR check-in.
 *
 * Two properties matter more than anything else here.
 *
 * **Idempotence.** The same purchase arrives more than once by design: Stripe
 * redirects the buyer to the confirmation page *and* posts a webhook, the
 * webhook is retried until it gets a 2xx, and someone will buy a second ticket
 * with the same address for their colleague. None of those may produce a second
 * registration. That is why the document id is `registrationId(email)` — derived
 * from the address rather than random or auto — exactly as the Whova importer
 * does it, so the importer and this site converge on one document per person
 * instead of fighting.
 *
 * **Secret stability.** A repeat purchase must *not* rotate `qrSecret` or
 * `claimCode`. Both may already be printed on a badge or pasted into the app;
 * regenerating them silently invalidates a badge that is physically in
 * someone's hand. So the transaction below preserves them when the document
 * already exists, and mints them only on first creation.
 */

/** What the confirmation page needs. Never includes `qrSecret`. */
export interface FulfilledRegistration {
  registrationId: string;
  email: string;
  name?: string;
  ticketType?: string;
  claimCode: string;
  /** `orders/{orderId}`, when the ticket came from a purchase. */
  orderId?: string;
  /** Read back by `getRegistration`, so the order page can tell a cancelled ticket from a live one. */
  status?: RegistrationDoc['status'];
  /** True when this purchase created the registration rather than updating one. */
  created: boolean;
  /** Set when the ticket was an extra; see `FulfilledRegistration.extra` in `@kgc/scripts`. */
  extra?: SharedFulfilled['extra'];
}

export interface FulfilInput {
  email: string;
  name: string;
  /** `TicketTypeDoc.name`-shaped label, e.g. "All Access (VIP)". */
  ticketType: string;
  /**
   * Stripe Checkout Session id, or a `demo_…` stand-in when the site is
   * running without a Stripe account. Doubles as the order's idempotency key.
   */
  externalId: string;
  amountCents: number;
  currency: string;
  /** False in demo mode. An order is only ever marked paid when it was. */
  paid: boolean;

  // ── Everything below is optional because it did not exist when orders were
  // ── mirrored from an external provider, and documents from that era are
  // ── still in Firestore. The dashboard reads them with defaults.

  /** `ticketTypes` document id. Lets the orders screen group by tier. */
  tierId?: string;
  /** How the money was taken. Absent means `checkout`. */
  channel?: OrderDoc['channel'];
  buyerName?: string;
  companyName?: string;
  /** Stripe's own breakdown, so the dashboard need not recompute tax. */
  subtotalCents?: number;
  taxCents?: number;
  discountCents?: number;
  promotionCode?: string;
  /** The tracked link this purchase came through. See `OrderDoc.campaignCode`. */
  campaignCode?: string;
  /**
   * Answers to the registration questions, already validated.
   *
   * Written onto the *registration*, never onto the order — a dietary
   * requirement belongs to the person, survives a transferred ticket, and must
   * not be readable by anything querying orders. See `RegistrationDoc.answers`.
   */
  answers?: Record<string, string | string[] | boolean>;
  stripeCustomerId?: string;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeInvoiceId?: string;
  hostedInvoiceUrl?: string;
  invoicePdfUrl?: string;
  poNumber?: string;
}

/**
 * Orders are keyed by a hash of the Stripe Checkout Session id.
 *
 * The webhook and the post-checkout redirect both fulfil the same purchase —
 * whichever arrives first wins and the other is a no-op — and Stripe retries a
 * webhook until it is acknowledged. Deriving the id from the session rather
 * than letting Firestore auto-assign one means a replay writes to the same
 * document instead of creating a second order. `checkout.session.completed` is
 * the only event handled, so "one id per session" and "one id per event" are
 * the same statement.
 */
export function orderIdFor(externalId: string): string {
  // Hashed rather than used raw: `cs_test_…` ids are long and are a Stripe
  // implementation detail, and the id ends up in a Firestore path. Hashed
  // here rather than with `emailHash`, which lowercases first — Stripe ids are
  // case-sensitive and folding case would be a needless collision.
  return `ord_${createHash('sha256').update(externalId).digest('hex').slice(0, 24)}`;
}

/**
 * The registration half of fulfilment, with no order attached.
 *
 * Delegates to `@kgc/scripts/src/lib/fulfilment`, which is where the logic
 * lives because three callers need it and no two of them can import each
 * other: this webhook, the organizer dashboard's mark-invoice-paid action, and
 * the Whova importer. A second copy would own `qrSecret` and `claimCode`, and
 * the day the copies disagreed about when to mint them is the day somebody's
 * badge stops scanning while they hold it at the desk.
 *
 * Split from `fulfilPurchase` because the two callers want different finance
 * records. A Checkout session is one payment for one ticket, so one order per
 * registration is right. **An invoice is one payment for several tickets** — a
 * company sending four people — and four orders would make "what did Acme
 * pay?" unanswerable and strand the pending record written when it was raised.
 * The invoice path therefore calls this per seat and writes a single order.
 */
export function ensureRegistration(input: {
  email: string;
  name: string;
  ticketType: string;
  /** The paid order and seat. See `EnsureRegistrationInput.purchase`. */
  purchase?: { orderId: string; seat: number };
  /** Lets an extra (Workshops) go on the person's existing badge. */
  ticketTypeId?: string;
}): Promise<FulfilledRegistration> {
  return sharedEnsureRegistration(db(), input);
}

/**
 * One purchase: a registration plus the order that paid for it.
 *
 * This is the Checkout path. `ensureRegistration` does the ticket; everything
 * below is the finance record.
 */
export async function fulfilPurchase(input: FulfilInput): Promise<FulfilledRegistration> {
  const email = normaliseEmail(input.email);
  const oid = orderIdFor(input.externalId);
  const orderRef = db().collection(COLLECTIONS.orders).doc(oid);

  // Seat 0 is the buyer. A second purchase by the same address is a second
  // ticket, not an update of the first (2026-09-26).
  const result = await ensureRegistration({
    email,
    name: input.name,
    ticketType: input.ticketType,
    purchase: { orderId: oid, seat: 0 },
    ticketTypeId: input.tierId,
  });
  const rid = result.registrationId;

  /**
   * The registration questions, merged onto the registration.
   *
   * A separate write rather than a field on `ensureRegistration`, because that
   * function is shared with the invoice path and the badge printer and owns
   * `qrSecret` and `claimCode` — widening it to carry form answers would put a
   * marketing concern inside the one function that must never change shape.
   *
   * Merged, not replaced: a replay must not blank an answer already stored.
   * And it can never throw
   * upward — the ticket is already valid, and losing an answer must not lose a
   * registration.
   */
  if (input.answers && Object.keys(input.answers).length > 0) {
    try {
      await db()
        .collection(COLLECTIONS.registrations)
        .doc(rid)
        .set({ answers: input.answers, updatedAt: Timestamp.now() }, { merge: true });
    } catch (err) {
      console.error('[registrations] could not store question answers for', rid, err);
    }
  }

  // The order is a separate, non-transactional write on purpose: it is a
  // record of the payment, not a precondition of the ticket. If this throws,
  // the attendee still has a valid registration and the finance record can be
  // reconciled from Stripe, which is the right way round to fail.
  //
  // ── Read before write, for two reasons that are both replay bugs ──────────
  //
  // Stripe retries a webhook for up to three days, and this write merges. Two
  // fields must therefore survive a replay rather than be re-derived:
  //
  //   `status` / `refundedCents` — a `checkout.session.completed` redelivered
  //   *after* a refund would otherwise flip the order back to `paid` and zero
  //   the refunded total, resurrecting a ticket that the check-in desk would
  //   then happily scan. Terminal states are terminal.
  //
  //   `purchasedAt` — stamping `Timestamp.now()` unconditionally moves the
  //   purchase date to whenever the retry happened, which quietly corrupts
  //   every revenue-by-day figure the dashboard draws.
  const existingOrder = await orderRef.get();
  const prevOrder = existingOrder.exists ? (existingOrder.data() as OrderDoc) : null;
  const TERMINAL: OrderDoc['status'][] = ['refunded', 'partially_refunded', 'cancelled'];
  const settled = prevOrder && TERMINAL.includes(prevOrder.status);
  /**
   * A group purchase's seat list, written by `recordCartOrder` before the buyer
   * went to pay. It is the only record of who seats two and up are, so it is
   * kept as it is rather than replaced by the buyer's line.
   *
   * This used to be overwritten here and put back by the webhook afterwards.
   * That held only while the webhook was the sole caller: `/checkout/return`
   * usually arrives first, and its write left the webhook reading a one-seat
   * order, so the other seats got no ticket and nothing was counted.
   */
  const cartItems = prevOrder && (prevOrder.items?.length ?? 0) > 1 ? prevOrder.items : null;

  const order: Omit<OrderDoc, 'createdAt' | 'updatedAt' | 'purchasedAt' | 'registrationIds'> = {
    eventId: EVENT_ID,
    externalId: input.externalId,
    provider: 'stripe',
    channel: input.channel ?? 'checkout',
    email,
    buyerName: input.buyerName ?? input.name,
    companyName: input.companyName,
    status: settled ? prevOrder!.status : input.paid ? 'paid' : 'pending',
    /**
     * One line, one seat. Checkout sells a single ticket at a time and an
     * invoice raises one order per seat, so quantity is always 1 today — but
     * the shape is a list because "four seats on one order" is the next thing
     * a company asks for, and retrofitting a list onto a scalar means
     * rewriting every reader.
     */
    items: cartItems ?? [
      {
        ticketTypeId: input.tierId ?? '',
        // Denormalised deliberately: the tier can be renamed or deleted after
        // the sale, and an order that then prints a blank ticket name is
        // useless to the finance person reconciling it.
        ticketTypeName: input.ticketType,
        quantity: 1,
        unitPriceCents: input.amountCents,
        attendeeName: input.name,
        attendeeEmail: email,
      },
    ],
    subtotalCents: input.subtotalCents ?? input.amountCents,
    taxCents: input.taxCents ?? 0,
    discountCents: input.discountCents ?? 0,
    totalCents: input.amountCents,
    // Explicitly zero on a first write rather than absent, so every reader can
    // add without a null check — but carried forward on a replay, because a
    // refund that already happened is not undone by Stripe resending the sale.
    refundedCents: prevOrder?.refundedCents ?? 0,
    currency: input.currency,
    promotionCode: input.promotionCode,
    /**
     * First attribution wins, not last.
     *
     * `?? input.campaignCode` rather than the other way round: a webhook replay
     * arriving after the cookie has moved on would otherwise re-credit a
     * completed sale to a different link. The purchase happened once and was
     * caused once.
     */
    campaignCode: prevOrder?.campaignCode ?? input.campaignCode,
    stripeCustomerId: input.stripeCustomerId,
    stripePaymentIntentId: input.stripePaymentIntentId,
    stripeChargeId: input.stripeChargeId,
    stripeInvoiceId: input.stripeInvoiceId,
    hostedInvoiceUrl: input.hostedInvoiceUrl,
    invoicePdfUrl: input.invoicePdfUrl,
    poNumber: input.poNumber,
  };
  await orderRef.set(
    {
      ...order,
      // Added to, never replaced. On a group purchase the other seats'
      // registrations are attached by `fulfilOrder`, and a second caller
      // (the return redirect, a webhook replay) must not cut the list back to
      // the buyer alone. A union is also what two concurrent callers agree on.
      registrationIds: FieldValue.arrayUnion(rid),
      // Workshops added to a badge another order issued: refunding this order
      // takes the extra off and leaves the badge (`removeOrderExtras`).
      ...(result.extra?.extendedOnly ? { extraRegistrationIds: FieldValue.arrayUnion(rid) } : {}),
      // First write wins. A retry three days later must not restamp the sale.
      purchasedAt: prevOrder?.purchasedAt ?? Timestamp.now(),
      createdAt: prevOrder ? undefined : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return result;
}

/** Read a registration back for the confirmation page. Server-side only. */
export async function getRegistration(rid: string): Promise<FulfilledRegistration | null> {
  const doc = await db().collection(COLLECTIONS.registrations).doc(rid).get();
  if (!doc.exists) return null;
  const r = doc.data() as RegistrationDoc;
  return {
    registrationId: doc.id,
    email: r.email,
    name: r.name,
    // The whole badge, "Main Conference + Workshops".
    ticketType: ticketLabel(r) || r.ticketType,
    claimCode: r.claimCode ?? '',
    status: r.status,
    ...(r.orderId ? { orderId: r.orderId } : {}),
    created: false,
  };
}

/**
 * Withdraw a registration because the money went back.
 *
 * The gap this closes is not cosmetic. Until now the webhook ignored every
 * event except `checkout.session.completed`, so a refunded ticket stayed
 * `active` — and `active` is exactly what the check-in desk scans for. Someone
 * who bought a ticket, refunded it, and kept the confirmation email would have
 * walked through the door.
 *
 * Cancelling rather than deleting, for three reasons: the badge QR is already
 * in circulation and must resolve to *something* the desk can explain; the
 * scan log references the registration id; and "cancelled" is the answer the
 * person at the desk needs ("talk to registration"), whereas a missing document
 * gives them "who are you".
 *
 * `qrSecret` and `claimCode` are deliberately left alone. Rotating them buys
 * nothing — the ticket is void by status, not by secrecy — and clearing them
 * would break the desk's ability to identify the person standing in front of
 * it.
 */
export interface RefundOutcome {
  registrationId: string | null;
  orderId: string;
  /** Who paid, so the caller can send them the receipt. Null if unknown. */
  email: string | null;
  /**
   * The address of the registration that was actually cancelled.
   *
   * The same as `email` on every order nobody transferred. After a transfer the
   * buyer paid and somebody else holds the seat, so the receipt still goes to
   * `email` while anything that follows the *ticket* — app access, entitlements,
   * and the mail saying a badge has stopped working — has to follow this
   * instead.
   */
  holderEmail?: string;
  /** The holder's own name, for greeting them in that mail. */
  holderName?: string;
  name?: string;
  ticketType?: string;
  /** Cumulative refunded total after this event, in minor units. */
  refundedCents: number;
  /**
   * Set when this order only added an extra (Workshops) to a badge another
   * order issued: the tier ids taken off that badge by this delivery, which
   * stays valid. Empty on a replay.
   */
  extrasRemoved?: string[];
  /** True when the refunded order only added extras to a badge; see `extrasRemoved`. */
  extraOnly?: boolean;
  /** What that badge still holds afterwards, or '' when it is no longer active. */
  remainingLabel?: string;
  /**
   * Extras on the badge this refund cancelled that other orders paid for
   * (Workshops bought in December on a Main Conference refunded now). The
   * owner's rule: they go too, and their money goes back. The caller refunds
   * them; see `refundLinkedExtras` in the webhook.
   */
  linkedExtras?: { orderId: string; tierId: string; registrationId: string; seat?: number }[];
  currency: string;
  /** False for a partial refund, which leaves the ticket valid. */
  fullyRefunded: boolean;
  /**
   * True only on the delivery that actually moved the order into a fully
   * refunded state.
   *
   * The replay guard for anything non-idempotent the caller wants to do about a
   * refund — giving seats back to `quantitySold`, above all. Stripe redelivers
   * `charge.refunded` for up to three days and every delivery reports the same
   * cumulative `amount_refunded`, so "is this a full refund?" is true every
   * time and is the wrong question. This is the right one: the order was not
   * already `refunded` or `cancelled` when this delivery arrived.
   *
   * `partially_refunded` → `refunded` counts as newly refunded, because the
   * seat was still sold a moment ago and is not now.
   */
  newlyRefunded: boolean;
  /**
   * What the order sold, so the caller can give the seats back per tier.
   *
   * An invoice is one order with several `items`, so this is a list rather than
   * a single tier. Lines whose tier was never recorded (`ticketTypeId: ''` —
   * an invoice raised straight in the Stripe dashboard) are dropped, because
   * there is no counter to correct.
   */
  lines: { ticketTypeId: string; quantity: number }[];
}

export async function cancelRegistrationByOrder(input: {
  externalId: string;
  reason: 'refunded' | 'disputed' | 'payment_failed';
  /**
   * Cumulative amount refunded on the charge, in minor units, as Stripe reports
   * it (`charge.amount_refunded`). Absent means "treat as a full refund", which
   * is the right reading for a dispute or a failed payment.
   */
  refundedCents?: number;
}): Promise<RefundOutcome> {
  const oid = orderIdFor(input.externalId);
  const orderRef = db().collection(COLLECTIONS.orders).doc(oid);
  const snap = await orderRef.get();

  if (!snap.exists) {
    // A refund for something we never recorded. Write the order anyway so the
    // finance trail is complete and the discrepancy is visible, rather than
    // silently dropping it.
    const orphanStatus = input.reason === 'refunded' ? 'refunded' : 'cancelled';
    await orderRef.set(
      {
        eventId: EVENT_ID,
        externalId: input.externalId,
        provider: 'stripe',
        email: '',
        status: orphanStatus,
        totalCents: 0,
        refundedCents: input.refundedCents ?? 0,
        currency: 'usd',
        purchasedAt: Timestamp.now(),
        // Only when money actually went back. See the note on the update below.
        ...(input.reason === 'refunded' ? { refundedAt: Timestamp.now() } : {}),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return {
      registrationId: null,
      orderId: oid,
      email: null,
      refundedCents: input.refundedCents ?? 0,
      currency: 'usd',
      fullyRefunded: true,
      // Nothing was ever fulfilled through this order, so nothing was ever
      // counted against a tier and there is nothing to give back.
      newlyRefunded: false,
      lines: [],
    };
  }

  const order = snap.data() as OrderDoc;

  /**
   * The rules themselves live in `refund-core.ts`, which imports no
   * `server-only` and is therefore reachable from `tests/commerce`. What is
   * left here is the write.
   *
   * `decideRefund` is read from the order's state *before* the update below,
   * which is what makes `newlyRefunded` answerable at all: afterwards every
   * delivery of the same event looks identical.
   */
  const refunded = input.refundedCents ?? order.totalCents;
  const decision = decideRefund(order, input);

  await orderRef.update({
    status: decision.status,
    // A chargeback holds the money rather than returning it, so it is not
    // written as a refunded amount (T135B, N3). `disputedAt` is what tells a
    // disputed sale from an abandoned checkout, both being `cancelled`.
    // Stamped by the delivery that cancelled the order, not by Stripe's replays
    // of it (T138B, TK-258).
    ...(input.reason === 'disputed'
      ? decision.newlyRefunded
        ? { disputedAt: Timestamp.now() }
        : {}
      : { refundedCents: refunded }),
    ...(decision.stampRefundedAt ? { refundedAt: Timestamp.now() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const details = {
    orderId: oid,
    email: order.email || null,
    name: order.buyerName ?? order.items?.[0]?.attendeeName,
    ticketType: order.items?.[0]?.ticketTypeName,
    refundedCents: refunded,
    currency: order.currency,
    fullyRefunded: decision.fullyRefunded,
    newlyRefunded: decision.newlyRefunded,
    lines: decision.lines,
  };

  if (!order.email) return { ...details, registrationId: null };

  // Partial refund: money moved, the ticket did not. Nothing further to do.
  if (!decision.fullyRefunded) return { ...details, registrationId: null };

  /**
   * Only withdraw the registration if this order is the reason it exists.
   *
   * Since 2026-09-26 a second purchase by the same address is a separate
   * ticket, so refunding one order withdraws that order's ticket and leaves
   * the other. The check below still matters for older registrations that two
   * orders were merged into: one is cancelled only when no other paid order
   * paid for it, asked about the buyer and the holder alike.
   *
   * ── And it may not be the buyer's registration any more ────────────────────
   *
   * `registrationId(order.email)` is the buyer's document, and after a transfer
   * that document is already dead while the ticket is somebody else's.
   * Cancelling the buyer's id would take the money back and leave the new
   * holder's badge scanning, so the forward link is followed to whoever holds
   * the seat now. No registration at the end of it means there is no ticket to
   * withdraw, which is a skip rather than an update that would throw.
   */
  // The ticket this order paid for. One address can hold several, so the
  // order's own record says which; older orders fall back to the address.
  const startId = order.registrationIds?.[0] ?? registrationId(order.email);
  const holder = await currentHolder(db(), startId);
  if (!holder) return { ...details, registrationId: null };
  const rid = holder.id;

  /**
   * This order only put Workshops on a badge another order issued. Refunding
   * it takes Workshops off and leaves the badge valid (owner, 2026-10-06).
   */
  if (order.extraRegistrationIds?.includes(startId)) {
    const removed = await removeOrderExtras(db(), rid, oid);
    if (rid !== startId) removed.push(...(await removeOrderExtras(db(), startId, oid)));
    const after = (await db().collection(COLLECTIONS.registrations).doc(rid).get()).data() as RegistrationDoc | undefined;
    return {
      ...details,
      registrationId: null,
      holderEmail: holder.email,
      holderName: holder.name,
      extraOnly: true,
      extrasRemoved: removed,
      remainingLabel: after?.status === 'active' ? ticketLabel(after) : '',
    };
  }

  /**
   * Both addresses are asked, and the order being refunded is left out of the
   * answer. The buyer's other order still pays for the seat they passed on, and
   * the holder's own purchase still pays for the seat they were handed; either
   * one keeps the ticket alive. `stillPaidElsewhere` states the rule in full
   * and `cancelExtraSeats` in the webhook asks it the same way, so the two
   * cannot drift.
   */
  if (await stillPaidElsewhere(db(), [order.email, holder.email], oid, [startId, rid])) {
    // `registrationId: null` is "nothing was withdrawn", and the holder is
    // still reported: the receipt has to know whether the ticket it is talking
    // about is the buyer's own.
    return { ...details, registrationId: null, holderEmail: holder.email, holderName: holder.name };
  }

  await db()
    .collection(COLLECTIONS.registrations)
    .doc(rid)
    .update({ status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });

  return {
    ...details,
    registrationId: rid,
    holderEmail: holder.email,
    holderName: holder.name,
    linkedExtras: await extrasFromOtherOrders(rid, oid),
  };
}

/**
 * The extras on a badge that orders other than `oid` paid for. Read after the
 * badge is cancelled, so the caller can refund them (owner, 2026-10-06:
 * refunding Main Conference refunds Workshops too).
 */
export async function extrasFromOtherOrders(
  rid: string,
  oid: string,
): Promise<{ orderId: string; tierId: string; registrationId: string; seat?: number }[]> {
  const reg = (await db().collection(COLLECTIONS.registrations).doc(rid).get()).data() as RegistrationDoc | undefined;
  return (reg?.extras ?? [])
    .filter((e) => e.orderId && e.orderId !== oid)
    .map((e) => ({ orderId: e.orderId!, tierId: e.tierId, registrationId: rid, ...(e.seat !== undefined ? { seat: e.seat } : {}) }));
}

/**
 * A Checkout session that ended without payment: Stripe expired it, or a
 * delayed payment failed.
 *
 * Nothing was ever issued for such a session, so the only thing to change is
 * the order, and only while it is still `pending`. This used to go through
 * `cancelRegistrationByOrder`, which had two ways to cancel a ticket that had
 * nothing to do with it (T135):
 *
 *  - A group cart is written as a `pending` order with no `registrationIds`,
 *    so the cancel fell back to `registrationId(order.email)`, the buyer's own
 *    ticket. An imported attendee, a comp holder or a speaker who started and
 *    abandoned a group checkout lost the ticket they already had (S1).
 *  - A late or replayed `expired` for a session that had been paid cancelled
 *    the paid order and half its tickets (TK-144/145).
 *
 * With no order at all (a single-seat checkout writes none before payment) a
 * `cancelled` record is written, as before, so the attempt shows on the
 * dashboard's abandoned list.
 */
export async function cancelUnpaidOrder(externalId: string): Promise<{
  orderId: string;
  /** What happened: `cancelled`, or why nothing did. */
  outcome: 'cancelled' | 'recorded' | `left ${OrderDoc['status']}`;
}> {
  const oid = orderIdFor(externalId);
  const ref = db().collection(COLLECTIONS.orders).doc(oid);

  const outcome = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, {
        eventId: EVENT_ID,
        externalId,
        provider: 'stripe',
        email: '',
        status: 'cancelled',
        totalCents: 0,
        refundedCents: 0,
        currency: 'usd',
        purchasedAt: Timestamp.now(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return 'recorded' as const;
    }
    const status = (snap.data() as OrderDoc).status;
    if (status !== 'pending') return `left ${status}` as const;
    tx.update(ref, { status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
    return 'cancelled' as const;
  });

  return { orderId: oid, outcome };
}

// ---------------------------------------------------------------------------
// Invoicing
//
// An invoice is one payment for several tickets, so it gets **one** order with
// several `items` — not one order per seat. Two things follow from that.
//
// The order is written when the invoice is *raised*, with `status: 'pending'`,
// so the dashboard can show what is outstanding. That is the whole reason a
// pending record exists: an invoice nobody can see is an invoice nobody chases.
//
// It becomes `paid` only on the `invoice.paid` webhook, never here. An invoice
// is a promise to pay, and issuing badges against a promise is how conferences
// end up chasing money from people who have already attended and gone home.
// ---------------------------------------------------------------------------

/** The order id for an invoice. Stable, so raising and paying converge. */
export function invoiceOrderId(invoiceId: string): string {
  return orderIdFor(invoiceId);
}

export interface InvoiceOrderInput {
  invoiceId: string;
  billingEmail: string;
  companyName: string;
  seats: {
    name: string;
    email: string;
    ticketType: string;
    ticketTypeId: string;
    priceCents: number;
    listPriceCents?: number;
    groupDiscountCents?: number;
  }[];
  currency: string;
  totalCents: number;
  hostedInvoiceUrl?: string;
  invoicePdfUrl?: string;
  poNumber?: string;
  dueAt?: Date;
}

/** Record a raised invoice as an outstanding order. */
export async function recordInvoiceOrder(input: InvoiceOrderInput): Promise<string> {
  const oid = invoiceOrderId(input.invoiceId);
  const order: Omit<OrderDoc, 'createdAt' | 'updatedAt' | 'purchasedAt'> = {
    eventId: EVENT_ID,
    externalId: input.invoiceId,
    provider: 'stripe',
    channel: 'invoice',
    // The billing contact, who is often not any of the attendees. The seats
    // carry the people; this carries who pays.
    email: normaliseEmail(input.billingEmail),
    companyName: input.companyName,
    status: 'pending',
    items: input.seats.map((seat) => ({
      ticketTypeId: seat.ticketTypeId,
      ticketTypeName: seat.ticketType,
      quantity: 1,
      unitPriceCents: seat.priceCents,
      ...(seat.groupDiscountCents
        ? { listPriceCents: seat.listPriceCents, groupDiscountCents: seat.groupDiscountCents }
        : {}),
      attendeeName: seat.name,
      attendeeEmail: normaliseEmail(seat.email),
    })),
    ...(input.seats.some((seat) => seat.groupDiscountCents)
      ? { groupDiscountCents: input.seats.reduce((n, seat) => n + (seat.groupDiscountCents ?? 0), 0) }
      : {}),
    subtotalCents: input.seats.reduce((sum, s) => sum + s.priceCents, 0),
    // Stripe computes tax at finalisation; the paid webhook carries the real
    // figure. Zero here is honest rather than a guess — the dashboard shows an
    // outstanding invoice, not a tax return.
    taxCents: 0,
    discountCents: 0,
    totalCents: input.totalCents,
    refundedCents: 0,
    currency: input.currency,
    stripeInvoiceId: input.invoiceId,
    hostedInvoiceUrl: input.hostedInvoiceUrl,
    invoicePdfUrl: input.invoicePdfUrl,
    poNumber: input.poNumber,
    // Nobody is registered yet, and this list is what says so.
    registrationIds: [],
  };

  await db()
    .collection(COLLECTIONS.orders)
    .doc(oid)
    .set(
      {
        ...order,
        // The date the money was *asked for*. Reset to the payment date when it
        // clears, so revenue lands in the period it was received.
        purchasedAt: Timestamp.now(),
        dueAt: input.dueAt ? Timestamp.fromDate(input.dueAt) : undefined,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  return oid;
}

/**
 * An invoice cleared. Flip the order and attach the registrations it bought.
 *
 * Merges rather than overwrites, and leaves a terminal status alone, for the
 * same reason the Checkout path does: Stripe retries for up to three days and a
 * replayed `invoice.paid` must not un-refund anything.
 */
export async function markInvoiceOrderPaid(input: {
  invoiceId: string;
  registrationIds: string[];
  /** See `OrderDoc.extraRegistrationIds`. */
  extraRegistrationIds?: string[];
  /** The payment that settled the invoice, so a later refund can be sent to it. */
  stripePaymentIntentId?: string;
  totalCents: number;
  taxCents?: number;
  currency: string;
  hostedInvoiceUrl?: string;
  invoicePdfUrl?: string;
  /** Set when an organizer accepted a PO out of band rather than Stripe reporting payment. */
  markedPaidBy?: string;
}): Promise<string> {
  const oid = invoiceOrderId(input.invoiceId);
  const ref = db().collection(COLLECTIONS.orders).doc(oid);
  const snap = await ref.get();
  const prev = snap.exists ? (snap.data() as OrderDoc) : null;

  const TERMINAL: OrderDoc['status'][] = ['refunded', 'partially_refunded', 'cancelled'];
  if (prev && TERMINAL.includes(prev.status)) return oid;

  await ref.set(
    {
      // An invoice paid for a company that never went through `recordInvoiceOrder`
      // — raised straight in the Stripe dashboard, say — still gets a record.
      eventId: EVENT_ID,
      externalId: input.invoiceId,
      provider: 'stripe',
      channel: 'invoice',
      stripeInvoiceId: input.invoiceId,
      status: 'paid',
      totalCents: input.totalCents,
      taxCents: input.taxCents ?? prev?.taxCents ?? 0,
      currency: input.currency,
      refundedCents: prev?.refundedCents ?? 0,
      registrationIds: input.registrationIds,
      ...(input.extraRegistrationIds?.length ? { extraRegistrationIds: input.extraRegistrationIds } : {}),
      ...(input.stripePaymentIntentId ? { stripePaymentIntentId: input.stripePaymentIntentId } : {}),
      hostedInvoiceUrl: input.hostedInvoiceUrl ?? prev?.hostedInvoiceUrl,
      invoicePdfUrl: input.invoicePdfUrl ?? prev?.invoicePdfUrl,
      markedPaidBy: input.markedPaidBy,
      markedPaidAt: input.markedPaidBy ? Timestamp.now() : undefined,
      // Revenue is recognised when the money arrives, not when it was asked for.
      purchasedAt: Timestamp.now(),
      createdAt: prev ? undefined : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return oid;
}

/**
 * The seats an invoice covers, read from our own order record.
 *
 * `invoicing.ts` also stashes the attendee list in Stripe invoice metadata, and
 * that was the only source until this existed. It is not a safe one: Stripe
 * caps a metadata value at 500 characters and `raiseInvoice` truncates to 480,
 * so an invoice for enough people produces a **cut-off JSON string**. The parse
 * then throws, `seatsFromInvoice` returns an empty list by design, and the
 * webhook registers nobody — silently, at the exact moment a company has just
 * paid for eight tickets.
 *
 * The order document has no such limit and is written before the invoice is
 * sent, so it is the primary source. Metadata stays as the fallback for an
 * invoice raised straight in the Stripe dashboard, which has no order record.
 */
export async function seatsFromOrder(
  invoiceId: string,
): Promise<{ name: string; email: string; ticketType: string; ticketTypeId: string; priceCents?: number }[]> {
  const snap = await db().collection(COLLECTIONS.orders).doc(invoiceOrderId(invoiceId)).get();
  if (!snap.exists) return [];
  const order = snap.data() as OrderDoc;
  return (order.items ?? [])
    .filter((i) => i.attendeeEmail)
    .map((i) => ({
      name: i.attendeeName ?? '',
      email: i.attendeeEmail as string,
      ticketType: i.ticketTypeName,
      ticketTypeId: i.ticketTypeId,
      priceCents: i.unitPriceCents,
    }));
}
