'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { MERCH_PICKUP_NOTE } from '@kgc/shared';
import { CHECKOUT_SOURCE } from '@/lib/checkout-source';
import { checkoutCallerIp, checkoutStartAllowed } from '@/lib/checkout-limit';
import { checkoutExpiresAt } from '@/lib/checkout-expiry';
import { activeMerch } from '@/lib/merch';
import { merchFromForm, merchLineItem, merchMetadata } from '@/lib/merch-checkout';
import { readOrderToken } from '@/lib/order-token';
import { getRegistration } from '@/lib/registrations';
import { SITE } from '@/lib/site';
import { siteOrigin, stripe, stripeEnabled } from '@/lib/stripe';

export interface MerchCheckoutState {
  error?: string;
}

/**
 * Merch on its own, for somebody who already holds a ticket (T380).
 *
 * Tied to the ticket by the `/order/{token}` capability token the holder's
 * confirmation carries, so only a ticket holder can reach Stripe from here and
 * the order lands against their registration. The session is marked
 * `kind: merch` with no `tier`, which is what keeps the webhook from ever
 * reading it as a ticket. No promotion codes: they are for tickets.
 */
export async function startMerchCheckout(_prev: MerchCheckoutState, form: FormData): Promise<MerchCheckoutState> {
  if (!stripeEnabled()) return { error: 'Merch is not on sale yet. Nothing was charged.' };

  const token = String(form.get('t') ?? '');
  const payload = readOrderToken(token);
  const reg = payload ? await getRegistration(payload.rid) : null;
  if (!reg || (reg.status && reg.status !== 'active')) {
    return { error: 'Open this page from the link in your ticket confirmation. Nothing was charged.' };
  }

  if (!(await checkoutStartAllowed(checkoutCallerIp(await headers())))) {
    return { error: 'Too many checkouts started from this connection. Wait a few minutes and try again. Nothing was charged.' };
  }

  const items = await activeMerch();
  if (items.length === 0) return { error: 'Merch is not on sale right now. Nothing was charged.' };
  const merch = await merchFromForm(form, items[0]!.currency);
  if (!Array.isArray(merch)) return merch;
  if (merch.length === 0) return { error: 'Choose at least one item.' };

  const h = await headers();
  const origin = siteOrigin(h.get('host'), h.get('x-forwarded-proto'));
  const currency = items[0]!.currency;

  let url: string | null;
  try {
    let methods: ('card' | 'link')[] = ['card', 'link'];
    const create = () =>
      stripe().checkout.sessions.create({
        mode: 'payment',
        customer_email: reg.email,
        payment_method_types: methods,
        expires_at: checkoutExpiresAt(new Date()),
        line_items: merch.map((line) => merchLineItem(line, currency)),
        automatic_tax: { enabled: true },
        allow_promotion_codes: false,
        billing_address_collection: 'required',
        custom_text: { submit: { message: MERCH_PICKUP_NOTE } },
        metadata: {
          source: CHECKOUT_SOURCE,
          kind: 'merch',
          holder: reg.registrationId,
          name: reg.name ?? '',
          ...merchMetadata(merch),
        },
        success_url: `${origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/tickets/merch?t=${encodeURIComponent(token)}&cancelled=1`,
      });
    const session = await create().catch((err: { type?: string; param?: string }) => {
      // Link not switched on for the account: card alone, as the ticket checkout does.
      if (err?.type !== 'StripeInvalidRequestError' || !err.param?.startsWith('payment_method_types')) throw err;
      methods = ['card'];
      return create();
    });
    url = session.url;
  } catch (err) {
    console.error('[merch] Stripe session creation failed', err);
    if ((err as { type?: string }).type === 'StripeInvalidRequestError') {
      return { error: `The payment processor did not accept this order. Nothing was charged. Email ${SITE.contactEmail}.` };
    }
    return { error: 'We could not reach the payment processor. Nothing was charged. Please try again.' };
  }
  if (!url) return { error: 'Stripe did not return a checkout URL. Try again.' };
  redirect(url);
}
