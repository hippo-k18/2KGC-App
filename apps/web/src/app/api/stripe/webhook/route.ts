import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { incrementSold } from '@/lib/catalogue';
import { sendPurchaseConfirmation, sendRefundConfirmation } from '@/lib/email';
import { seatsFromInvoice } from '@/lib/invoicing';
import { mintOrderToken } from '@/lib/order-token';
import {
  cancelRegistrationByOrder,
  ensureRegistration,
  fulfilPurchase,
  markInvoiceOrderPaid,
  seatsFromOrder,
} from '@/lib/registrations';
import { siteOrigin, stripe, stripeEnabled } from '@/lib/stripe';

/**
 * Stripe webhook — the authoritative fulfilment path.
 *
 * Four things this endpoint has to get right.
 *
 * **1. Verify the signature.** This URL is public and unauthenticated; without
 * `constructEventAsync` anyone could POST a JSON blob and mint themselves a
 * conference ticket. The signature is computed over the *raw* body, which is
 * why the text is read with `req.text()` and parsed only by Stripe — reading
 * it as JSON first and re-serialising changes the bytes and the check fails.
 *
 * **2. Be idempotent.** Stripe retries until it gets a 2xx and its own
 * documentation is explicit that an event may be delivered more than once.
 * Idempotence here is structural: `fulfilPurchase` keys the registration by
 * `registrationId(email)` and the order by a hash of the Stripe object id, both
 * deterministic, so a replay rewrites the same documents rather than creating
 * new ones. `registrations.ts` additionally refuses to let a replayed sale
 * un-refund an order or restamp its purchase date.
 *
 * **3. Fail loudly but return 200 for events we do not care about.** A 4xx on
 * an unhandled event type makes Stripe retry it forever and eventually disable
 * the endpoint, taking the events we *do* care about with it.
 *
 * **4. Never let a side effect fail fulfilment.** Sending email and bumping the
 * sold counter both happen after the ticket exists, and both swallow their own
 * errors. A receipt that fails to send must not turn into a retry storm that
 * disables the endpoint — the ticket is the product, the receipt is a courtesy.
 */
export async function POST(req: NextRequest) {
  if (!stripeEnabled()) {
    // No Stripe account on this deployment: nothing legitimate can be posting
    // here, and pretending to accept it would hide a misconfiguration.
    return NextResponse.json({ error: 'stripe not configured' }, { status: 503 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET is not set' }, { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(raw, signature, secret);
  } catch (err) {
    // 400, not 500: the request is bad, and Stripe should not retry it.
    const message = err instanceof Error ? err.message : 'signature verification failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const origin = siteOrigin(req.headers.get('host'), req.headers.get('x-forwarded-proto'));

  /**
   * The events that actually change something, and why each is here.
   *
   * An earlier version handled `checkout.session.completed` and returned
   * `ignored` for everything else, which had two consequences that were not
   * obvious from reading it. A refund left the registration `active` — and
   * `active` is precisely what the check-in desk scans for, so a refunded
   * ticket still opened the door. And the comment below the payment-status
   * guard promised the registration would be written "when
   * `checkout.session.async_payment_succeeded` follows", which it never was,
   * because that event was ignored too. Bank debits and other delayed methods
   * therefore took money and produced no ticket at all.
   */
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return fulfil(event, event.data.object, origin);

    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired': {
      // Nothing was ever fulfilled for these, so there is no registration to
      // withdraw — but the order should stop saying `pending` for ever.
      const session = event.data.object;
      const outcome = await cancelRegistrationByOrder({
        externalId: session.id,
        reason: 'payment_failed',
      });
      return NextResponse.json({
        received: true,
        eventId: event.id,
        orderId: outcome.orderId,
        registrationId: outcome.registrationId,
      });
    }

    case 'charge.refunded': {
      const charge = event.data.object;
      // The order is keyed by the Checkout session id, which a charge does not
      // carry directly — it is reachable through the payment intent.
      const sessionId = await sessionIdForPaymentIntent(charge.payment_intent);
      if (!sessionId) {
        return NextResponse.json({ received: true, skipped: 'no checkout session for charge' });
      }

      const outcome = await cancelRegistrationByOrder({
        externalId: sessionId,
        reason: 'refunded',
        // Cumulative, so a second partial refund reads correctly. Below the
        // order total this records a partial refund and leaves the ticket
        // valid — someone who got $200 back on an $800 registration is still
        // coming, and revoking their badge would be the worse bug.
        refundedCents: charge.amount_refunded,
      });

      // Only tell someone their ticket is void when it actually is.
      if (outcome.fullyRefunded && outcome.email) {
        await sendRefundConfirmation({
          to: outcome.email,
          name: outcome.name,
          ticketType: outcome.ticketType,
          amountCents: outcome.refundedCents,
          currency: outcome.currency,
          orderId: outcome.orderId,
          registrationId: outcome.registrationId ?? undefined,
        });
      }

      return NextResponse.json({
        received: true,
        eventId: event.id,
        orderId: outcome.orderId,
        registrationId: outcome.registrationId,
        fullyRefunded: outcome.fullyRefunded,
      });
    }

    case 'charge.dispute.created': {
      // A chargeback is not a refund — the money may yet come back — but the
      // ticket must not be usable while it is contested, and re-enabling it is
      // a decision a human should make rather than a webhook.
      //
      // No email here on purpose: someone who has just filed a chargeback is
      // in a dispute with us, and an automated "your ticket is cancelled" is
      // the wrong opening move. The dashboard surfaces it for a human instead.
      const dispute = event.data.object;
      const sessionId = await sessionIdForPaymentIntent(dispute.payment_intent);
      if (!sessionId) {
        return NextResponse.json({ received: true, skipped: 'no checkout session for dispute' });
      }
      const outcome = await cancelRegistrationByOrder({
        externalId: sessionId,
        reason: 'disputed',
      });
      return NextResponse.json({
        received: true,
        eventId: event.id,
        orderId: outcome.orderId,
        registrationId: outcome.registrationId,
      });
    }

    case 'invoice.paid': {
      /**
       * A company's invoice cleared, so everyone it covers becomes a
       * registration — one per seat, each idempotent on its own email.
       *
       * Fulfilment deliberately happens here and not when the invoice was
       * raised. An invoice is a promise to pay; issuing badges against a
       * promise is how conferences end up chasing money from people who have
       * already attended and gone home.
       */
      const invoice = event.data.object;

      /**
       * Seats come from our own order record first, Stripe metadata second.
       *
       * Metadata is capped at 500 characters and `raiseInvoice` truncates the
       * attendee JSON to 480, so a large invoice yields a cut-off string that
       * fails to parse — and `seatsFromInvoice` returns an empty list by
       * design, which would register nobody for an invoice that has just been
       * paid. The order document has no such limit. Metadata still covers the
       * case of an invoice raised straight in the Stripe dashboard.
       */
      const seats = invoice.id
        ? await seatsFromOrder(invoice.id).then((rows) =>
            rows.length > 0
              ? rows
              : seatsFromInvoice(invoice).map((r) => ({ ...r, ticketTypeId: '' })),
          )
        : [];

      if (seats.length === 0) {
        return NextResponse.json({ received: true, skipped: 'no attendee list for invoice' });
      }

      /**
       * Split the total evenly, then give the remainder to the first seat.
       *
       * Plain division loses cents: $1,000 across three seats is 33333 each and
       * one cent short of the invoice. The finance person reconciling this will
       * notice, and "our records are a cent off yours" is a slow conversation.
       */
      const total = invoice.total ?? 0;
      const per = Math.floor(total / seats.length);
      const remainder = total - per * seats.length;

      /**
       * One order for the invoice, not one per seat.
       *
       * A company paying for four people made one payment. Four orders would
       * make "what has Acme paid?" unanswerable and would strand the pending
       * record written when the invoice was raised. So the registrations are
       * created directly and the single existing order is flipped to paid.
       */
      const registered: string[] = [];
      for (const [i, seat] of seats.entries()) {
        const amountCents = per + (i === 0 ? remainder : 0);
        const result = await ensureRegistration({
          email: seat.email,
          name: seat.name,
          ticketType: seat.ticketType,
        });
        registered.push(result.registrationId);

        if (seat.ticketTypeId && result.created) await incrementSold(seat.ticketTypeId);

        // Each seat is a person who needs their own claim code — the billing
        // contact's copy of the invoice does not get them into the app.
        await sendPurchaseConfirmation({
          to: result.email,
          name: result.name ?? '',
          ticketType: result.ticketType ?? seat.ticketType,
          amountCents,
          currency: invoice.currency ?? 'usd',
          orderUrl: `${origin}/order/${mintOrderToken({ rid: result.registrationId, demo: false })}`,
          claimCode: result.claimCode,
          registrationId: result.registrationId,
        });
      }

      const orderId = await markInvoiceOrderPaid({
        invoiceId: invoice.id!,
        registrationIds: registered,
        totalCents: total,
        taxCents: invoice.total_taxes?.reduce((sum, t) => sum + (t.amount ?? 0), 0) ?? 0,
        currency: invoice.currency ?? 'usd',
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
        invoicePdfUrl: invoice.invoice_pdf ?? undefined,
      });

      return NextResponse.json({
        received: true,
        eventId: event.id,
        invoiceId: invoice.id,
        orderId,
        registered: registered.length,
      });
    }

    case 'invoice.payment_failed':
      // Net-30 came and went, or the bank transfer bounced. Nothing was
      // fulfilled, so there is nothing to withdraw — this exists so the event
      // is acknowledged rather than retried, and shows up in the log.
      return NextResponse.json({ received: true, noted: 'invoice payment failed' });

    default:
      // Acknowledged, not handled. Returning an error for an event type we did
      // not subscribe to makes Stripe retry it and eventually disable the
      // endpoint, taking the events we *do* care about down with it.
      return NextResponse.json({ received: true, ignored: event.type });
  }
}

/**
 * A charge knows its payment intent; the order is keyed by the Checkout
 * session. One lookup bridges them.
 */
async function sessionIdForPaymentIntent(
  pi: string | Stripe.PaymentIntent | null,
): Promise<string | null> {
  const id = typeof pi === 'string' ? pi : pi?.id;
  if (!id) return null;
  const found = await stripe().checkout.sessions.list({ payment_intent: id, limit: 1 });
  return found.data[0]?.id ?? null;
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
    console.error('[webhook] could not expand session', session.id, err);
    return {};
  }
}

/** Turn a paid Checkout session into a registration. */
async function fulfil(event: Stripe.Event, session: Stripe.Checkout.Session, origin: string) {
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    // Still settling. `async_payment_succeeded` will arrive when it clears, and
    // that path now genuinely exists rather than merely being promised here.
    return NextResponse.json({ received: true, pending: true });
  }

  const email = session.customer_details?.email ?? session.customer_email;
  if (!email) {
    // Nothing to key a registration on. Acknowledge so Stripe stops retrying —
    // a retry cannot supply an email that was never collected — and let it show
    // up in the Stripe dashboard as an order with no registration.
    return NextResponse.json({ received: true, skipped: 'no email on session' });
  }

  const detail = await sessionDetail(session);
  const tierId = session.metadata?.tier;
  const customer = session.customer;
  const paymentIntent = session.payment_intent;

  const result = await fulfilPurchase({
    email,
    name: session.metadata?.name ?? session.customer_details?.name ?? '',
    ticketType: session.metadata?.ticketType ?? 'Main Conference',
    externalId: session.id,
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
    paid: true,
    channel: 'checkout',
    tierId,
    buyerName: session.customer_details?.name ?? undefined,
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
    stripeCustomerId: typeof customer === 'string' ? customer : (customer?.id ?? undefined),
    stripePaymentIntentId:
      typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent?.id ?? undefined),
    stripeChargeId: detail.chargeId,
  });

  /**
   * Both of these are after the fact and neither may throw upward.
   *
   * The counter is advisory (see `incrementSold`) and the email is a courtesy;
   * the ticket already exists and is valid. A failure in either must not turn
   * into a non-2xx, because Stripe would retry the event and eventually disable
   * the endpoint — losing fulfilment for everyone because one receipt bounced.
   *
   * Only count a seat the first time. A webhook replay must not sell the same
   * ticket twice against a tier's capacity.
   */
  if (tierId && result.created) await incrementSold(tierId);

  await sendPurchaseConfirmation({
    to: result.email,
    name: result.name ?? '',
    ticketType: result.ticketType ?? '',
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
    orderUrl: `${origin}/order/${mintOrderToken({ rid: result.registrationId, demo: false })}`,
    claimCode: result.claimCode,
    registrationId: result.registrationId,
  });

  return NextResponse.json({
    received: true,
    eventId: event.id,
    registrationId: result.registrationId,
    created: result.created,
  });
}
