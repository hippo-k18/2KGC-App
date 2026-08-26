'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { mintOrderToken } from '@/lib/order-token';
import { fulfilPurchase } from '@/lib/registrations';
import { siteOrigin, stripe, stripeEnabled } from '@/lib/stripe';
import { incrementSold, tierById } from '@/lib/catalogue';
import { ATTRIBUTION_COOKIE, validCode } from '@/lib/campaign-links';
import { sendPurchaseConfirmation } from '@/lib/email';

/**
 * Starting a purchase.
 *
 * Everything that decides what is charged happens here, on the server. The
 * form posts a *tier id*, never a price — a price in a form field is a price
 * the buyer can edit, and the classic version of this bug charges $1 for a
 * $1,199 ticket. `tierById` is the only thing that turns an id into money.
 */

export interface CheckoutState {
  error?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function startCheckout(
  _prev: CheckoutState,
  form: FormData,
): Promise<CheckoutState> {
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const tierId = String(form.get('tier') ?? '');

  /**
   * The price comes from Firestore, keyed by the id the form posted — never
   * from the form itself. A price in a form field is a price the buyer can
   * edit, and the classic version of that bug charges $1 for a $1,199 ticket.
   */
  const tier = await tierById(tierId);
  if (!tier) return { error: 'Choose a ticket type.' };

  /**
   * Re-check availability here, not only in the UI.
   *
   * The tickets page disables a sold-out option, but the form posts a tier id
   * and anything that can POST can post a closed one. This is the check that
   * counts; the disabled option is a courtesy.
   */
  if (!tier.onSale) {
    return { error: `${tier.name} is not available — ${(tier.unavailableReason ?? 'sales closed').toLowerCase()}.` };
  }

  if (name.length < 2) return { error: 'Enter the attendee’s full name.' };
  if (!EMAIL.test(email)) return { error: 'Enter a valid email address.' };

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

  // ---------------------------------------------------------------------
  // No Stripe account configured: complete the purchase as a clearly
  // labelled test, taking no money. The registration written is byte-for-byte
  // the one a real payment would write, because that data path is the whole
  // point of the demo — but the order is recorded as `pending`, not `paid`,
  // and the confirmation page says in as many words that nothing was charged.
  // ---------------------------------------------------------------------
  if (!stripeEnabled()) {
    const result = await fulfilPurchase({
      email,
      name,
      ticketType: tier.name,
      // Derived from the registration id so a repeated test purchase updates
      // the same order document instead of stacking up new ones.
      externalId: `demo_${tierId}_${email.toLowerCase()}`,
      amountCents: tier.priceCents,
      currency: tier.currency,
      paid: false,
      // `channel: 'demo'` is the field that makes a test purchase impossible to
      // mistake for a real one in an export. `status: 'pending'` alone says the
      // money has not arrived; it does not say no money was ever asked for.
      channel: 'demo',
      tierId: tier.id,
      campaignCode,
    });

    /**
     * The demo path has to do the webhook's other two jobs itself.
     *
     * With Stripe configured, `incrementSold` and the confirmation email both
     * happen in `api/stripe/webhook` — which never runs here, because there is
     * no Stripe to call it. Leaving them out made the demo quietly incomplete
     * in two ways that only showed up when somebody looked: a tier could never
     * appear to sell out, and "buy a ticket, get an email" did not work even
     * with an email provider configured.
     *
     * Both are after the fact and neither may break the purchase — the ticket
     * already exists and is valid.
     */
    if (result.created) await incrementSold(tier.id);

    await sendPurchaseConfirmation({
      to: result.email,
      name: result.name ?? '',
      ticketType: result.ticketType ?? tier.name,
      amountCents: tier.priceCents,
      currency: tier.currency,
      orderUrl: `${origin}/order/${mintOrderToken({ rid: result.registrationId, demo: true })}`,
      claimCode: result.claimCode,
      registrationId: result.registrationId,
      // The receipt must never imply money changed hands when it did not.
      demo: true,
    });

    redirect(`/order/${mintOrderToken({ rid: result.registrationId, demo: true })}`);
  }

  // ---------------------------------------------------------------------
  // Hosted Stripe Checkout. The buyer leaves this origin entirely, so no card
  // data touches our server or our DOM — that is the reason for Checkout over
  // Elements, and it is what keeps this site in PCI SAQ A.
  // ---------------------------------------------------------------------
  let url: string | null;
  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: tier.currency,
            unit_amount: tier.priceCents,
            product_data: {
              name: `KGC 2027 — ${tier.name}`,
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
        },
      ],

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
      // Carried through to the webhook, which has no other way to learn the
      // attendee's name or which tier was bought.
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
       */
      metadata: {
        tier: tier.id,
        ticketType: tier.name,
        name,
        ...(campaignCode ? { campaignCode } : {}),
      },
      success_url: `${origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/tickets?cancelled=1#buy`,
    });
    url = session.url;
  } catch (err) {
    // A bad key, a Stripe outage or a rate limit. The buyer gets a sentence
    // they can act on rather than a 500 page; the detail goes to the server
    // log, because a Stripe error message can name the account.
    console.error('[checkout] Stripe session creation failed', err);
    return { error: 'We could not reach the payment processor. Nothing was charged — please try again.' };
  }

  if (!url) return { error: 'Stripe did not return a checkout URL. Try again.' };

  // Outside the try: `redirect` signals by throwing, and catching it here
  // would turn every successful checkout into the error branch above.
  redirect(url);
}
