import 'server-only';

import { createHash } from 'node:crypto';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  type OrderDoc,
  type RegistrationDoc,
} from '@kgc/shared';
// The importer's id helpers, imported rather than re-implemented. A second
// copy of `registrationId` would drift, and the day it drifted the importer
// and this site would start writing two documents per attendee.
import {
  claimCode,
  emailHash,
  normaliseEmail,
  qrSecret,
  registrationId,
} from '@kgc/scripts/src/lib/ids';
import { db } from './firestore';

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
  /** True when this purchase created the registration rather than updating one. */
  created: boolean;
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
function orderIdFor(externalId: string): string {
  // Hashed rather than used raw: `cs_test_…` ids are long and are a Stripe
  // implementation detail, and the id ends up in a Firestore path. Hashed
  // here rather than with `emailHash`, which lowercases first — Stripe ids are
  // case-sensitive and folding case would be a needless collision.
  return `ord_${createHash('sha256').update(externalId).digest('hex').slice(0, 24)}`;
}

export async function fulfilPurchase(input: FulfilInput): Promise<FulfilledRegistration> {
  const email = normaliseEmail(input.email);
  const rid = registrationId(email);
  const oid = orderIdFor(input.externalId);

  const regRef = db().collection(COLLECTIONS.registrations).doc(rid);
  const orderRef = db().collection(COLLECTIONS.orders).doc(oid);

  const result = await db().runTransaction(async (tx) => {
    const existing = await tx.get(regRef);
    const now = FieldValue.serverTimestamp();

    if (existing.exists) {
      const prev = existing.data() as RegistrationDoc;

      // Update in place. `createdAt`, `qrSecret`, `claimCode`, `altEmails` and
      // `claimedByUid` are all deliberately absent from this write: the badge
      // secrets must survive a repeat purchase, and an attendee who has
      // already claimed their registration in the app must not be unclaimed by
      // buying a second ticket.
      tx.update(regRef, {
        email,
        emailHash: emailHash(email),
        name: input.name,
        ticketType: input.ticketType,
        status: 'active',
        updatedAt: now,
      });

      return {
        registrationId: rid,
        email,
        name: input.name,
        ticketType: input.ticketType,
        // Older imported registrations may predate claim codes; mint one if so.
        claimCode: prev.claimCode ?? claimCode(),
        created: false,
        backfillClaimCode: prev.claimCode ? undefined : true,
      };
    }

    const fresh: Omit<RegistrationDoc, 'createdAt' | 'updatedAt'> = {
      eventId: EVENT_ID,
      email,
      emailHash: emailHash(email),
      altEmails: [],
      name: input.name,
      ticketType: input.ticketType,
      status: 'active',
      claimCode: claimCode(),
      // Random and opaque, and the only value that ever goes into a badge QR.
      // A uid here would let anyone who photographs a badge learn an identity.
      qrSecret: qrSecret(),
    };

    tx.set(regRef, { ...fresh, createdAt: now, updatedAt: now });

    return {
      registrationId: rid,
      email,
      name: input.name,
      ticketType: input.ticketType,
      claimCode: fresh.claimCode!,
      created: true,
      backfillClaimCode: undefined,
    };
  });

  if (result.backfillClaimCode) {
    await regRef.update({ claimCode: result.claimCode });
  }

  // The order is a separate, non-transactional write on purpose: it is a
  // record of the payment, not a precondition of the ticket. If this throws,
  // the attendee still has a valid registration and the finance record can be
  // reconciled from Stripe, which is the right way round to fail.
  const order: Omit<OrderDoc, 'createdAt' | 'updatedAt' | 'purchasedAt'> = {
    eventId: EVENT_ID,
    externalId: input.externalId,
    provider: 'stripe',
    email,
    status: input.paid ? 'paid' : 'pending',
    totalCents: input.amountCents,
    currency: input.currency,
  };
  await orderRef.set(
    {
      ...order,
      purchasedAt: Timestamp.now(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // `backfillClaimCode` is transaction bookkeeping and has no business on the
  // confirmation page, so it is stripped rather than returned.
  return {
    registrationId: result.registrationId,
    email: result.email,
    name: result.name,
    ticketType: result.ticketType,
    claimCode: result.claimCode,
    created: result.created,
  };
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
    ticketType: r.ticketType,
    claimCode: r.claimCode ?? '',
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
export async function cancelRegistrationByOrder(input: {
  externalId: string;
  reason: 'refunded' | 'disputed' | 'payment_failed';
}): Promise<{ registrationId: string | null; orderId: string }> {
  const oid = orderIdFor(input.externalId);
  const orderRef = db().collection(COLLECTIONS.orders).doc(oid);
  const snap = await orderRef.get();

  const orderStatus = input.reason === 'refunded' ? 'refunded' : 'cancelled';

  if (!snap.exists) {
    // A refund for something we never recorded. Write the order anyway so the
    // finance trail is complete and the discrepancy is visible, rather than
    // silently dropping it.
    await orderRef.set(
      {
        eventId: EVENT_ID,
        externalId: input.externalId,
        provider: 'stripe',
        email: '',
        status: orderStatus,
        totalCents: 0,
        currency: 'usd',
        purchasedAt: Timestamp.now(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { registrationId: null, orderId: oid };
  }

  const order = snap.data() as OrderDoc;
  await orderRef.update({ status: orderStatus, updatedAt: FieldValue.serverTimestamp() });

  if (!order.email) return { registrationId: null, orderId: oid };

  /**
   * Only withdraw the registration if this order is the reason it exists.
   *
   * Someone who bought twice — a workshop upgrade after a main-conference
   * ticket — has one registration backed by two orders, and refunding the
   * first must not revoke a ticket the second still pays for. So the
   * registration is cancelled only when no other paid order shares its email.
   */
  const rid = registrationId(order.email);
  const stillPaid = await db()
    .collection(COLLECTIONS.orders)
    .where('eventId', '==', EVENT_ID)
    .where('email', '==', order.email)
    .where('status', '==', 'paid')
    .get();

  const otherPaid = stillPaid.docs.filter((d) => d.id !== oid);
  if (otherPaid.length > 0) return { registrationId: null, orderId: oid };

  await db()
    .collection(COLLECTIONS.registrations)
    .doc(rid)
    .update({ status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });

  return { registrationId: rid, orderId: oid };
}
