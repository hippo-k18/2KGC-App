import 'server-only';

import { normaliseEmail } from '@kgc/scripts/src/lib/ids';
import type { EntitlementDoc, OrderDoc } from '@kgc/shared';
import { cartLines, restoreCartOrder } from '@/app/tickets/cart-order';
import { seatsToCount, splitAcrossSeats } from '@/app/tickets/seats-core';
import { provisionPurchaserAccount } from '@/lib/app-account';
import { grantOrderEntitlements } from '@/lib/app-account-core';
import { incrementSold, tierFulfilment } from '@/lib/catalogue';
import { sendPurchaseConfirmation } from '@/lib/email';
import { recordError } from '@/lib/errors';
import { db } from '@/lib/firestore';
import { mintOrderToken } from '@/lib/order-token';
import { claimAnswers } from '@/lib/question-forms';
import { ensureRegistration, fulfilPurchase } from '@/lib/registrations';

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
}

/**
 * Grant what a tier includes, without letting a failure reach the caller.
 *
 * A missing entitlement write is a support conversation; a webhook that 500s
 * over one is a retry storm that eventually disables the endpoint.
 */
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

export async function fulfilOrder(input: FulfilOrderInput): Promise<FulfilOrderResult> {
  const { externalId, tierId, origin } = input;

  /**
   * Who else is on this purchase — read **before** fulfilment, not after.
   *
   * A multi-seat cart writes its seat list onto the order document before the
   * buyer is ever sent to pay (`apps/web/src/app/tickets/cart-order.ts`),
   * because a Stripe metadata value caps at 500 characters and the invoice path
   * has already proved what a truncated attendee list costs: it parses to
   * nothing and nobody gets registered.
   *
   * ⚠️ The ordering is load-bearing. `fulfilPurchase` below writes `items` as a
   * single line describing the buyer, and a Firestore merge replaces an array
   * rather than merging into it — so reading this afterwards would find seats
   * two and three already gone. `restoreCartOrder` puts them back once the
   * registrations exist.
   *
   * Empty for an ordinary single-seat purchase, which is most of them.
   */
  const cart = await cartLines(externalId);

  const result = await fulfilPurchase({
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
   * The other seats, each an independent registration keyed on its own address.
   *
   * Idempotent for the same structural reason the buyer's is: `registrationId`
   * is a hash of the email, so a second run rewrites the same three documents
   * rather than minting six. There is no de-duplication table to keep, because
   * the ids are derived from the people.
   */
  const registrationIds = [result.registrationId];
  const entitlementsFor = new Map<string, Awaited<ReturnType<typeof tierFulfilment>>>();
  let seatsRegistered = 0;
  let seatAccountsCreated = 0;
  let seatAccountsFailed = 0;
  let buyerShare = input.amountCents;

  for (const [i, line] of cart.entries()) {
    const seatEmail = normaliseEmail(line.attendeeEmail ?? '');
    if (!seatEmail) continue;
    // Seat one is the buyer, fulfilled above. Their share of the total is
    // taken here so the email below reports it rather than the whole payment.
    if (seatEmail === buyerEmail) {
      buyerShare = shares[i] ?? buyerShare;
      continue;
    }

    const seat = await ensureRegistration({
      email: seatEmail,
      name: line.attendeeName ?? '',
      ticketType: line.ticketTypeName,
    });
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
    // receipt does not get a colleague into the app.
    await sendPurchaseConfirmation({
      to: seat.email,
      name: seat.name ?? line.attendeeName ?? '',
      ticketType: seat.ticketType ?? line.ticketTypeName,
      amountCents: shares[i] ?? 0,
      currency: input.currency,
      orderUrl: `${origin}/order/${mintOrderToken({ rid: seat.registrationId })}`,
      claimCode: seat.claimCode,
      registrationId: seat.registrationId,
      temporaryPassword: seatAccount.temporaryPassword,
    });
  }

  // Only count a seat the first time. A replay must not sell the same ticket
  // twice against a tier's capacity.
  const soldPerTier = seatsToCount(seatOutcomes);
  for (const [id, count] of soldPerTier) await incrementSold(id, count);

  /**
   * Put the seat list back, and attach every registration the payment bought.
   *
   * `fulfilPurchase` has just overwritten `items` with the buyer's single line,
   * because a Firestore merge replaces an array rather than merging into it.
   * Without this the order would remember one seat out of three: the dashboard
   * would show `seatCount: 1`, and a refund would give one seat back to
   * `quantitySold` and cancel one of the three tickets.
   *
   * Swallowed rather than surfaced, per the rule at the top of this file — the
   * three registrations already exist and are valid. ⚠️ But recorded loudly,
   * because a retry cannot repair it: the next run reads `items` and finds the
   * clobbered single line, so this is the only chance to write the list down.
   */
  if (cart.length > 1) {
    try {
      await restoreCartOrder({ sessionId: externalId, lines: cart, registrationIds });
    } catch (err) {
      await recordError('order.seats', err, { path: 'orders', id: externalId });
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

  await sendPurchaseConfirmation({
    to: result.email,
    name: result.name ?? '',
    ticketType: result.ticketType ?? '',
    amountCents: buyerShare,
    currency: input.currency,
    orderUrl: `${origin}/order/${mintOrderToken({ rid: result.registrationId })}`,
    claimCode: result.claimCode,
    registrationId: result.registrationId,
    temporaryPassword: account.temporaryPassword,
  });

  return {
    registrationId: result.registrationId,
    created: result.created,
    account: account.status,
    seats: cart.length || 1,
    seatsRegistered,
    seatsCounted: [...soldPerTier.values()].reduce((a, b) => a + b, 0),
    seatAccountsCreated,
    seatAccountsFailed,
  };
}
