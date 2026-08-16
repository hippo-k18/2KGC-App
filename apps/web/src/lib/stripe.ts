import 'server-only';

import Stripe from 'stripe';

/**
 * Stripe, optionally.
 *
 * Two decisions are baked in here.
 *
 * **Hosted Checkout, not Elements.** Checkout redirects the buyer to
 * `checkout.stripe.com`, so no card number ever touches this origin and the
 * site stays out of PCI scope (SAQ A rather than SAQ A-EP). Elements would put
 * an iframe on our page and drag the whole DOM into scope for very little
 * design gain.
 *
 * **The demo must run without a Stripe account.** If `STRIPE_SECRET_KEY` is
 * unset the site falls back to a clearly labelled test purchase that performs
 * the *same* registration write and says on screen, in as many words, that no
 * payment was taken. The one thing that is never acceptable is a confirmation
 * page that implies money changed hands when it did not — so the fallback is
 * labelled at the button, on the confirmation, and in the order document
 * (`status: 'pending'`, never `'paid'`).
 */

let cached: Stripe | null = null;

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripe(): Stripe {
  if (!cached) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('stripe() called with STRIPE_SECRET_KEY unset — check stripeEnabled() first.');
    cached = new Stripe(key, {
      // Pinned rather than "latest": a silently-changing API version is a
      // silently-changing webhook payload.
      apiVersion: '2025-10-29.clover',
      typescript: true,
    });
  }
  return cached;
}

/**
 * Where Stripe should send the buyer back to. Derived from the request rather
 * than hard-coded so the same build works on localhost:3200 and in production.
 */
export function siteOrigin(headerHost?: string | null, proto?: string | null): string {
  if (process.env.WEB_PUBLIC_ORIGIN) return process.env.WEB_PUBLIC_ORIGIN.replace(/\/$/, '');
  const host = headerHost ?? 'localhost:3200';
  const scheme = proto ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${scheme}://${host}`;
}
