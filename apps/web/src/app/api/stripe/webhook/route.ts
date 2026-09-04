import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import { COLLECTIONS, EVENT_ID, type EntitlementDoc, type OrderDoc } from '@kgc/shared';
import { normaliseEmail, registrationId } from '@kgc/scripts/src/lib/ids';
import { cartLines, restoreCartOrder } from '@/app/tickets/cart-order';
import { seatsToCount, splitAcrossSeats } from '@/app/tickets/seats-core';
import { provisionPurchaserAccount } from '@/lib/app-account';
import {
  grantOrderEntitlements,
  uidForEmail,
  withdrawOrderEntitlements,
} from '@/lib/app-account-core';
import { incrementSold, tierFulfilment } from '@/lib/catalogue';
import { sendPurchaseConfirmation, sendRefundConfirmation } from '@/lib/email';
import { recordError, recordWarning } from '@/lib/errors';
import { db } from '@/lib/firestore';
import { seatsFromInvoice } from '@/lib/invoicing';
import { mintOrderToken } from '@/lib/order-token';
import { claimAnswers } from '@/lib/question-forms';
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
 * ⚠️ That property is what makes **multi-seat** fulfilment safe, and it is
 * worth stating because a group purchase is where the failure would be
 * expensive. Three seats are three calls to `ensureRegistration` against three
 * addresses, and the ids are hashes of those addresses — so a redelivered event
 * rewrites the same three documents rather than minting six. Nothing counts,
 * nothing appends, and there is no de-duplication table to keep. The two
 * operations that genuinely are not idempotent are guarded explicitly:
 * `incrementSold` runs only for seats this delivery created, and the seat list
 * is written back with a `set` rather than an `arrayUnion`.
 *
 * **3. Fail loudly but return 200 for events we do not care about.** A 4xx on
 * an unhandled event type makes Stripe retry it forever and eventually disable
 * the endpoint, taking the events we *do* care about with it.
 *
 * **4. Never let a side effect fail fulfilment.** Sending email, bumping the
 * sold counter and creating the buyer's account all happen after the ticket
 * exists, and all swallow their own errors. A receipt that fails to send must
 * not turn into a retry storm that disables the endpoint — the ticket is the
 * product, the receipt is a courtesy.
 *
 * **5. Give the buyer an identity.** ★ This is the whole reason demo mode could
 * not simply be deleted, and it is why this had to land first. The only thing
 * in the repo that created a Firebase Auth account for a buyer used to be
 * `provisionAppAccount()`, whose single call site sat inside
 * `if (!stripeEnabled())` *and* behind a `DEMO_MODE` check — so with a real
 * Stripe key, control never reached it and a paying customer got a
 * registration, an order, a receipt and **no account at all**. They would sign
 * in to an app that `firestore.rules` denies at every read, because the
 * `registered` custom claim is what it gates on and nothing had stamped it.
 *
 * Provisioning now runs here, on `checkout.session.completed` and on
 * `invoice.paid` (one account per attendee, not one per order). It creates the
 * account, stamps the claim and writes the profile and its directory
 * projection. It **does not set a password** — the way in is the six-digit code
 * from `functions/src/callable/`, and a second sign-in mechanism invented here
 * would be one more credential nobody can rotate.
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

      /**
       * Give the seats back.
       *
       * `quantitySold` was a one-way ratchet: ten refunds permanently consumed
       * ten seats and no screen could correct it, so a capped tier's inventory
       * shrank with every refund until it reported sold out with the room half
       * empty.
       *
       * Three constraints, all of them the difference between a fix and a new
       * bug. **Full refunds only** — `outcome.fullyRefunded` is false for a
       * partial one, where the attendee still holds a valid ticket and the seat
       * is still sold. **Once** — `newlyRefunded` is the guard, and it is not
       * the same question as `fullyRefunded`: Stripe redelivers this event for
       * up to three days reporting the same cumulative `amount_refunded` every
       * time, so without it a replay would hand back the same seat twice and
       * oversell the tier. And **best effort** — `incrementSold` swallows its
       * own errors for the same reason it does on the way up: a lost counter
       * must never fail a refund that has already moved real money.
       */
      const seatsReturned: string[] = [];
      if (outcome.newlyRefunded) {
        for (const line of outcome.lines) {
          await incrementSold(line.ticketTypeId, -line.quantity);
          seatsReturned.push(line.ticketTypeId);
        }
      }

      /**
       * Withdraw what the money bought, so the entitlement and the ticket move
       * together.
       *
       * Gated on `registrationId` rather than on `fullyRefunded`, because that
       * field is non-null only when `cancelRegistrationByOrder` actually
       * cancelled the ticket — which it declines to do when a second, still-paid
       * order covers the same person. Somebody who refunded a workshop upgrade
       * and kept their main-conference ticket keeps their access with it.
       *
       * `withdrawOrderEntitlements` removes only `source: 'order'` grants, so a
       * speaker's or a staff member's access survives a refund of something
       * they also bought.
       */
      let entitlementsWithdrawn = 0;
      if (outcome.newlyRefunded && outcome.registrationId && outcome.email) {
        try {
          entitlementsWithdrawn = await withdrawOrderEntitlements(
            db(),
            uidForEmail(outcome.email),
          );
        } catch (err) {
          await recordError('entitlement.withdraw', err, {
            path: 'orders',
            id: outcome.orderId,
          });
        }
      }

      /**
       * The other seats on a group purchase.
       *
       * `cancelRegistrationByOrder` cancels the registration keyed on the
       * *order's* email — the buyer's — which was the whole story while a
       * Checkout session was one ticket for one person. On a three-seat
       * purchase it leaves the other two `active`, and `active` is precisely
       * what the check-in desk scans for: the same "a refunded ticket still
       * opened the door" bug that `charge.refunded` was added to fix, back
       * again for exactly the purchases with the most money on them.
       */
      const seatsCancelled = outcome.newlyRefunded
        ? await cancelExtraSeats(sessionId, outcome.email)
        : [];

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
        // In the response so a replay is visible in Stripe's own event log:
        // the first delivery reports seats returned, every later one reports
        // none, which is what idempotent looks like from the outside.
        newlyRefunded: outcome.newlyRefunded,
        seatsReturned,
        seatsCancelled,
        entitlementsWithdrawn,
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
      // A disputed group purchase is the same problem as a refunded one: the
      // buyer's ticket is withdrawn and their three colleagues' are not.
      const seatsCancelled = outcome.newlyRefunded
        ? await cancelExtraSeats(sessionId, outcome.email)
        : [];
      return NextResponse.json({
        received: true,
        eventId: event.id,
        orderId: outcome.orderId,
        registrationId: outcome.registrationId,
        seatsCancelled,
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
       * The arithmetic used to be written out here and is now
       * `splitAcrossSeats`, shared with the multi-seat card path — two copies
       * of a rounding rule is two ways to be a cent off, and being a cent off
       * is a slow conversation with somebody's finance department.
       */
      const total = invoice.total ?? 0;
      const shares = splitAcrossSeats(total, seats.length);

      /**
       * One order for the invoice, not one per seat.
       *
       * A company paying for four people made one payment. Four orders would
       * make "what has Acme paid?" unanswerable and would strand the pending
       * record written when the invoice was raised. So the registrations are
       * created directly and the single existing order is flipped to paid.
       */
      /**
       * Re-check capacity **here**, not only when the invoice was raised.
       *
       * `tickets/invoice/actions.ts` refuses a closed tier at the moment the
       * invoice is created — and then the invoice sits on net-30 terms for a
       * month. That is a thirty-day window in which the tier can sell out, the
       * sales window can close, or an organizer can lower the cap, and until
       * now `invoice.paid` registered every seat regardless and silently
       * oversold the room. The person who found out was whoever was standing at
       * the door.
       *
       * Checked, not refused. The money has arrived: refusing to register
       * somebody who has paid would be the worse failure, and the person able to
       * fix it — add capacity, move the seat, refund it — is an organizer, who
       * needs to be *told*. So each affected seat is flagged into `auditLog`,
       * which the dashboard renders, and reported in the response so it is
       * visible in Stripe's event log too.
       *
       * The tiers are read once and their remaining seats decremented in memory
       * as the loop consumes them, so an invoice for five seats against a tier
       * with three left flags the last two rather than all five or none.
       */
      const tiers = new Map<string, Awaited<ReturnType<typeof tierFulfilment>>>();
      for (const seat of seats) {
        // `''` is a seat recovered from Stripe metadata — an invoice raised
        // straight in the Stripe dashboard, with no order record naming a tier.
        // There is no catalogue entry to check it against and no counter to
        // move; registering it is still right.
        if (!seat.ticketTypeId || tiers.has(seat.ticketTypeId)) continue;
        tiers.set(seat.ticketTypeId, await tierFulfilment(seat.ticketTypeId));
      }

      const registered: string[] = [];
      const oversold: { email: string; ticketTypeId: string; reason: string }[] = [];
      let accountsCreated = 0;
      let accountsFailed = 0;

      for (const [i, seat] of seats.entries()) {
        const amountCents = shares[i] ?? 0;
        const tier = seat.ticketTypeId ? (tiers.get(seat.ticketTypeId) ?? null) : null;

        if (tier) {
          const soldOut = tier.remaining !== undefined && tier.remaining <= 0;
          if (soldOut || !tier.onSale) {
            oversold.push({
              email: seat.email,
              ticketTypeId: seat.ticketTypeId,
              reason: soldOut ? 'no seats left' : (tier.unavailableReason ?? 'not on sale'),
            });
          }
          if (tier.remaining !== undefined) tier.remaining -= 1;
        }

        const result = await ensureRegistration({
          email: seat.email,
          name: seat.name,
          ticketType: seat.ticketType,
        });
        registered.push(result.registrationId);

        if (seat.ticketTypeId && result.created) await incrementSold(seat.ticketTypeId);

        /**
         * One account per attendee, not one per order.
         *
         * This is the multi-seat case the account gap hid: a company invoice is
         * a single order covering four people, and it is those four who each
         * need an identity — the billing contact who paid may not be attending
         * at all and gets nothing here. `provisionPurchaserAccount` is keyed by
         * the attendee's own address and is idempotent per address, so a
         * redelivered `invoice.paid` adopts the four accounts rather than
         * making four more.
         */
        const account = await provisionPurchaserAccount({
          email: result.email,
          name: result.name ?? seat.name,
        });
        if (account.status === 'created') accountsCreated += 1;
        if (account.status === 'failed') accountsFailed += 1;

        if (account.uid && tier) await grantSeatEntitlements(account.uid, tier.entitlements);

        // Each seat is a person who needs their own claim code — the billing
        // contact's copy of the invoice does not get them into the app.
        await sendPurchaseConfirmation({
          to: result.email,
          name: result.name ?? '',
          ticketType: result.ticketType ?? seat.ticketType,
          amountCents,
          currency: invoice.currency ?? 'usd',
          orderUrl: `${origin}/order/${mintOrderToken({ rid: result.registrationId })}`,
          claimCode: result.claimCode,
          registrationId: result.registrationId,
          // Only ever the password this call actually generated. `null` on a
          // redelivery, so a retried webhook does not mail a credential for an
          // account that has since had its password changed.
          temporaryPassword: account.temporaryPassword,
        });
      }

      if (oversold.length > 0) {
        await recordWarning(
          'invoice.oversold',
          { invoiceId: invoice.id ?? '', seats: oversold.map((s) => `${s.email} (${s.reason})`) },
          { path: 'orders', id: invoice.id ?? '' },
        );
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
        accountsCreated,
        accountsFailed,
        // Present only when there is something wrong, so an empty key in the
        // Stripe event log means the capacity check ran and passed rather than
        // that it never ran.
        ...(oversold.length > 0 ? { oversold } : {}),
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

  /**
   * Who else is on this purchase — read **before** fulfilment, not after.
   *
   * A multi-seat cart writes its seat list onto the order document before the
   * buyer is ever sent to Stripe (`apps/web/src/app/tickets/cart-order.ts`),
   * because a Stripe metadata value caps at 500 characters and the invoice path
   * has already proved what a truncated attendee list costs: it parses to
   * nothing and the webhook registers nobody.
   *
   * ⚠️ The ordering is load-bearing. `fulfilPurchase` below writes `items` as a
   * single line describing the buyer, and a Firestore merge replaces an array
   * rather than merging into it — so reading this afterwards would find seats
   * two and three already gone. `restoreCartOrder` puts them back once the
   * registrations exist.
   *
   * Empty for an ordinary single-seat purchase, which is most of them, and the
   * whole of this function's behaviour then is what it always was.
   */
  const cart = await cartLines(session.id);

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
    /**
     * The registration questions, answered on our page before the redirect and
     * held in `pendingAnswers` until now.
     *
     * Claimed and deleted in one step. A webhook replay finds nothing there and
     * passes `undefined`, which leaves the answers already on the registration
     * untouched — the correct outcome, and the reason the merge above is a
     * merge rather than a set.
     */
    answers: await claimAnswers(session.metadata?.answersRef),
    stripeCustomerId: typeof customer === 'string' ? customer : (customer?.id ?? undefined),
    stripePaymentIntentId:
      typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent?.id ?? undefined),
    stripeChargeId: detail.chargeId,
  });

  /**
   * Everything below is after the fact and none of it may throw upward.
   *
   * The counter is advisory (see `incrementSold`), the account is repairable by
   * the OTP flow, and the email is a courtesy; the ticket already exists and is
   * valid. A failure in any of them must not turn into a non-2xx, because
   * Stripe would retry the event and eventually disable the endpoint — losing
   * fulfilment for everyone because one receipt bounced.
   */

  /**
   * What each seat cost, from one figure Stripe reports for the whole payment.
   *
   * Split rather than read off the tier prices, because tax and any promotion
   * code are Stripe's arithmetic and land only on `amount_total`. Three people
   * each get a confirmation naming their own share, and the three add up to the
   * receipt — which is the property `splitAcrossSeats` exists to guarantee.
   */
  const shares = splitAcrossSeats(session.amount_total ?? 0, Math.max(1, cart.length));
  const buyerEmail = normaliseEmail(result.email);

  /**
   * What each seat did to its tier's capacity, gathered and counted once.
   *
   * The rule is `seatsToCount` in `tickets/seats-core.ts`, where it is pure and
   * pinned by `tests/commerce` — three seats must take three off the tier, and
   * a redelivered event must take none. The buyer's tier comes from the
   * session metadata rather than from their cart line, so a single-seat
   * purchase (which has no cart at all) counts exactly as it always did.
   */
  const seatOutcomes: { created: boolean; ticketTypeId?: string }[] = [
    { created: result.created, ticketTypeId: tierId },
  ];

  /**
   * The other seats, each an independent registration keyed on its own address.
   *
   * Idempotent for the same structural reason the buyer's is: `registrationId`
   * is a hash of the email, so a redelivery rewrites the same three documents
   * rather than minting six. That is the whole answer to "what stops a webhook
   * replay issuing six tickets" — there is no counter to guard and no
   * de-duplication table to keep, because the ids are derived from the people.
   */
  const registrationIds = [result.registrationId];
  const entitlementsFor = new Map<string, Awaited<ReturnType<typeof tierFulfilment>>>();
  let seatsRegistered = 0;
  let seatAccountsCreated = 0;
  let seatAccountsFailed = 0;
  let buyerShare = session.amount_total ?? 0;

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
     * One account per attendee, not one per order — the same rule the invoice
     * path follows, and for the same reason. The person who paid may be the
     * only one of the three whose address is on the card; the other two still
     * need an identity to sign in with, and `provisionPurchaserAccount` is
     * keyed by the attendee's own address and idempotent per address.
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
      currency: session.currency ?? 'usd',
      orderUrl: `${origin}/order/${mintOrderToken({ rid: seat.registrationId })}`,
      claimCode: seat.claimCode,
      registrationId: seat.registrationId,
      temporaryPassword: seatAccount.temporaryPassword,
    });
  }

  // Only count a seat the first time. A webhook replay must not sell the same
  // ticket twice against a tier's capacity.
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
   * Swallowed rather than surfaced as a non-2xx, per the rule at the top of
   * this file — the three registrations already exist and are valid, and a
   * retry storm that disables the endpoint would cost everybody's fulfilment to
   * fix one order's bookkeeping. ⚠️ But it is recorded loudly, because a retry
   * cannot repair it: the next delivery reads `items` and finds the clobbered
   * single line, so this is the only chance to write the list down.
   */
  if (cart.length > 1) {
    try {
      await restoreCartOrder({ sessionId: session.id, lines: cart, registrationIds });
    } catch (err) {
      await recordError('order.seats', err, { path: 'orders', id: session.id });
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
    name: result.name ?? session.metadata?.name ?? '',
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
    currency: session.currency ?? 'usd',
    orderUrl: `${origin}/order/${mintOrderToken({ rid: result.registrationId })}`,
    claimCode: result.claimCode,
    registrationId: result.registrationId,
    temporaryPassword: account.temporaryPassword,
  });

  return NextResponse.json({
    received: true,
    eventId: event.id,
    registrationId: result.registrationId,
    created: result.created,
    // `created` / `existing` / `failed`. In the response so a replay is visible
    // from Stripe's own event log: the first delivery says `created`, every
    // later one says `existing`.
    account: account.status,
    /**
     * The seat figures, in the response so a replay is legible from Stripe's
     * own event log without opening Firestore: `seats` is what the payment
     * covered, `seatsRegistered` is the extra attendees this delivery walked,
     * and `seatsCounted` is what actually moved against tier capacity — zero on
     * every delivery after the first, which is what idempotent looks like from
     * the outside.
     */
    seats: cart.length || 1,
    seatsRegistered,
    seatsCounted: [...soldPerTier.values()].reduce((a, b) => a + b, 0),
    ...(seatAccountsCreated > 0 ? { seatAccountsCreated } : {}),
    ...(seatAccountsFailed > 0 ? { seatAccountsFailed } : {}),
  });
}

/**
 * Withdraw the *other* seats on a group purchase that has been refunded or
 * charged back.
 *
 * ── Why this is not simply part of `cancelRegistrationByOrder` ──────────────
 *
 * It should be, and this is the note asking for it. That function lives in
 * `apps/web/src/lib/registrations.ts` and cancels one registration — the one
 * keyed on the order's own email, which is the buyer. Teaching it about
 * `items[].attendeeEmail` is the right fix and a small one; it is here instead
 * because that file is owned elsewhere, and leaving three tickets valid after a
 * full refund was not an acceptable thing to leave for later.
 *
 * ── The rule it copies, and why the copy is deliberate ──────────────────────
 *
 * "Cancel only when no other **paid** order covers this person." A colleague
 * who was seat three on a refunded group purchase *and* separately bought their
 * own ticket keeps the ticket they paid for. This is the same test
 * `cancelRegistrationByOrder` applies to the buyer, filtered in memory rather
 * than with a `status` clause for the same reason it gives: one person has a
 * handful of orders, and a third filter shape is a `failed-precondition`
 * waiting for a missing composite index.
 *
 * The order being refunded cannot appear in that query — it is keyed on the
 * buyer's address, not the seat's — so there is nothing to exclude.
 *
 * Best-effort per seat: a registration that has since been deleted must not
 * stop the other two being withdrawn, and no failure here may reach Stripe as a
 * non-2xx.
 */
async function cancelExtraSeats(
  sessionId: string,
  buyerEmail: string | null,
): Promise<string[]> {
  const cart = await cartLines(sessionId);
  if (cart.length < 2) return [];

  const buyer = buyerEmail ? normaliseEmail(buyerEmail) : '';
  const cancelled: string[] = [];

  for (const line of cart) {
    const seatEmail = normaliseEmail(line.attendeeEmail ?? '');
    if (!seatEmail || seatEmail === buyer) continue;

    try {
      const sameEmail = await db()
        .collection(COLLECTIONS.orders)
        .where('eventId', '==', EVENT_ID)
        .where('email', '==', seatEmail)
        .get();

      const stillPaidElsewhere = sameEmail.docs.some((d) => {
        const o = d.data() as OrderDoc;
        return o.status === 'paid' || o.status === 'partially_refunded';
      });
      if (stillPaidElsewhere) continue;

      const rid = registrationId(seatEmail);
      await db()
        .collection(COLLECTIONS.registrations)
        .doc(rid)
        .update({ status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
      cancelled.push(rid);

      /**
       * The entitlement goes with the ticket. `withdrawOrderEntitlements`
       * removes only `source: 'order'` grants, so a speaker's or a staff
       * member's access survives the refund of something they also sat on.
       */
      await withdrawOrderEntitlements(db(), uidForEmail(seatEmail));
    } catch (err) {
      await recordError('order.seatCancel', err, {
        path: 'registrations',
        id: registrationId(seatEmail),
      });
    }
  }

  return cancelled;
}

/**
 * Grant a seat's entitlements, best-effort.
 *
 * Wrapped rather than called directly at three sites, because the swallow is
 * the point and it must be identical at each: an entitlement that fails to
 * write is a support conversation, and a webhook that 500s over one is a retry
 * storm that eventually disables the endpoint and loses everybody's tickets.
 */
async function grantSeatEntitlements(uid: string, kinds: EntitlementDoc['kind'][]): Promise<void> {
  if (kinds.length === 0) return;
  try {
    await grantOrderEntitlements(db(), uid, kinds);
  } catch (err) {
    await recordError('entitlement.grant', err, { path: 'users', id: uid });
  }
}
