import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import { COLLECTIONS, type EntitlementDoc, type OrderDoc, type RegistrationDoc } from '@kgc/shared';
import { normaliseEmail, registrationId } from '@kgc/scripts/src/lib/ids';
import { currentHolder, stillPaidElsewhere } from '@kgc/scripts/src/lib/fulfilment';
import { cartLines } from '@/app/tickets/cart-order';
import { ticketingInvoice, websiteCheckout } from '@/lib/checkout-source';
import { noteIgnoredStripe } from '@/lib/stripe-ignored';
import { splitAcrossSeats } from '@/app/tickets/seats-core';
import { provisionPurchaserAccount } from '@/lib/app-account';
import {
  grantOrderEntitlements,
  uidForEmail,
  withdrawOrderEntitlements,
} from '@/lib/app-account-core';
import { incrementSold, tierFulfilment } from '@/lib/catalogue';
import {
  sendPurchaseConfirmation,
  sendRefundConfirmation,
  sendTicketWithdrawn,
  type SendOutcome,
} from '@/lib/email';
import { claimConfirmation, confirmationsOutstanding, sendClaimed } from '@/lib/fulfil-order';
import { isOrderSettledError } from '@kgc/scripts/src/lib/fulfilment';
import { countOrderSeatsOnce } from '@kgc/scripts/src/lib/order-claims';
import { recordError, recordWarning } from '@/lib/errors';
import { db } from '@/lib/firestore';
import { fulfilCheckoutSession } from '@/lib/checkout-fulfil';
import { seatsFromInvoice } from '@/lib/invoicing';
import { mintOrderToken } from '@/lib/order-token';
import {
  cancelRegistrationByOrder,
  cancelUnpaidOrder,
  ensureRegistration,
  invoiceOrderId,
  markInvoiceOrderPaid,
  orderIdFor,
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
      // withdraw, but the order should stop saying `pending` for ever. Only a
      // pending order changes; see `cancelUnpaidOrder` for what this used to
      // cancel by mistake.
      const session = event.data.object;
      // A Payment Link or any other session in the shared account expires too.
      // Only ours has an order to close (T142); the rest is not ticketing.
      if (!websiteCheckout(session.metadata)) {
        return NextResponse.json({ received: true, ignored: 'not a ticketing session' });
      }
      const outcome = await cancelUnpaidOrder(session.id);
      return NextResponse.json({
        received: true,
        eventId: event.id,
        orderId: outcome.orderId,
        outcome: outcome.outcome,
      });
    }

    case 'charge.refunded': {
      const charge = event.data.object;
      // The order is keyed by the Checkout session or the invoice, neither of
      // which a charge carries directly; both are reachable through the
      // payment intent.
      const target = await paymentTarget(charge.payment_intent);
      if (!target?.ours) {
        // Not a ticket: a sponsorship, a Payment Link, a manual charge or an
        // invoice raised by hand. Nothing to withdraw, no order invented, no
        // seat moved; noted quietly rather than raised as a warning (T142).
        await noteIgnoredStripe({
          eventType: event.type,
          kind: 'refund',
          stripeId: charge.id,
          amountCents: charge.amount_refunded,
          currency: charge.currency,
          email: charge.billing_details?.email ?? charge.receipt_email ?? undefined,
          name: charge.billing_details?.name ?? undefined,
          description: charge.description ?? target?.externalId ?? paymentIntentId(charge.payment_intent) ?? undefined,
        });
        return NextResponse.json({ received: true, ignored: 'not a ticketing payment' });
      }
      const sessionId = target.externalId;

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
       *
       * `holderEmail`, not `email`: after a transfer the buyer paid and somebody
       * else holds the seat, and it is the holder's access that goes with the
       * ticket. It is the buyer's own address on every order nobody transferred.
       */
      let entitlementsWithdrawn = 0;
      const cancelledEmail = outcome.holderEmail ?? outcome.email;
      if (outcome.newlyRefunded && outcome.registrationId && cancelledEmail) {
        try {
          entitlementsWithdrawn = await withdrawOrderEntitlements(
            db(),
            uidForEmail(cancelledEmail),
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
        ? await cancelExtraSeats(sessionId, outcome.email, outcome.orderId)
        : [];

      /**
       * Who is told what.
       *
       * The buyer always gets the receipt: they paid, and the money is theirs.
       * What it may say about a badge depends on what the refund actually did,
       * which is why both flags are passed rather than assumed — a ticket that
       * a second paid order still covers has not stopped scanning, and after a
       * transfer the badge that stopped is not the buyer's.
       *
       * The holder gets their own mail, and only when there is one: a refund
       * that cancelled a ticket somebody else was holding. They are owed the
       * sentence the buyer's receipt used to carry on their behalf, since the
       * alternative is finding out at the door.
       *
       * Each row in the mail log is stamped with the registration belonging to
       * the person it went to. The buyer's receipt files under the buyer, which
       * is where their purchase confirmation already sits; the holder's under
       * the holder. Stamping both with the cancelled registration filed the
       * buyer's receipt in a stranger's history.
       */
      const buyerRegistrationId = outcome.email ? registrationId(outcome.email) : undefined;
      const transferred = Boolean(outcome.holderEmail && outcome.holderEmail !== outcome.email);

      /**
       * Once each, however many times Stripe delivers this refund (T135B,
       * TK-230). Keyed by the cumulative amount, so a second refund that
       * completes a partial one still gets its receipt, and claimed with the
       * same `confirmations` map as a purchase. Not retried through a 5xx: the
       * refund has already happened and the dashboard can resend.
       */
      const once = async (key: string, to: string, send: () => Promise<SendOutcome>) => {
        const attempt = await claimConfirmation(outcome.orderId, key, { evenIfSettled: true });
        if (attempt === null) return;
        await sendClaimed({ orderId: outcome.orderId, rid: key, attempts: attempt, to }, send);
      };

      if (outcome.fullyRefunded && outcome.email) {
        const to = outcome.email;
        await once(`refund:${outcome.refundedCents}`, to, () =>
          sendRefundConfirmation({
            to,
            name: outcome.name,
            ticketType: outcome.ticketType,
            amountCents: outcome.refundedCents,
            currency: outcome.currency,
            orderId: outcome.orderId,
            registrationId: buyerRegistrationId,
            ticketCancelled: Boolean(outcome.registrationId),
            transferred,
          }),
        );
      }

      if (outcome.fullyRefunded && outcome.registrationId && transferred && outcome.holderEmail) {
        const to = outcome.holderEmail;
        const rid = outcome.registrationId;
        await once(`withdrawn:${rid}`, to, () =>
          sendTicketWithdrawn({
            to,
            name: outcome.holderName,
            ticketType: outcome.ticketType,
            orderId: outcome.orderId,
            registrationId: rid,
          }),
        );
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
      const target = await paymentTarget(dispute.payment_intent);
      if (!target?.ours) {
        await noteIgnoredStripe({
          eventType: event.type,
          kind: 'dispute',
          stripeId: dispute.id,
          amountCents: dispute.amount,
          currency: dispute.currency,
          description: [dispute.reason, target?.externalId].filter(Boolean).join(' · ') || undefined,
        });
        return NextResponse.json({ received: true, ignored: 'not a ticketing payment' });
      }
      const sessionId = target.externalId;
      const outcome = await cancelRegistrationByOrder({
        externalId: sessionId,
        reason: 'disputed',
      });
      // A disputed group purchase is the same problem as a refunded one: the
      // buyer's ticket is withdrawn and their three colleagues' are not.
      const seatsCancelled = outcome.newlyRefunded
        ? await cancelExtraSeats(sessionId, outcome.email, outcome.orderId)
        : [];
      // The seats go back on sale while the tickets are withdrawn, once, for
      // the same reason a refund gives them back (T135, S3).
      const seatsReturned: string[] = [];
      if (outcome.newlyRefunded) {
        for (const line of outcome.lines) {
          await incrementSold(line.ticketTypeId, -line.quantity);
          seatsReturned.push(line.ticketTypeId);
        }
      }
      return NextResponse.json({
        received: true,
        eventId: event.id,
        orderId: outcome.orderId,
        registrationId: outcome.registrationId,
        seatsCancelled,
        seatsReturned,
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
       * Only an invoice ticketing raised. The Stripe account also invoices
       * sponsors and others by hand, and an invoice is ours only if our code
       * marked it (`ticketingInvoice`) or we hold its order record. Metadata
       * that merely looks like an attendee list registers nobody (T142).
       */
      const invoiceOrder = invoice.id
        ? ((await db().collection(COLLECTIONS.orders).doc(invoiceOrderId(invoice.id)).get()).data() as
            | OrderDoc
            | undefined)
        : undefined;
      if (!invoice.id || (!ticketingInvoice(invoice.metadata) && invoiceOrder?.channel !== 'invoice')) {
        if (invoice.id) {
          await noteIgnoredStripe({
            eventType: event.type,
            kind: 'invoice',
            stripeId: invoice.id,
            amountCents: invoice.amount_paid ?? invoice.total ?? 0,
            currency: invoice.currency ?? 'usd',
            email: invoice.customer_email ?? undefined,
            name: invoice.customer_name ?? undefined,
            description: invoice.number ?? invoice.description ?? undefined,
          });
        }
        return NextResponse.json({ received: true, ignored: 'not a ticketing invoice' });
      }

      /**
       * Seats come from our own order record first, Stripe metadata second.
       *
       * Metadata is capped at 500 characters and `raiseInvoice` truncates the
       * attendee JSON to 480, so a large invoice yields a cut-off string that
       * fails to parse — and `seatsFromInvoice` returns an empty list by
       * design, which would register nobody for an invoice that has just been
       * paid. The order document has no such limit. Metadata covers a marked
       * invoice whose order record failed to write when it was raised.
       */
      const listed = invoice.id
        ? await seatsFromOrder(invoice.id).then((rows) =>
            rows.length > 0
              ? rows
              : seatsFromInvoice(invoice).map((r) => ({ ...r, ticketTypeId: '' })),
          )
        : [];

      /**
       * A seat that names no ticket is not registered as anything. It used to
       * become "Main Conference" by default, which is a ticket nobody chose
       * (T135, S11). Organizers are told and register it by hand.
       */
      const untyped = listed.filter((s) => !s.ticketType);
      const seats = listed.filter((s) => s.ticketType);
      if (untyped.length > 0) {
        await recordWarning(
          'invoice.seatWithoutTicket',
          {
            invoiceId: invoice.id ?? '',
            seats: untyped.map((s) => s.email),
            note: 'These seats name no ticket type, so no ticket was issued. Register them by hand.',
          },
          { path: 'orders', id: invoice.id ?? '' },
        );
      }

      if (seats.length === 0) {
        return NextResponse.json({ received: true, skipped: 'no attendee list for invoice' });
      }

      /**
       * A refunded or cancelled invoice issues nothing on a replay, the same
       * rule as a card purchase. Answered 200: there is nothing to retry.
       */
      if (invoiceOrder?.status === 'refunded' || invoiceOrder?.status === 'cancelled') {
        return NextResponse.json({ received: true, eventId: event.id, skipped: `order ${invoiceOrder.status}` });
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

      const oid = invoiceOrderId(invoice.id!);
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

        let result: Awaited<ReturnType<typeof ensureRegistration>>;
        try {
          result = await ensureRegistration({
            email: seat.email,
            name: seat.name,
            ticketType: seat.ticketType,
            // Same numbering as the dashboard's mark-paid, so either path that
            // runs second lands on the same tickets.
            purchase: { orderId: oid, seat: i + 1 },
          });
        } catch (err) {
          // Refunded while this delivery was walking the seats.
          if (isOrderSettledError(err)) {
            return NextResponse.json({ received: true, eventId: event.id, skipped: `order ${err.status}` });
          }
          throw err;
        }
        registered.push(result.registrationId);


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
        // contact's copy of the invoice does not get them into the app. Claimed
        // on the order like a card purchase's, so a redelivered `invoice.paid`
        // does not email every seat again (T135, S10/TK-255).
        const attempt = await claimConfirmation(oid, result.registrationId);
        if (attempt !== null) {
          await sendClaimed({ orderId: oid, rid: result.registrationId, attempts: attempt, to: result.email }, () =>
            sendPurchaseConfirmation({
              to: result.email,
              name: result.name ?? '',
              ticketType: result.ticketType ?? seat.ticketType,
              amountCents,
              currency: invoice.currency ?? 'usd',
              orderUrl: `${origin}/order/${mintOrderToken({ rid: result.registrationId })}`,
              claimCode: result.claimCode,
              orderId: oid,
              registrationId: result.registrationId,
              // Only ever the password this call actually generated. `null` on a
              // redelivery, so a retried webhook does not mail a credential for an
              // account that has since had its password changed.
              temporaryPassword: account.temporaryPassword,
            }),
          );
        }
      }

      /**
       * Capacity, once for the whole invoice. Counting only the seats this
       * delivery created missed every seat the dashboard's mark-paid had
       * already registered, so those were never counted at all (T135B, N2).
       * `countOrderSeatsOnce` is shared with mark-paid and counts the order
       * once, whichever of the two runs first.
       */
      try {
        await countOrderSeatsOnce(db(), oid, seats.map((s) => s.ticketTypeId));
      } catch (err) {
        await recordError('invoice.count', err, { path: 'orders', id: oid });
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

      // As for a card purchase: Stripe comes back until every seat's
      // confirmation has gone out or used up its attempts.
      const outstanding = await confirmationsOutstanding(orderId, registered);
      if (outstanding.length > 0) {
        return NextResponse.json(
          { error: 'confirmation email not sent yet', confirmationsOutstanding: outstanding },
          { status: 503 },
        );
      }

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

function paymentIntentId(pi: string | Stripe.PaymentIntent | null): string | null {
  return (typeof pi === 'string' ? pi : pi?.id) ?? null;
}

/**
 * What a charge paid for, from its payment intent: a Checkout session or an
 * invoice. Orders are keyed by a hash of either id (`orderIdFor`,
 * `invoiceOrderId`), so the id is all a refund needs.
 *
 * An invoice's payment intent has no Checkout session, and until T136 that
 * was the end of the lookup: refunding a paid invoice answered "no checkout
 * session for charge" and left every seat active (T135, S2).
 *
 * `ours` is ticketing's own: a session carrying our marker, or a session or
 * invoice we hold an order for. The order covers sales from before the
 * session marker and every invoice our code raised. Everything else in the
 * shared account (Payment Links, sponsorship invoices, manual charges) is not
 * ours and changes nothing in ticketing (T142).
 */
async function paymentTarget(
  pi: string | Stripe.PaymentIntent | null,
): Promise<{ externalId: string; ours: boolean } | null> {
  const id = paymentIntentId(pi);
  if (!id) return null;
  const hasOrder = async (externalId: string) =>
    (await db().collection(COLLECTIONS.orders).doc(orderIdFor(externalId)).get()).exists;

  const found = await stripe().checkout.sessions.list({ payment_intent: id, limit: 1 });
  const session = found.data[0];
  if (session) {
    return { externalId: session.id, ours: Boolean(websiteCheckout(session.metadata)) || (await hasOrder(session.id)) };
  }

  const paid = await stripe().invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: id }, limit: 1 });
  const invoice = paid.data[0]?.invoice;
  const invoiceId = typeof invoice === 'string' ? invoice : invoice?.id;
  return invoiceId ? { externalId: invoiceId, ours: await hasOrder(invoiceId) } : null;
}

/**
 * Turn a paid Checkout session into a registration.
 *
 * The checks that decide *whether* to fulfil are here; the fulfilment itself
 * is `fulfilCheckoutSession`, which `/checkout/return` runs too, so whichever
 * of the two arrives first does the whole job and the other finds it done.
 * Everything that writes to Firestore, provisions an account or sends a
 * receipt is behind that, in `lib/fulfil-order.ts`.
 */
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

  /**
   * Only a session the tickets page created becomes a ticket.
   *
   * Everything else paid in this Stripe account (a Payment Link, a session made
   * in the Stripe dashboard, another integration) used to be fulfilled as a
   * Main Conference ticket, because a missing `ticketType` fell back to that
   * name. The owner's rule is that a ticket comes only from buying it on the
   * website. So a foreign session is acknowledged with a 200, which stops
   * Stripe retrying, and creates nothing: no order, registration, account,
   * directory entry or email. The KGC Stripe account takes sponsorships and
   * other payments as a matter of course, so this is not an alarm: it is noted
   * in `stripeIgnored`, which Transaction History lists as "Stripe payments not
   * from ticketing (ignored)", with the amount, payer and Stripe id, so a
   * ticket somebody bought the wrong way can still be spotted (T142).
   */
  const ours = websiteCheckout(session.metadata);
  if (!ours) {
    // Not a ticket. Noted quietly, not as a warning: the account takes
    // sponsorships and other payments as a matter of course (T142).
    await noteIgnoredStripe({
      eventType: event.type,
      kind: 'payment',
      stripeId: session.id,
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? 'usd',
      email,
      name: session.customer_details?.name ?? undefined,
      description:
        typeof session.payment_link === 'string' ? session.payment_link : (session.payment_link?.id ?? undefined),
    });
    return NextResponse.json({ received: true, skipped: 'not a website checkout session' });
  }

  const outcome = await fulfilCheckoutSession({ session, ours, email, origin });

  // Refunded or cancelled before this delivery: acknowledged, nothing issued.
  if (outcome.settled) {
    return NextResponse.json({ received: true, eventId: event.id, skipped: `order ${outcome.settled}` });
  }

  /**
   * Somebody's confirmation has not gone out yet, so ask Stripe to come back.
   *
   * The ticket exists either way. What is missing is the email carrying its
   * link and claim code, which for seats two and up is the only one they get.
   * It may have failed in this run, or be in flight in the return redirect
   * running alongside, which cannot be retried itself; in both cases Stripe's
   * redelivery, minutes later, finds it failed (and sends it) or sent (and
   * answers 200). Bounded by `CONFIRMATION_ATTEMPTS`, so a bad address does
   * not fail the endpoint for days.
   */
  if (outcome.confirmationsOutstanding.length > 0) {
    return NextResponse.json(
      {
        error: 'confirmation email not sent yet',
        registrationId: outcome.registrationId,
        confirmationsOutstanding: outcome.confirmationsOutstanding,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    received: true,
    eventId: event.id,
    registrationId: outcome.registrationId,
    created: outcome.created,
    // `created` / `existing` / `failed`. In the response so a replay is visible
    // from Stripe's own event log: the first delivery says `created`, every
    // later one says `existing`.
    account: outcome.account,
    /**
     * The seat figures, in the response so a replay is legible from Stripe's
     * own event log without opening Firestore: `seats` is what the payment
     * covered, `seatsRegistered` is the extra attendees this delivery walked,
     * and `seatsCounted` is what actually moved against tier capacity — zero on
     * every delivery after the first, which is what idempotent looks like from
     * the outside.
     */
    seats: outcome.seats,
    seatsRegistered: outcome.seatsRegistered,
    seatsCounted: outcome.seatsCounted,
    ...(outcome.seatAccountsCreated > 0
      ? { seatAccountsCreated: outcome.seatAccountsCreated }
      : {}),
    ...(outcome.seatAccountsFailed > 0 ? { seatAccountsFailed: outcome.seatAccountsFailed } : {}),
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
 * ── The rule it applies ─────────────────────────────────────────────────────
 *
 * "Cancel only when no other **paid** order covers this person." A colleague
 * who was seat three on a refunded group purchase *and* separately bought their
 * own ticket keeps the ticket they paid for. It is the same test
 * `cancelRegistrationByOrder` applies to the buyer, and it is now the same
 * code: `stillPaidElsewhere` in `@kgc/scripts`, asked about the seat's own
 * address and the address of whoever holds it now, with the order being
 * refunded left out.
 *
 * Leaving that order out is not decoration. A seat handed back to the buyer's
 * own address resolves to a registration the buyer's orders cover, and this
 * order is one of them — so it can appear in the result set. It does not today
 * only because `cancelRegistrationByOrder` has already stamped it `refunded`
 * before this runs, which is an ordering accident rather than a guarantee.
 *
 * Best-effort per seat: a registration that has since been deleted must not
 * stop the other two being withdrawn, and no failure here may reach Stripe as a
 * non-2xx.
 */
async function cancelExtraSeats(
  sessionId: string,
  buyerEmail: string | null,
  refundedOrderId: string,
): Promise<string[]> {
  /**
   * The seats this order paid for, from the order's own list, which names each
   * ticket exactly. Since 2026-09-26 one address can hold several tickets, so
   * deriving a seat's ticket from its address could cancel the wrong one.
   * Index 0 is the buyer's, already handled by `cancelRegistrationByOrder`.
   * An order written before the list existed falls back to the cart.
   */
  const orderSnap = await db().collection(COLLECTIONS.orders).doc(refundedOrderId).get();
  const listed = ((orderSnap.data() as OrderDoc | undefined)?.registrationIds ?? []).slice(1);
  let starts = listed;
  if (starts.length === 0) {
    const cart = await cartLines(sessionId);
    if (cart.length < 2) return [];
    const buyer = buyerEmail ? normaliseEmail(buyerEmail) : '';
    starts = cart
      .map((line) => normaliseEmail(line.attendeeEmail ?? ''))
      .filter((e) => e && e !== buyer)
      .map((e) => registrationId(e));
  }

  const cancelled: string[] = [];

  for (const startId of starts) {
    try {
      /**
       * A seat can have been handed on since it was bought, and then the seat's
       * own ticket is already dead while the seat belongs to somebody else.
       * Follow it, for the same reason the buyer's seat is followed in
       * `cancelRegistrationByOrder`.
       */
      const seatEmail = ((await db().collection(COLLECTIONS.registrations).doc(startId).get()).data() as
        | RegistrationDoc
        | undefined)?.email;
      const holder = await currentHolder(db(), startId);
      if (!holder) continue;

      if (await stillPaidElsewhere(db(), [seatEmail, holder.email], refundedOrderId, [startId, holder.id])) {
        continue;
      }

      const rid = holder.id;
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
      await withdrawOrderEntitlements(db(), uidForEmail(holder.email));
    } catch (err) {
      await recordError('order.seatCancel', err, { path: 'registrations', id: startId });
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
