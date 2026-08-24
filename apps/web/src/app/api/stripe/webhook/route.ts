import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { seatsFromInvoice } from '@/lib/invoicing';
import { cancelRegistrationByOrder, fulfilPurchase } from '@/lib/registrations';
import { stripe, stripeEnabled } from '@/lib/stripe';

/**
 * Stripe webhook — the authoritative fulfilment path.
 *
 * Three things this endpoint has to get right.
 *
 * **1. Verify the signature.** This URL is public and unauthenticated; without
 * `constructEventAsync` anyone could POST a JSON blob and mint themselves a
 * conference ticket. The signature is computed over the *raw* body, which is
 * why the text is read with `req.text()` and parsed only by Stripe — reading
 * it as JSON first and re-serialising changes the bytes and the check fails.
 *
 * **2. Be idempotent.** Stripe retries until it gets a 2xx, and Stripe's own
 * documentation is explicit that an event may be delivered more than once.
 * Idempotence here is structural rather than bolted on: `fulfilPurchase` keys
 * the registration by `registrationId(email)` and the order by a hash of the
 * Checkout Session id, both deterministic, so a replay rewrites the same two
 * documents rather than creating a third. `checkout.session.completed` is the
 * only event handled and its subject is the session, so "one document per
 * session" and "one document per event" are the same guarantee.
 *
 * **3. Fail loudly but return 200 for events we do not care about.** A 4xx on
 * an unhandled event type makes Stripe retry it forever and eventually disable
 * the endpoint, taking the events we *do* care about with it.
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

  /**
   * The events that actually change something, and why each is here.
   *
   * The previous version handled `checkout.session.completed` and returned
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
      return fulfil(event, event.data.object);

    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired': {
      // Nothing was ever fulfilled for these, so there is no registration to
      // withdraw — but the order should stop saying `pending` for ever.
      const session = event.data.object;
      const outcome = await cancelRegistrationByOrder({
        externalId: session.id,
        reason: 'payment_failed',
      });
      return NextResponse.json({ received: true, eventId: event.id, ...outcome });
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
      });
      return NextResponse.json({ received: true, eventId: event.id, ...outcome });
    }

    case 'charge.dispute.created': {
      // A chargeback is not a refund — the money may yet come back — but the
      // ticket must not be usable while it is contested, and re-enabling it is
      // a decision a human should make rather than a webhook.
      const dispute = event.data.object;
      const sessionId = await sessionIdForPaymentIntent(dispute.payment_intent);
      if (!sessionId) {
        return NextResponse.json({ received: true, skipped: 'no checkout session for dispute' });
      }
      const outcome = await cancelRegistrationByOrder({
        externalId: sessionId,
        reason: 'disputed',
      });
      return NextResponse.json({ received: true, eventId: event.id, ...outcome });
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
      const seats = seatsFromInvoice(invoice);
      if (seats.length === 0) {
        return NextResponse.json({ received: true, skipped: 'no attendee metadata on invoice' });
      }

      const registered: string[] = [];
      for (const [i, seat] of seats.entries()) {
        const result = await fulfilPurchase({
          email: seat.email,
          name: seat.name,
          ticketType: seat.ticketType,
          // One order per seat, derived from the invoice so a replay of this
          // event maps onto the same documents rather than duplicating them.
          externalId: `${invoice.id}_seat_${i}`,
          amountCents: Math.round((invoice.total ?? 0) / seats.length),
          currency: invoice.currency ?? 'usd',
          paid: true,
        });
        registered.push(result.registrationId);
      }

      return NextResponse.json({
        received: true,
        eventId: event.id,
        invoiceId: invoice.id,
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

/** Turn a paid Checkout session into a registration. */
async function fulfil(event: Stripe.Event, session: Stripe.Checkout.Session) {
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

  const result = await fulfilPurchase({
    email,
    name: session.metadata?.name ?? session.customer_details?.name ?? '',
    ticketType: session.metadata?.ticketType ?? 'Main Conference',
    externalId: session.id,
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
    paid: true,
  });

  return NextResponse.json({
    received: true,
    eventId: event.id,
    registrationId: result.registrationId,
    created: result.created,
  });
}
