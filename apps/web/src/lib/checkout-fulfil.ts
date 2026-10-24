import 'server-only';

import type Stripe from 'stripe';
import type { WebsiteCheckout } from '@/lib/checkout-source';
import { fulfilOrder, type FulfilOrderResult } from '@/lib/fulfil-order';
import { referralFromMetadata } from '@/lib/referral-capture';
import { stripe } from '@/lib/stripe';

/**
 * Fulfil a paid Checkout session that the tickets page started.
 *
 * ── Why the webhook and the return redirect share this ──────────────────────
 *
 * A card purchase reaches us twice: Stripe sends the buyer back to
 * `/checkout/return`, and it delivers `checkout.session.completed` to the
 * webhook on its own schedule, possibly more than once. Either may come first,
 * and the redirect usually does.
 *
 * The redirect used to run a smaller, one-seat fulfilment of its own. On a
 * group purchase that write replaced the order's seat list with the buyer's
 * line, so the webhook that followed found nobody else to register: seats two
 * and up got no ticket and no email, and none of the seats was counted against
 * capacity (T129, 2026-10-04). Two fulfilments that differ is two ways to be
 * right, and only one of them was tested.
 *
 * So both run this, which is `fulfilOrder` with the session's figures. It is
 * idempotent end to end: registrations are keyed by address and seat, capacity
 * moves only for a registration this run created, and each confirmation is
 * claimed on the order before it is sent. Whichever caller is first does the
 * work; the other, and every replay, finds it done.
 *
 * The caller has already checked that the session is paid, has an email, and
 * is ours (`websiteCheckout`). Those checks differ in what they do on failure,
 * a 200 for Stripe and a redirect for the buyer, so they stay with the caller.
 */
export async function fulfilCheckoutSession(input: {
  session: Stripe.Checkout.Session;
  ours: WebsiteCheckout;
  email: string;
  /** Origin for the links in the confirmation emails. */
  origin: string;
}): Promise<FulfilOrderResult> {
  const { session, ours, email, origin } = input;
  const detail = await sessionDetail(session);
  const customer = session.customer;
  const paymentIntent = session.payment_intent;

  return fulfilOrder({
    externalId: session.id,
    email,
    name: session.metadata?.name ?? session.customer_details?.name ?? '',
    buyerName: session.customer_details?.name ?? undefined,
    ticketType: ours.ticketType,
    tierId: ours.tierId,
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
    // Stripe's own arithmetic, kept rather than recomputed — the dashboard
    // should show the same subtotal and tax the buyer's receipt shows.
    subtotalCents: session.amount_subtotal ?? undefined,
    taxCents: session.total_details?.amount_tax ?? 0,
    discountCents: session.total_details?.amount_discount ?? 0,
    promotionCode: detail.promotionCode,
    /**
     * The tracked link this purchase came through, put into metadata by
     * `startCheckout` and coming back out here — the only way across the Stripe
     * redirect, because the buyer left our origin entirely.
     *
     * Undefined when the buyer arrived directly, which is most of them.
     * Undefined is *unattributed*, not organic: an ad blocker, a cleared
     * cookie, or a link shared onward as plain text all land here too.
     */
    campaignCode: session.metadata?.campaignCode || undefined,
    /**
     * An attendee's invite code and UTMs, put into metadata by `startCheckout`
     * from the cookies the personal link set. Re-validated on the way out;
     * fulfilment ignores a code that does not resolve or is the buyer's own.
     */
    ...referralFromMetadata(session.metadata),
    /**
     * The registration questions, answered on our page before the redirect and
     * held in `pendingAnswers` until now. Claimed inside `fulfilOrder`, so a
     * replay finds nothing there and leaves the answers already on the
     * registration untouched.
     */
    answersRef: session.metadata?.answersRef,
    channel: 'checkout',
    origin,
    stripeCustomerId: typeof customer === 'string' ? customer : (customer?.id ?? undefined),
    stripePaymentIntentId:
      typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent?.id ?? undefined),
    stripeChargeId: detail.chargeId,
  });
}

/**
 * Everything about a Checkout session the order record wants, fetched in one
 * call.
 *
 * The event payload carries most of it, but not the charge id — that lives two
 * hops away on the payment intent, and it is the id an organizer needs to find
 * the payment in the Stripe dashboard or to issue a refund against it. One
 * retrieve with an expansion beats three round trips, and a failure here is
 * survivable: the order simply records less.
 */
async function sessionDetail(session: Stripe.Checkout.Session): Promise<{
  chargeId?: string;
  promotionCode?: string;
}> {
  try {
    const full = await stripe().checkout.sessions.retrieve(session.id, {
      expand: ['payment_intent', 'discounts.promotion_code'],
    });
    const pi = full.payment_intent;
    const latest = typeof pi === 'string' ? undefined : pi?.latest_charge;
    const promo = full.discounts?.[0]?.promotion_code;

    return {
      chargeId: typeof latest === 'string' ? latest : latest?.id,
      promotionCode: typeof promo === 'string' ? promo : (promo?.code ?? undefined),
    };
  } catch (err) {
    console.error('[checkout] could not expand session', session.id, err);
    return {};
  }
}
