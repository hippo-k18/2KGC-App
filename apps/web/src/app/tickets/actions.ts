'use server';

import { randomUUID } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { demoCheckoutAllowed } from '@/lib/demo-checkout';
import { fulfilOrder } from '@/lib/fulfil-order';
import { mintOrderToken } from '@/lib/order-token';
import { siteOrigin, stripe, stripeEnabled } from '@/lib/stripe';
import { tierById, tierFulfilment } from '@/lib/catalogue';
import { ATTRIBUTION_COOKIE, validCode } from '@/lib/campaign-links';
import { activeForm, stashAnswers } from '@/lib/question-forms';
import { validateAnswers, type AnswerValue } from '@kgc/scripts/src/lib/question-forms';
import type { Tier } from '@/lib/tickets';
import { recordCartOrder, type CartSeat } from './cart-order';
import {
  MAX_SEATS,
  collectSeats,
  groupSeatsIntoLines,
  seatsPerTier,
  validateSeats,
  type SeatInput,
} from './seats-core';

/**
 * Starting a purchase.
 *
 * Everything that decides what is charged happens here, on the server. The
 * form posts a *tier id*, never a price — a price in a form field is a price
 * the buyer can edit, and the classic version of this bug charges $1 for a
 * $1,199 ticket. `tierById` is the only thing that turns an id into money.
 *
 * ── There is exactly one way out of this function with a ticket ─────────────
 *
 * Stripe. There used to be a second: with no `STRIPE_SECRET_KEY` the site wrote
 * the registration itself and, under `DEMO_MODE=1`, stamped the order `paid`.
 * That branch is gone. A deployment with no payment processor now refuses to
 * sell rather than handing out free tickets — the argument the deleted
 * `lib/demo.ts` made for itself and then did not follow.
 *
 * The refusal names the variable, because the only person who can ever see this
 * error is the one who can fix it: an unconfigured site has no customers yet.
 *
 * ── More than one seat ──────────────────────────────────────────────────────
 *
 * This built one line item with `quantity: 1` and nothing else, which meant
 * three colleagues on one card were three separate purchases and an extra pass
 * alongside a booth was a fourth. Both are now one session: seats are collected
 * on the form, grouped by tier, and each group becomes a Stripe line item with
 * a **real quantity**, so Stripe does the arithmetic and the receipt says
 * "Main Conference × 3".
 *
 * The constraint that shapes it is not Stripe's, it is ours: a registration is
 * keyed by email address, so three seats need three addresses. `seats-core.ts`
 * holds that rule and the checks around it; `cart-order.ts` explains why the
 * seat list is written to Firestore before the redirect rather than carried in
 * Stripe metadata.
 */

export interface CheckoutState {
  error?: string;
  /**
   * Per-question problems, keyed by field id, so each renders beside its own
   * input rather than as one sentence at the top listing four things.
   */
  fieldErrors?: Record<string, string>;
}

/**
 * Everything both buy buttons have to agree about, in one place.
 *
 * There are two ways off this form: Stripe, and the localhost-only rehearsal
 * button that skips it. They must apply *identical* rules — the same price
 * lookup, the same seat validation, the same capacity check, the same
 * questions — or the rehearsal stops rehearsing anything. The moment the demo
 * path has its own shortened validation is the moment it starts succeeding on
 * inputs the real one rejects, which is the one thing a demo must never do.
 *
 * So this function is the whole of the decision, and each caller does nothing
 * afterwards but arrange payment (or, for the demo, decline to).
 *
 * ⚠️ It is not a pure function: it stashes the buyer's answers as its last act,
 * so it must not be called speculatively. Both callers do their own fail-closed
 * check *before* reaching it, for the reason `startCheckout` gives — a
 * misconfigured deployment must not leave a trail of `pendingAnswers` documents
 * belonging to purchases that were never possible.
 */
/**
 * Either a `CheckoutState` to hand straight back to the form, or the settled
 * facts of a purchase. The failure arm is the form state itself rather than a
 * wrapper, so every refusal below reads exactly as it did when this code was
 * inline — `return { error: … }` — and the callers narrow on `'ok' in`.
 */
type Prepared =
  | CheckoutState
  | {
      ok: true;
      name: string;
      email: string;
      seats: SeatInput[];
      /** Every tier the seats name, read once each from Firestore. */
      tiers: Map<string, Tier | undefined>;
      /** The buyer's own tier — the one the order and the receipt are named for. */
      primary: Tier;
      answersRef?: string;
      campaignCode?: string;
      origin: string;
    };

async function prepareCheckout(form: FormData): Promise<Prepared> {
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const tierId = String(form.get('tier') ?? '');
  /**
   * Seat one is the buyer, the rest are the extra attendees.
   *
   * Deliberately the same three parallel arrays the invoice form posts —
   * `seatName`, `seatEmail`, `seatTier` — rather than a second encoding. One
   * shape means one parser, one set of rules and one place where "two seats on
   * one address is one badge" is enforced; the alternative is two forms that
   * agree until somebody changes one of them.
   *
   * The buyer is prepended rather than being row one of the same list because
   * their name and address are the fields that were already on this form, and
   * moving them into the seat list would have renamed the inputs that every
   * other part of this action, the questions and the Stripe customer record all
   * read.
   */
  const extraNames = form.getAll('seatName').map((v) => String(v));
  const extraEmails = form.getAll('seatEmail').map((v) => String(v));
  const extraTiers = form.getAll('seatTier').map((v) => String(v));

  const seats: SeatInput[] = [
    { name, email, tierId },
    ...collectSeats(
      extraNames.map((n, i) => ({
        name: n,
        email: extraEmails[i] ?? '',
        // An extra seat with no tier of its own takes the buyer's, which is
        // what the form defaults it to and what "three of these, please" means.
        tierId: extraTiers[i] || tierId,
      })),
    ),
  ];

  /**
   * The price comes from Firestore, keyed by the ids the form posted — never
   * from the form itself. A price in a form field is a price the buyer can
   * edit, and the classic version of that bug charges $1 for a $1,199 ticket.
   *
   * Read once per distinct tier and memoised, because a three-seat purchase on
   * one tier should be one read rather than three, and because two seats on the
   * same tier must be priced from the same document even if an organizer edits
   * it mid-request.
   */
  const tiers = new Map<string, Tier | undefined>();
  for (const seat of seats) {
    if (!tiers.has(seat.tierId)) tiers.set(seat.tierId, await tierById(seat.tierId));
  }

  const primary = tiers.get(tierId);
  if (!primary) return { error: 'Choose a ticket type.' };

  /**
   * Shape first, money second.
   *
   * A blank name on seat three is a cheaper thing to discover than a sold-out
   * tier, and running the checks in this order means the buyer never gets
   * "sold out" for a form they were going to have to fix anyway.
   */
  const problem = validateSeats(seats);
  if (problem) {
    /**
     * Seat one is the buyer's own name and email fields, which are not numbered
     * on screen, so numbering them in the error would point at nothing. Every
     * other seat is a labelled "Attendee N" card and is named as such.
     */
    const who = problem.index === 0 ? '' : `Attendee ${problem.index + 1}: `;
    switch (problem.kind) {
      case 'empty':
        return { error: 'Enter the attendee’s full name.' };
      case 'too-many':
        return {
          error:
            `This form handles up to ${MAX_SEATS} attendees on one card. ` +
            'For a larger group, request an invoice instead.',
        };
      case 'name':
        return {
          error: who ? `${who}enter a full name.` : 'Enter the attendee’s full name.',
        };
      case 'email':
        return {
          error: who ? `${who}enter a valid email address.` : 'Enter a valid email address.',
        };
      case 'duplicate':
        return {
          error:
            `${problem.email} appears twice. Each attendee needs their own address.`,
        };
    }
  }

  /**
   * Re-check availability here, not only in the UI.
   *
   * The tickets page disables a sold-out option, but the form posts a tier id
   * and anything that can POST can post a closed one. This is the check that
   * counts; the disabled option is a courtesy.
   */
  for (const seat of seats) {
    const tier = tiers.get(seat.tierId);
    if (!tier) return { error: 'Choose a ticket type for every attendee.' };
    if (!tier.onSale) {
      return { error: `${tier.name} is not available (${(tier.unavailableReason ?? 'sales closed').toLowerCase()}).` };
    }
    /**
     * Stripe will not accept a session mixing currencies, and finding that out
     * from Stripe's own error is a worse message than finding it out here. The
     * invoice form makes the same check for the same reason.
     */
    if (tier.currency !== primary.currency) {
      return { error: 'All attendees on one purchase must use the same currency.' };
    }
  }

  /**
   * Capacity, asked as "are there N seats left" rather than "is it on sale".
   *
   * ⚠️ Still a **counter, not a reservation** — nothing here holds a seat
   * across the Checkout redirect, and two buyers can both pass this check and
   * both pay. `TicketTypeDoc.quantitySold` says so at length and building a
   * reservation is deliberately out of scope. What this closes is narrower and
   * entirely real: `onSale` answers "is there at least one seat", which was the
   * only question a single-seat purchase could ask, so a three-seat purchase
   * against a tier with one seat left used to sail through and oversell by two.
   *
   * Refusing rather than flagging, because no money has moved yet. That is the
   * opposite of the choice `invoice.paid` makes, and for the opposite reason:
   * there the money has arrived and refusing to register somebody who has paid
   * would be the worse failure.
   */
  for (const [seatTierId, wanted] of seatsPerTier(seats)) {
    const fulfilment = await tierFulfilment(seatTierId);
    if (fulfilment?.remaining !== undefined && fulfilment.remaining < wanted) {
      const left = fulfilment.remaining;
      return {
        error:
          `${fulfilment.name} has ${left === 0 ? 'no seats' : left === 1 ? 'only 1 seat' : `only ${left} seats`} ` +
          `left, and you asked for ${wanted}. Nothing was charged.`,
      };
    }
  }

  /**
   * The organizer's registration questions.
   *
   * Validated here rather than trusting the browser — `required` on an input is
   * a courtesy, and anything that can POST can post without it. The shared
   * validator in `@kgc/scripts` is the same code the organizer's editor checks
   * against, so a question the dashboard accepts cannot be one this rejects.
   *
   * Fields the chosen tier does not ask are *dropped*, not rejected: a buyer who
   * filled the form and then changed tier has done nothing wrong.
   *
   * ⚠️ Asked once, of the buyer, and stored on the buyer's registration —
   * **not per seat.** A dietary requirement belongs to a person, and this form
   * has no way to ask three people three sets of questions; the extra seats'
   * answers are collected by the organizer afterwards. Widening the form to ask
   * them here is a real improvement and a separate one.
   */
  const { fields } = await activeForm(primary.audience);
  const posted: Record<string, AnswerValue | undefined> = {};
  for (const f of fields) {
    const values = form.getAll(`q_${f.id}`).map((v) => String(v));
    if (values.length === 0) continue;
    posted[f.id] = f.kind === 'multi-choice' ? values : values[0];
  }

  const checked = validateAnswers(fields, primary.id, posted);
  if (!checked.ok) {
    return {
      error: 'Some of the registration questions need an answer.',
      fieldErrors: checked.errors,
    };
  }

  /**
   * Stashed before the redirect, because the registration these belong to does
   * not exist yet — it is created by the webhook, seconds or retries later.
   * Returns undefined when there is nothing to store or the write failed; a
   * failure to record a dietary preference must never stop a ticket being sold.
   */
  const answersRef = await stashAnswers({
    answers: checked.answers,
    email,
    ticketTypeId: primary.id,
  });

  const h = await headers();
  const origin = siteOrigin(h.get('host'), h.get('x-forwarded-proto'));

  /**
   * Which tracked link, if any, this buyer arrived through.
   *
   * Set by `/r/{code}` up to thirty days ago and read here rather than passed
   * through the form, because a form field is a field the buyer can edit and
   * attribution that a visitor can forge is attribution that decides a referral
   * contest incorrectly.
   *
   * Re-validated even though the redirect route wrote it: a cookie is client
   * storage, so its contents arrive from the browser and are not trustworthy
   * merely because we put them there. An unparseable value is dropped rather
   * than carried into Stripe metadata.
   */
  const ref = (await cookies()).get(ATTRIBUTION_COOKIE)?.value ?? '';
  const campaignCode = validCode(ref) ? ref : undefined;

  return { ok: true, name, email, seats, tiers, primary, answersRef, campaignCode, origin };
}

export async function startCheckout(
  _prev: CheckoutState,
  form: FormData,
): Promise<CheckoutState> {

  /**
   * Fail closed, before anything is written or stashed.
   *
   * First, so that a misconfigured deployment cannot leave a trail of
   * `pendingAnswers` documents belonging to purchases that were never possible.
   * The message names the variable rather than saying "temporarily unavailable"
   * — that phrasing has cost this project a day before, and the audience for
   * this string is whoever deployed the site.
   */
  if (!stripeEnabled()) {
    console.error('[checkout] refused: STRIPE_SECRET_KEY is not set, so no payment can be taken');
    return {
      error: 'Ticket sales are not open yet. Nothing was charged.',
    };
  }

  const prepared = await prepareCheckout(form);
  if (!('ok' in prepared)) return prepared;
  const { name, email, seats, tiers, primary, answersRef, campaignCode, origin } = prepared;

  // ---------------------------------------------------------------------
  // Hosted Stripe Checkout. The buyer leaves this origin entirely, so no card
  // data touches our server or our DOM — that is the reason for Checkout over
  // Elements, and it is what keeps this site in PCI SAQ A.
  // ---------------------------------------------------------------------

  /**
   * One line item per tier, with the number of seats on it as the quantity.
   *
   * This is the whole of the multi-quantity change as far as Stripe is
   * concerned. Three seats on one tier are `quantity: 3` on one line rather
   * than three lines or three sessions, so Stripe multiplies, Stripe applies
   * tax, Stripe applies the promotion code, and the receipt reads the way a
   * receipt for three tickets should. `amount_total` on the session is then the
   * figure the order records — we never recompute it.
   */
  const lines = groupSeatsIntoLines(seats);

  let sessionId: string;
  let url: string | null;
  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: lines.map((line) => {
        // Non-null: every tier id in `lines` came from `seats`, and the loop
        // above returned an error for any seat whose tier failed to load.
        const tier = tiers.get(line.tierId)!;
        return {
          quantity: line.quantity,
          price_data: {
            currency: tier.currency,
            unit_amount: tier.priceCents,
            product_data: {
              name: `KGC 2027: ${tier.name}`,
              description: tier.tagline,
              /**
               * `txcd_20030000` is Stripe's "General - Services" code, which is
               * what their own ticketing guide specifies for admission.
               *
               * The subtlety worth knowing: an event ticket is taxed where the
               * *event happens*, not where the buyer lives — unlike almost
               * everything else Stripe Tax handles. KGC is at Cornell Tech on
               * Roosevelt Island, so the relevant jurisdiction is New York, and
               * a buyer in Berlin owes New York's treatment rather than German
               * VAT. That is configured on the Stripe side by setting the
               * event's location; getting it wrong is a filing problem, not a
               * display bug.
               */
              tax_code: tier.taxCode,
            },
          },
        };
      }),

      /**
       * Let Stripe compute tax rather than us.
       *
       * `automatic_tax` is inert until tax is registered and enabled in the
       * Stripe dashboard, so turning it on here is safe before that happens and
       * removes a code change from the day it does. Nexus monitoring — being
       * told when ticket sales cross a state's registration threshold — is the
       * part that is genuinely hard to do by hand.
       */
      automatic_tax: { enabled: true },

      /**
       * Discount codes, which a conference always ends up needing: speakers,
       * sponsors' allocations, early-bird, academic rates. Stripe owns the
       * codes and their limits, so there is no coupon table here to keep in
       * step with theirs.
       */
      allow_promotion_codes: true,

      /**
       * A billing address is not vanity — it is what `automatic_tax` needs to
       * reason about the buyer, and what a company needs on an invoice.
       */
      billing_address_collection: 'required',
      /**
       * Carried through to the webhook, which has no other way to learn the
       * attendee's name or which tier was bought — the buyer left this origin
       * and the session is all that comes back.
       *
       * `campaignCode` is only added when there is one. Stripe rejects an
       * `undefined` metadata value, and writing an empty string instead would
       * put `campaignCode: ''` on every unattributed order, which reads as "no
       * campaign" in a way that is indistinguishable from "field not set" only
       * until somebody filters on it.
       *
       * ⚠️ `seats` is a **count, not the seat list**. The list lives in the
       * order document, for the reason `cart-order.ts` sets out at length: a
       * metadata value is capped at 500 characters, and the invoice path has
       * already proved what happens when an attendee list is truncated to fit
       * — it parses to nothing and the webhook registers nobody. This number is
       * a cross-check the webhook can log against what it actually found.
       */
      metadata: {
        tier: primary.id,
        ticketType: primary.name,
        name,
        seats: String(seats.length),
        ...(campaignCode ? { campaignCode } : {}),
        // A reference, not the answers themselves: metadata caps at 500
        // characters per value, and a long-text answer would silently truncate.
        ...(answersRef ? { answersRef } : {}),
      },
      success_url: `${origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      // Back to the checkout page with the tier intact, not to `/tickets`,
      // which no longer has a form on it — returning there would throw away
      // everything the buyer typed and show them a price list instead.
      cancel_url: `${origin}/tickets/checkout?tier=${encodeURIComponent(primary.id)}&cancelled=1`,
    });
    sessionId = session.id;
    url = session.url;
  } catch (err) {
    // A bad key, a Stripe outage or a rate limit. The buyer gets a sentence
    // they can act on rather than a 500 page; the detail goes to the server
    // log, because a Stripe error message can name the account.
    console.error('[checkout] Stripe session creation failed', err);
    return { error: 'We could not reach the payment processor. Nothing was charged. Please try again.' };
  }

  if (!url) return { error: 'Stripe did not return a checkout URL. Try again.' };

  /**
   * Write down who the other seats are, before sending anybody to pay.
   *
   * ⚠️ **The one write on this path that refuses rather than degrades.**
   * Everything in the webhook is best-effort because the ticket already exists
   * by the time it runs; this runs before any money moves and it is the only
   * record of seats two and three. Losing it means the buyer pays for three
   * people and one of them gets a ticket — silently, discovered at the door.
   *
   * So a failure here returns an error and does **not** redirect. The Stripe
   * session that was just created is simply never visited and expires on its
   * own; an abandoned session costs nothing and charges nobody.
   *
   * Single-seat purchases skip this entirely and behave exactly as before: the
   * seat list is the reason for the document, and one seat is fully recoverable
   * from the session's own `customer_details`.
   */
  if (seats.length > 1) {
    const cartSeats: CartSeat[] = seats.map((seat) => {
      const tier = tiers.get(seat.tierId)!;
      return {
        name: seat.name,
        email: seat.email,
        ticketType: tier.name,
        ticketTypeId: tier.id,
        priceCents: tier.priceCents,
      };
    });

    try {
      await recordCartOrder({
        sessionId,
        buyerEmail: email,
        buyerName: name,
        seats: cartSeats,
        currency: primary.currency,
        campaignCode,
      });
    } catch (err) {
      console.error('[checkout] could not record the seat list for', sessionId, err);
      return {
        error:
          'We could not save the attendee list, so we have not taken you to payment. ' +
          'Nothing was charged. Please try again.',
      };
    }
  }

  // Outside the try: `redirect` signals by throwing, and catching it here
  // would turn every successful checkout into the error branch above.
  redirect(url);
}

/**
 * The rehearsal button: a real ticket, with the payment step skipped.
 *
 * ── Why this exists, given that the same branch was deliberately deleted ────
 *
 * `lib/stripe.ts` records removing exactly this — a path that completed a
 * registration with no payment processor, gated behind `DEMO_MODE=1` — and the
 * argument was right: a reachable deployment that hands out free tickets hands
 * out free tickets. What brought it back is narrower. A Stripe **test card**
 * only exercises half the system, because the half that matters most for a demo
 * lives in the webhook: the confirmation email, the Firebase Auth account and
 * its `registered` claim, the entitlements, and `quantitySold` moving. With no
 * `stripe listen` forwarding to a laptop, none of that happens, and the demo
 * ends on a ticket that cannot sign into the app.
 *
 * ── What makes it safe is not a flag ────────────────────────────────────────
 *
 * `demoCheckoutAllowed()` is `NODE_ENV !== 'production'` **and** a localhost
 * host, and the first half is fixed at build time — so on the Netlify sites
 * this function's body is unreachable code and no environment variable anybody
 * sets can wake it. That is deliberately not the `DEMO_MODE` design: a variable
 * is a thing that can be set on the wrong deployment by accident.
 *
 * ── Why it validates through `prepareCheckout` ──────────────────────────────
 *
 * Because a demo that accepts input the real checkout rejects is worse than no
 * demo. Same price lookup from Firestore by tier id, same seat rules, same
 * sold-out and capacity checks, same registration questions. The *only* thing
 * this skips is Stripe.
 *
 * ── And why the order says `demo` ───────────────────────────────────────────
 *
 * `channel: 'demo'` is what `scripts/ops/reset-demo-sales.mjs` scopes to, so a
 * rehearsal is one command to undo and cannot take a real order with it. A
 * demo purchase that looked like a real one would silently pollute the revenue
 * figures on the organizer dashboard with no way to tell the two apart.
 */
export async function completeDemoCheckout(
  _prev: CheckoutState,
  form: FormData,
): Promise<CheckoutState> {
  /**
   * Fail closed first, before `prepareCheckout` stashes anything — the same
   * ordering, and for the same reason, as the `stripeEnabled()` refusal above.
   */
  if (!(await demoCheckoutAllowed())) {
    return {
      error:
        'The demo checkout is only available on localhost. Nothing was charged and no ' +
        'registration was created.',
    };
  }

  const prepared = await prepareCheckout(form);
  if (!('ok' in prepared)) return prepared;
  const { name, email, seats, tiers, primary, answersRef, campaignCode, origin } = prepared;

  /**
   * A synthetic id where a Stripe Checkout Session id would be.
   *
   * Everything downstream treats this as the purchase's identity: the order id
   * is a hash of it, and `cartLines` finds the seat list by it. Random rather
   * than derived from the buyer, so two rehearsals with the same email address
   * are two orders — which is what a second run of the demo should look like on
   * the orders screen. The `demo_` prefix makes one obvious in Firestore.
   */
  const externalId = `demo_${randomUUID().replace(/-/g, '')}`;

  /**
   * The total, added up here rather than taken from a payment processor.
   *
   * This is the one figure the demo has to compute for itself, and it is the
   * sum of the same `priceCents` values `startCheckout` puts on the Stripe line
   * items. No tax and no discount: Stripe Tax is what produces those, and
   * inventing a plausible tax line would put a number on the dashboard that
   * nothing could reconcile.
   */
  const amountCents = seats.reduce(
    (sum, seat) => sum + (tiers.get(seat.tierId)?.priceCents ?? 0),
    0,
  );

  /**
   * The seat list, written before fulfilment for the same reason the Stripe
   * path writes it before the redirect: `fulfilOrder` reads it back to register
   * seats two and three, and `fulfilPurchase` clobbers `items` on the way past.
   *
   * Refuses rather than degrades, exactly as the real path does — a rehearsal
   * that silently registered one of three attendees would demo a bug.
   */
  if (seats.length > 1) {
    const cartSeats: CartSeat[] = seats.map((seat) => {
      const tier = tiers.get(seat.tierId)!;
      return {
        name: seat.name,
        email: seat.email,
        ticketType: tier.name,
        ticketTypeId: tier.id,
        priceCents: tier.priceCents,
      };
    });

    try {
      await recordCartOrder({
        sessionId: externalId,
        buyerEmail: email,
        buyerName: name,
        seats: cartSeats,
        currency: primary.currency,
        campaignCode,
        channel: 'demo',
      });
    } catch (err) {
      console.error('[demo-checkout] could not record the seat list for', externalId, err);
      return { error: 'We could not save the attendee list, so nothing was registered.' };
    }
  }

  /**
   * The same fulfilment the webhook runs — registration, order, account,
   * entitlements, sold counter, receipt. Not a reduced copy of it: running the
   * real one is the entire point.
   */
  let registrationId: string;
  try {
    const outcome = await fulfilOrder({
      externalId,
      email,
      name,
      buyerName: name,
      ticketType: primary.name,
      tierId: primary.id,
      amountCents,
      currency: primary.currency,
      subtotalCents: amountCents,
      taxCents: 0,
      discountCents: 0,
      campaignCode,
      answersRef,
      channel: 'demo',
      origin,
    });
    registrationId = outcome.registrationId;
    console.info('[demo-checkout] fulfilled', externalId, outcome);
  } catch (err) {
    // Unlike the webhook, there is a person waiting on this one, so the failure
    // is worth showing them rather than only logging it.
    console.error('[demo-checkout] fulfilment failed for', externalId, err);
    return { error: 'The demo purchase could not be completed. See the server log.' };
  }

  // Outside the try: `redirect` signals by throwing, and catching it here would
  // turn every successful demo purchase into the error branch above.
  redirect(`/order/${mintOrderToken({ rid: registrationId })}`);
}
