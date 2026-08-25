import 'server-only';

import Stripe from 'stripe';

/**
 * Stripe, from the organizer side.
 *
 * A deliberate near-copy of `apps/web/src/lib/stripe.ts` rather than a shared
 * package. The two apps deploy separately with separate environments, and the
 * thing they would share is fifteen lines of client construction — while what
 * they must *not* share is the key itself. A common module invites one
 * `.env` and one blast radius.
 *
 * ── What this client is allowed to do ───────────────────────────────────────
 *
 * The website's client creates Checkout sessions and invoices. This one issues
 * **refunds**, which is the only genuinely irreversible action in the product:
 * money leaves the account and no button brings it back. Everything that calls
 * it goes through `requireOrganizer()`, re-checks the passphrase, and writes an
 * audit entry — see `commerce.ts`.
 *
 * ── Without a key ───────────────────────────────────────────────────────────
 *
 * `stripeEnabled()` is false and the orders screens still render. They read
 * Firestore, not Stripe, so a demo deployment shows real orders and simply
 * cannot refund them — which is the correct behaviour for a dashboard someone
 * is clicking around in, and much better than a screen that will not load.
 */

let cached: Stripe | null = null;

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripe(): Stripe {
  if (!cached) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        'stripe() called with STRIPE_SECRET_KEY unset — check stripeEnabled() first.',
      );
    }
    cached = new Stripe(key, {
      // Pinned, and pinned to the *same* version the website uses. A refund
      // issued against a different API version than the charge was created
      // with is a class of bug nobody wants to debug during an event.
      apiVersion: '2025-10-29.clover',
      typescript: true,
    });
  }
  return cached;
}

/**
 * True when this dashboard is pointed at a live Stripe account rather than a
 * test one.
 *
 * Used to decide how loudly the refund confirmation shouts. `sk_test_…` keys
 * move no real money, and a dashboard that cries wolf on every test refund
 * trains an organizer to click through the warning on the day it is real.
 */
export function stripeIsLive(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live_');
}

/** Deep link to a payment in the Stripe dashboard, test or live as appropriate. */
export function stripePaymentUrl(paymentIntentId: string): string {
  return `https://dashboard.stripe.com/${stripeIsLive() ? '' : 'test/'}payments/${paymentIntentId}`;
}

/** Deep link to an invoice in the Stripe dashboard. */
export function stripeInvoiceUrl(invoiceId: string): string {
  return `https://dashboard.stripe.com/${stripeIsLive() ? '' : 'test/'}invoices/${invoiceId}`;
}
