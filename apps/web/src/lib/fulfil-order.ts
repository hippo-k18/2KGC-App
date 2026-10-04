import 'server-only';

import { normaliseEmail } from '@kgc/scripts/src/lib/ids';
import { COLLECTIONS, type EntitlementDoc, type OrderConfirmation, type OrderDoc } from '@kgc/shared';
import { attachSeatRegistrations, cartLines } from '@/app/tickets/cart-order';
import { seatsToCount, splitAcrossSeats } from '@/app/tickets/seats-core';
import { provisionPurchaserAccount } from '@/lib/app-account';
import { grantOrderEntitlements } from '@/lib/app-account-core';
import { incrementSold, tierFulfilment } from '@/lib/catalogue';
import { sendPurchaseConfirmation, type SendOutcome } from '@/lib/email';
import { recordError, recordWarning } from '@/lib/errors';
import { db } from '@/lib/firestore';
import { mintOrderToken } from '@/lib/order-token';
import { claimAnswers } from '@/lib/question-forms';
import { ensureRegistration, fulfilPurchase, orderIdFor } from '@/lib/registrations';
import { ensureReferralCode, recordReferral, type ReferralUtm } from '@kgc/scripts/src/lib/referrals';
import { isOrderSettledError } from '@kgc/scripts/src/lib/fulfilment';

/**
 * Turning a settled purchase into everything a purchase produces.
 *
 * ── Why this is its own file ────────────────────────────────────────────────
 *
 * It used to be the body of `fulfil()` in the Stripe webhook, which was the
 * only route that had ever needed it. There are now two callers — the webhook,
 * and the localhost-only rehearsal button in `tickets/actions.ts` — and the
 * whole value of the second one depends on it running *this* code rather than a
 * simplified copy of it. A demo path that fulfils differently from the real one
 * is a demo that proves nothing: the first thing it would stop exercising is
 * the account provisioning, which is exactly the step that was silently missing
 * before and exactly what a rehearsal is meant to catch.
 *
 * So the split is drawn at the Stripe boundary. Everything that reads a
 * `Stripe.Checkout.Session` stays in the webhook; everything that writes to
 * Firestore, provisions an account or sends a receipt is here, behind a plain
 * input object that has no Stripe types in it.
 *
 * ── The rule every side effect below obeys ──────────────────────────────────
 *
 * **Nothing after `fulfilPurchase` may throw upward.** The counter is advisory,
 * the account is repairable by the OTP flow, and the email is a courtesy; the
 * ticket already exists and is valid by the time any of them run. For the
 * webhook a thrown error means a non-2xx, which means Stripe retries and
 * eventually disables the endpoint — losing fulfilment for everybody because
 * one receipt bounced.
 */
export interface FulfilOrderInput {
  /**
   * The idempotency key, and the thing the order id is a hash of. A Stripe
   * Checkout Session id in production; a synthetic `demo_…` id from the
   * rehearsal button.
   */
  externalId: string;
  /** The buyer. Also seat one of a multi-seat cart. */
  email: string;
  name: string;
  buyerName?: string;
  ticketType: string;
  tierId?: string;
  /** What was actually charged, all seats together. Split across them below. */
  amountCents: number;
  currency: string;
  subtotalCents?: number;
  taxCents?: number;
  discountCents?: number;
  promotionCode?: string;
  campaignCode?: string;
  /**
   * The attendee invite this buyer arrived through (`KGC27-…`), and the UTMs on
   * that link. Stamped as `referredBy` / `utm` on every registration this order
   * makes. See `scripts/src/lib/referrals.ts` for what is ignored.
   */
  referralCode?: string;
  utm?: ReferralUtm;
  /**
   * Where the buyer's registration questions are parked. Claimed and deleted
   * here rather than by the caller, so a webhook replay and a repeated demo
   * behave the same way: the second run finds nothing and leaves the answers
   * already on the registration untouched.
   */
  answersRef?: string;
  channel: NonNullable<OrderDoc['channel']>;
  /** Origin for the links in the confirmation email. */
  origin: string;
  stripeCustomerId?: string;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
}

export interface FulfilOrderResult {
  registrationId: string;
  created: boolean;
  /** `created` / `existing` / `failed`, so a replay is legible from the outside. */
  account: string;
  /** What the payment covered. */
  seats: number;
  /** The extra attendees this run walked. */
  seatsRegistered: number;
  /** What actually moved against tier capacity — zero on every run after the first. */
  seatsCounted: number;
  seatAccountsCreated: number;
  seatAccountsFailed: number;
  /**
   * Registrations on this order whose confirmation has not gone out and is
   * still worth another try, including one another run is sending right now.
   * The webhook answers 5xx while this is non-empty so Stripe comes back.
   */
  confirmationsOutstanding: string[];
  /**
   * Set when the order had already been refunded or cancelled, and so nothing
   * was issued, re-activated or emailed. `registrationId` is then the order's
   * first ticket, now cancelled, or `''` when it never had one.
   */
  settled?: OrderDoc['status'];
}

/**
 * Grant what a tier includes, without letting a failure reach the caller.
 *
 * A missing entitlement write is a support conversation; a webhook that 500s
 * over one is a retry storm that eventually disables the endpoint.
 */
/**
 * The registration's referral code, or undefined. Never throws: the code is for
 * the "Bring your team" block, and a ticket must not fail over it.
 */
async function referralCodeFor(rid: string): Promise<string | undefined> {
  try {
    return (await ensureReferralCode(db(), rid)) ?? undefined;
  } catch (err) {
    await recordError('referral.code', err, { path: 'registrations', id: rid });
    return undefined;
  }
}

async function grantSeatEntitlements(
  uid: string,
  kinds: EntitlementDoc['kind'][],
): Promise<void> {
  if (kinds.length === 0) return;
  try {
    await grantOrderEntitlements(db(), uid, kinds);
  } catch (err) {
    await recordError('entitlement.grant', err, { path: 'users', id: uid });
  }
}

/**
 * How many times one person's confirmation is tried before the webhook stops
 * asking Stripe to come back for it.
 *
 * Five, because what fails five times in a row is not going to start working:
 * an address Resend refuses fails the same way every time, and Stripe's own
 * backoff spaces five deliveries over roughly an hour or more, which outlasts
 * an ordinary Resend blip. Without a limit a bad address would answer 5xx for
 * the three days Stripe retries, and an endpoint that fails for days is one
 * Stripe disables, taking every other purchase's fulfilment with it. After the
 * fifth failure organizers get an `auditLog` warning, the `emailLog` row stays
 * `failed`, and "Resend confirmation" on the attendee is the way out.
 */
export const CONFIRMATION_ATTEMPTS = 5;

/**
 * How long a `pending` claim stands before another run may take it over.
 *
 * A send takes seconds; a claim still pending after five minutes belongs to a
 * run that crashed or was restarted mid-send, and would otherwise block that
 * email for good. Long enough that no live send is still in flight, so taking
 * it over cannot double-send.
 */
const STALE_PENDING_MS = 5 * 60_000;

/**
 * Whether this run is the one that sends `rid` its purchase confirmation: the
 * attempt number if it is, `null` if not.
 *
 * A card purchase is fulfilled by the return redirect and by the webhook, in
 * either order or at the same moment, and Stripe may redeliver the webhook for
 * days. Registrations and capacity are idempotent on their own; an email is
 * not, so each one is claimed on the order in a transaction before it is sent:
 * `confirmations[rid]` becomes `pending`, and only after the provider accepts
 * it does it become `sent` (`sendClaimed`). A run that finds it `pending`,
 * `sent` or `skipped`, or `failed` too many times, leaves it alone.
 *
 * Claimed before sending, not after: a crash between the two strands a
 * `pending` claim, which is reclaimed once stale, where the other order would
 * send it again to everyone on every replay. If the claim itself fails the
 * email is sent anyway, because a missing ticket email is the worse outcome.
 */
async function claimConfirmation(orderId: string, rid: string): Promise<number | null> {
  try {
    const ref = db().collection(COLLECTIONS.orders).doc(orderId);
    return await db().runTransaction(async (tx) => {
      const order = (await tx.get(ref)).data() as OrderDoc | undefined;
      // No confirmation for a ticket whose money has gone back (T135, TK-163).
      if (isSettled(order)) return null;
      if (order?.confirmationsSent?.includes(rid)) return null;
      const prev = order?.confirmations?.[rid];
      if (!claimable(prev, Date.now())) return null;
      const attempts = (prev?.attempts ?? 0) + 1;
      tx.set(ref, { confirmations: { [rid]: { state: 'pending', at: Date.now(), attempts } } }, { merge: true });
      return attempts;
    });
  } catch (err) {
    await recordError('order.confirmationClaim', err, { path: 'orders', id: orderId });
    return 1;
  }
}

/** Refunded or cancelled: an order that issues and confirms nothing more. */
function isSettled(order: Pick<OrderDoc, 'status'> | undefined): boolean {
  return order?.status === 'refunded' || order?.status === 'cancelled';
}

function claimable(c: OrderConfirmation | undefined, now: number): boolean {
  if (!c) return true;
  if (c.state === 'sent' || c.state === 'skipped') return false;
  if (c.state === 'pending') return now - c.at > STALE_PENDING_MS;
  return c.attempts < CONFIRMATION_ATTEMPTS;
}

/**
 * Whether the webhook still owes Stripe a retry for this confirmation: it has
 * not gone out, and it has not used up its attempts. A `pending` one counts,
 * because the run holding it may yet fail, and the webhook is the only caller
 * that can be retried.
 */
function outstanding(c: OrderConfirmation | undefined): boolean {
  if (!c) return true;
  if (c.state === 'sent' || c.state === 'skipped') return false;
  if (c.state === 'pending') return true;
  return c.attempts < CONFIRMATION_ATTEMPTS;
}

/**
 * Send a claimed confirmation and record what happened to it.
 *
 * `sent` is written only after the provider took the email, so "claimed" and
 * "delivered" are never confused. `'failed'` (Resend refused it, or the
 * network did) and a throw record `failed`, which the next run may claim
 * again, and on the webhook keep Stripe redelivering until it goes out (T130,
 * T132). The attempt that uses up the last of `CONFIRMATION_ATTEMPTS` warns
 * organizers instead.
 *
 * `'skipped'` means no email provider is configured, a property of the
 * deployment rather than of this send: every retry would skip as well and add
 * another `emailLog` row, so it is recorded as final.
 *
 * A throw is passed on after it is recorded, as it always was. On the webhook
 * that is a 5xx, which is what makes Stripe deliver the event again.
 */
async function sendClaimed(
  claim: { orderId: string; rid: string; attempts: number; to: string },
  send: () => Promise<SendOutcome>,
): Promise<void> {
  let outcome: SendOutcome;
  try {
    outcome = await send();
  } catch (err) {
    await settleConfirmation(claim, 'failed');
    throw err;
  }
  await settleConfirmation(claim, outcome);
}

/**
 * Record the outcome. A plain write, not a transaction: only the holder of a
 * `pending` claim settles it, so nobody else is writing this entry, and a
 * transaction here was one more lock on the order document that the
 * registrations' own transactions wait behind.
 */
async function settleConfirmation(
  claim: { orderId: string; rid: string; attempts: number; to: string },
  outcome: SendOutcome,
): Promise<void> {
  const { orderId, rid, attempts, to } = claim;
  const state: OrderConfirmation['state'] = outcome;
  try {
    await db()
      .collection(COLLECTIONS.orders)
      .doc(orderId)
      .set({ confirmations: { [rid]: { state, at: Date.now(), attempts } } }, { merge: true });
  } catch (err) {
    await recordError('order.confirmationSettle', err, { path: 'orders', id: orderId });
    return;
  }
  if (state === 'failed' && attempts >= CONFIRMATION_ATTEMPTS) {
    await recordWarning(
      'confirmation.undelivered',
      {
        registrationId: rid,
        email: to,
        attempts,
        note: 'The purchase confirmation could not be sent and will not be retried. Use Resend confirmation on the attendee.',
      },
      { path: 'orders', id: orderId },
    );
  }
}

/** Every one of `rids` whose confirmation has not gone out and is still worth retrying. */
async function confirmationsOutstanding(orderId: string, rids: string[]): Promise<string[]> {
  try {
    const order = (await db().collection(COLLECTIONS.orders).doc(orderId).get()).data() as OrderDoc | undefined;
    if (isSettled(order)) return [];
    return [...new Set(rids)].filter(
      (rid) => !order?.confirmationsSent?.includes(rid) && outstanding(order?.confirmations?.[rid]),
    );
  } catch (err) {
    await recordError('order.confirmationCheck', err, { path: 'orders', id: orderId });
    return [];
  }
}

/**
 * What a run reports for an order that was refunded or cancelled before it got
 * here: nothing issued, nothing counted, nothing owed.
 */
async function settledResult(orderId: string): Promise<FulfilOrderResult> {
  const order = (await db().collection(COLLECTIONS.orders).doc(orderId).get()).data() as OrderDoc | undefined;
  return {
    registrationId: order?.registrationIds?.[0] ?? '',
    created: false,
    account: 'existing',
    seats: Math.max(1, order?.items?.length ?? 1),
    seatsRegistered: 0,
    seatsCounted: 0,
    seatAccountsCreated: 0,
    seatAccountsFailed: 0,
    confirmationsOutstanding: [],
    settled: order?.status ?? 'cancelled',
  };
}

export async function fulfilOrder(input: FulfilOrderInput): Promise<FulfilOrderResult> {
  const { externalId, tierId, origin } = input;
  const oid = orderIdFor(externalId);

  /**
   * A refunded or cancelled order is finished. Stripe redelivering the sale,
   * the buyer reopening `/checkout/return` from their history, or a refund
   * that overtook the sale all arrive here after the money went back, and
   * every one of them used to put the tickets back to `active` and send the
   * confirmation again (T135, S12/S13). `ensureRegistration` refuses the same
   * thing inside its transaction, which covers a refund landing mid-run.
   */
  const before = (await db().collection(COLLECTIONS.orders).doc(oid).get()).data() as OrderDoc | undefined;
  if (isSettled(before)) return settledResult(oid);

  /**
   * Every confirmation carries a signed `/order/` link, and signing needs
   * `WEB_ORDER_SECRET`. Without it this used to write the tickets and then
   * throw at the first email, leaving active tickets nobody was told about
   * (T135, TK-326). Minting one up front throws before anything is written;
   * the webhook answers 5xx and Stripe redelivers once the setting is fixed.
   */
  mintOrderToken({ rid: 'preflight' });

  /**
   * Who else is on this purchase — read **before** fulfilment, not after.
   *
   * A multi-seat cart writes its seat list onto the order document before the
   * buyer is ever sent to pay (`apps/web/src/app/tickets/cart-order.ts`),
   * because a Stripe metadata value caps at 500 characters and the invoice path
   * has already proved what a truncated attendee list costs: it parses to
   * nothing and nobody gets registered.
   *
   * `fulfilPurchase` below keeps this list as it is; it used to overwrite it
   * with the buyer's line, which is why this is still read first.
   *
   * Empty for an ordinary single-seat purchase, which is most of them.
   */
  const cart = await cartLines(externalId);

  let result: Awaited<ReturnType<typeof fulfilPurchase>>;
  try {
    result = await fulfilPurchase({
      email: input.email,
      name: input.name,
      ticketType: input.ticketType,
      externalId,
      amountCents: input.amountCents,
      currency: input.currency,
      paid: true,
      channel: input.channel,
      tierId,
      buyerName: input.buyerName,
      subtotalCents: input.subtotalCents,
      taxCents: input.taxCents,
      discountCents: input.discountCents,
      promotionCode: input.promotionCode,
      campaignCode: input.campaignCode,
      answers: await claimAnswers(input.answersRef),
      stripeCustomerId: input.stripeCustomerId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeChargeId: input.stripeChargeId,
    });
  } catch (err) {
    if (isOrderSettledError(err)) return settledResult(oid);
    throw err;
  }

  /**
   * What each seat cost, from one figure reported for the whole payment.
   *
   * Split rather than read off the tier prices, because tax and any promotion
   * code are the processor's arithmetic and land only on the total. Three
   * people each get a confirmation naming their own share, and the three add up
   * to the receipt — the property `splitAcrossSeats` exists to guarantee.
   */
  const shares = splitAcrossSeats(input.amountCents, Math.max(1, cart.length));
  const buyerEmail = normaliseEmail(result.email);

  /**
   * What each seat did to its tier's capacity, gathered and counted once.
   *
   * The rule is `seatsToCount` in `tickets/seats-core.ts`, where it is pure and
   * pinned by `tests/commerce` — three seats must take three off the tier, and
   * a redelivered event must take none.
   */
  const seatOutcomes: { created: boolean; ticketTypeId?: string }[] = [
    { created: result.created, ticketTypeId: tierId },
  ];

  /**
   * The other seats, each an independent registration.
   *
   * Each passes its order and position, so a second run rewrites the same
   * documents rather than minting more, and a seat whose address already
   * holds a ticket (or repeats another seat's) gets a ticket of its own
   * rather than overwriting that one. One address may hold several tickets
   * since 2026-09-26; the dashboard flags it.
   */
  let buyerSeen = false;
  const registrationIds = [result.registrationId];
  const entitlementsFor = new Map<string, Awaited<ReturnType<typeof tierFulfilment>>>();
  let seatsRegistered = 0;
  let seatAccountsCreated = 0;
  let seatAccountsFailed = 0;
  let buyerShare = input.amountCents;

  for (const [i, line] of cart.entries()) {
    const seatEmail = normaliseEmail(line.attendeeEmail ?? '');
    if (!seatEmail) continue;
    // The buyer's first seat was fulfilled above. Their share of the total is
    // taken here so the email below reports it rather than the whole payment.
    // A later seat with the buyer's address is a further ticket for them.
    if (seatEmail === buyerEmail && !buyerSeen) {
      buyerSeen = true;
      buyerShare = shares[i] ?? buyerShare;
      continue;
    }

    let seat: Awaited<ReturnType<typeof ensureRegistration>>;
    try {
      seat = await ensureRegistration({
        email: seatEmail,
        name: line.attendeeName ?? '',
        ticketType: line.ticketTypeName,
        // Seat 0 is the buyer's, in `fulfilPurchase`; cart positions start at 1.
        purchase: { orderId: oid, seat: i + 1 },
      });
    } catch (err) {
      // Refunded while this run was walking the seats.
      if (isOrderSettledError(err)) return settledResult(oid);
      throw err;
    }
    registrationIds.push(seat.registrationId);
    seatsRegistered += 1;
    seatOutcomes.push({ created: seat.created, ticketTypeId: line.ticketTypeId });

    /**
     * One account per attendee, not one per order. The person who paid may be
     * the only one of the three whose address is on the card; the other two
     * still need an identity to sign in with, and `provisionPurchaserAccount`
     * is keyed by the attendee's own address and idempotent per address.
     */
    const seatAccount = await provisionPurchaserAccount({
      email: seat.email,
      name: seat.name ?? line.attendeeName ?? '',
    });
    if (seatAccount.status === 'created') seatAccountsCreated += 1;
    if (seatAccount.status === 'failed') seatAccountsFailed += 1;

    if (seatAccount.uid && line.ticketTypeId) {
      if (!entitlementsFor.has(line.ticketTypeId)) {
        entitlementsFor.set(line.ticketTypeId, await tierFulfilment(line.ticketTypeId));
      }
      const tier = entitlementsFor.get(line.ticketTypeId);
      if (tier) await grantSeatEntitlements(seatAccount.uid, tier.entitlements);
    }

    // Their own claim code, to their own address. The buyer's copy of the
    // receipt does not get a colleague into the app. Once per seat, however
    // many times this purchase is fulfilled.
    const seatAttempt = await claimConfirmation(oid, seat.registrationId);
    if (seatAttempt === null) continue;
    await sendClaimed({ orderId: oid, rid: seat.registrationId, attempts: seatAttempt, to: seat.email }, async () =>
      sendPurchaseConfirmation({
        to: seat.email,
        name: seat.name ?? line.attendeeName ?? '',
        ticketType: seat.ticketType ?? line.ticketTypeName,
        amountCents: shares[i] ?? 0,
        currency: input.currency,
        orderUrl: `${origin}/order/${mintOrderToken({ rid: seat.registrationId })}`,
        claimCode: seat.claimCode,
        orderId: oid,
        registrationId: seat.registrationId,
        temporaryPassword: seatAccount.temporaryPassword,
        referralCode: await referralCodeFor(seat.registrationId),
      }),
    );
  }

  // Only count a seat the first time. A replay must not sell the same ticket
  // twice against a tier's capacity.
  const soldPerTier = seatsToCount(seatOutcomes);
  for (const [id, count] of soldPerTier) await incrementSold(id, count);

  /**
   * Attach every registration the payment bought to the order.
   *
   * Added to the list rather than written over it, so the return redirect and
   * the webhook running at once cannot cut each other's seats out of it.
   * Swallowed rather than surfaced, per the rule at the top of this file: the
   * registrations already exist and are valid, and the next run adds them again.
   */
  if (cart.length > 1) {
    try {
      await attachSeatRegistrations({ sessionId: externalId, registrationIds });
    } catch (err) {
      await recordError('order.seats', err, { path: 'orders', id: externalId });
    }
  }

  /**
   * Who brought them. Every registration this order made is credited to the
   * referrer, once; a bad code, a self-referral or a replay changes nothing.
   * Swallowed like everything else after `fulfilPurchase`.
   */
  if (input.referralCode || input.utm) {
    try {
      const referral = await recordReferral(db(), {
        registrationIds,
        code: input.referralCode,
        utm: input.utm,
      });
      if (referral.invalidCode || referral.selfReferrals.length) {
        console.info('[fulfil] referral ignored for', externalId, referral);
      }
    } catch (err) {
      await recordError('referral.record', err, { path: 'orders', id: oid });
    }
  }

  /**
   * The buyer's account.
   *
   * Deliberately **not** behind `result.created`, unlike the counter above, and
   * the difference is worth stating because the two look interchangeable.
   * `incrementSold` is an increment: running it twice is wrong, and nothing
   * about the operation itself can tell that it already ran, so it needs an
   * external guard. Provisioning is keyed by a uid derived from the address and
   * checks for the account before creating one, so running it twice is a no-op
   * by construction — and gating it on `result.created` would *skip* it for the
   * case that most needs it, an attendee imported from the Whova export who
   * then buys a ticket. The registration already exists; the account does not.
   */
  const account = await provisionPurchaserAccount({
    email: result.email,
    name: result.name ?? input.name,
  });

  /**
   * What the ticket unlocks, from the tier's own `includesWorkshops` /
   * `includesVideoLibrary`. The dashboard has always been able to set them and
   * nothing has ever written the grant they imply, so a tier could sell a video
   * library that no surface would let anybody watch.
   */
  if (account.uid && tierId) {
    const tier = await tierFulfilment(tierId);
    if (tier) await grantSeatEntitlements(account.uid, tier.entitlements);
  }

  const buyerAttempt = await claimConfirmation(oid, result.registrationId);
  if (buyerAttempt !== null) {
    await sendClaimed({ orderId: oid, rid: result.registrationId, attempts: buyerAttempt, to: result.email }, async () =>
      sendPurchaseConfirmation({
        to: result.email,
        name: result.name ?? '',
        ticketType: result.ticketType ?? '',
        amountCents: buyerShare,
        currency: input.currency,
        orderUrl: `${origin}/order/${mintOrderToken({ rid: result.registrationId })}`,
        claimCode: result.claimCode,
        orderId: oid,
        registrationId: result.registrationId,
        temporaryPassword: account.temporaryPassword,
        referralCode: await referralCodeFor(result.registrationId),
      }),
    );
  }

  return {
    registrationId: result.registrationId,
    created: result.created,
    account: account.status,
    seats: cart.length || 1,
    seatsRegistered,
    seatsCounted: [...soldPerTier.values()].reduce((a, b) => a + b, 0),
    seatAccountsCreated,
    seatAccountsFailed,
    confirmationsOutstanding: await confirmationsOutstanding(oid, registrationIds),
  };
}
