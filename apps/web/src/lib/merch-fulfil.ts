import 'server-only';

import type Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, merchTotalCents, type OrderDoc } from '@kgc/shared';
import { normaliseEmail } from '@kgc/scripts/src/lib/ids';
import { isSettledOrder } from '@kgc/scripts/src/lib/order-claims';
import { sendMerchConfirmation } from '@/lib/email';
import { db } from '@/lib/firestore';
import { merchFromMetadata } from '@/lib/merch';
import { claimConfirmation, confirmationsOutstanding, sendClaimed } from '@/lib/fulfil-order';
import { mintOrderToken } from '@/lib/order-token';
import { orderIdFor } from '@/lib/registrations';

/** The confirmation key for a merch-only order's one email. */
export const MERCH_CONFIRMATION = 'merch';

export interface MerchFulfilResult {
  orderId: string;
  /** The ticket holder the merch was bought against. */
  registrationId: string;
  settled?: OrderDoc['status'];
  confirmationOutstanding: boolean;
}

/**
 * A paid merch-only session becomes an order and a receipt, and nothing else
 * (T380): no registration, no account, no seat counted, no entitlement. The
 * webhook and `/checkout/return` both run it; the order is created once in a
 * transaction, and the email is claimed once on the order like a ticket's.
 */
export async function fulfilMerchSession(input: {
  session: Stripe.Checkout.Session;
  holderRegistrationId: string;
  email: string;
  origin: string;
}): Promise<MerchFulfilResult> {
  const { session, holderRegistrationId, origin } = input;
  const oid = orderIdFor(session.id);
  const ref = db().collection(COLLECTIONS.orders).doc(oid);
  const merch = await merchFromMetadata(session.metadata?.merch);
  const email = normaliseEmail(input.email);
  const pi = session.payment_intent;
  const customer = session.customer;

  const settled = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.data() as OrderDoc | undefined;
    if (isSettledOrder(before)) return before!.status;
    if (snap.exists) return undefined;
    tx.set(ref, {
      eventId: EVENT_ID,
      externalId: session.id,
      provider: 'stripe',
      channel: 'checkout',
      kind: 'merch',
      email,
      ...(session.customer_details?.name ? { buyerName: session.customer_details.name } : {}),
      status: 'paid',
      items: [],
      merch,
      merchCents: merchTotalCents(merch),
      subtotalCents: session.amount_subtotal ?? merchTotalCents(merch),
      taxCents: session.total_details?.amount_tax ?? 0,
      discountCents: session.total_details?.amount_discount ?? 0,
      totalCents: session.amount_total ?? 0,
      refundedCents: 0,
      currency: session.currency ?? 'usd',
      registrationIds: [],
      holderRegistrationId,
      ...(typeof pi === 'string' ? { stripePaymentIntentId: pi } : pi?.id ? { stripePaymentIntentId: pi.id } : {}),
      ...(typeof customer === 'string' ? { stripeCustomerId: customer } : customer?.id ? { stripeCustomerId: customer.id } : {}),
      purchasedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return undefined;
  });
  if (settled) return { orderId: oid, registrationId: holderRegistrationId, settled, confirmationOutstanding: false };

  const attempt = await claimConfirmation(oid, MERCH_CONFIRMATION);
  if (attempt !== null) {
    await sendClaimed({ orderId: oid, rid: MERCH_CONFIRMATION, attempts: attempt, to: email }, () =>
      sendMerchConfirmation({
        to: email,
        name: session.metadata?.name ?? session.customer_details?.name ?? '',
        merch,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? 'usd',
        orderUrl: `${origin}/order/${mintOrderToken({ rid: holderRegistrationId })}`,
        orderId: oid,
        registrationId: holderRegistrationId,
      }),
    );
  }

  return {
    orderId: oid,
    registrationId: holderRegistrationId,
    confirmationOutstanding: (await confirmationsOutstanding(oid, [MERCH_CONFIRMATION])).length > 0,
  };
}

/**
 * A refund or chargeback on a merch-only order: the order records it, and no
 * ticket moves. The holder's ticket was paid for on another order (or given),
 * and refunding socks must never cancel it.
 */
export async function settleMerchOrder(input: {
  orderId: string;
  reason: 'refunded' | 'disputed';
  refundedCents?: number;
}): Promise<{ status: OrderDoc['status']; newly: boolean } | null> {
  const ref = db().collection(COLLECTIONS.orders).doc(input.orderId);
  return db().runTransaction(async (tx) => {
    const order = (await tx.get(ref)).data() as OrderDoc | undefined;
    if (!order) return null;
    if (input.reason === 'disputed') {
      if (order.disputedAt) return { status: order.status, newly: false };
      tx.update(ref, { status: 'cancelled', disputedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return { status: 'cancelled' as const, newly: true };
    }
    const refunded = Math.max(order.refundedCents ?? 0, input.refundedCents ?? 0);
    const status: OrderDoc['status'] = refunded >= order.totalCents ? 'refunded' : 'partially_refunded';
    if (refunded === (order.refundedCents ?? 0) && status === order.status) return { status, newly: false };
    tx.update(ref, {
      status,
      refundedCents: refunded,
      ...(status === 'refunded' ? { refundedAt: FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { status, newly: true };
  });
}
