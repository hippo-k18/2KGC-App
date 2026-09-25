import { NextResponse, type NextRequest } from 'next/server';
import { mintOrderToken } from '@/lib/order-token';
import { fulfilPurchase } from '@/lib/registrations';
import { siteOrigin, stripe, stripeEnabled } from '@/lib/stripe';

/**
 * Where Stripe sends the buyer after a successful Checkout.
 *
 * This fulfils the purchase *as well as* the webhook, rather than instead of
 * it. The two exist for different failure modes and both are necessary:
 *
 *  - The **webhook** is the authoritative one. It arrives even if the buyer
 *    closes the tab on Stripe's confirmation screen, and Stripe retries it
 *    until it is acknowledged.
 *  - This **redirect** is the fast one. Webhook delivery is typically quick
 *    but not synchronous, and without this the buyer can land on a
 *    confirmation page a moment before their registration exists.
 *
 * Running both is safe precisely because `fulfilPurchase` is idempotent —
 * the registration id is derived from the email and the order id from the
 * Checkout Session, so whichever path arrives second overwrites the same two
 * documents with the same values.
 *
 * The payment status is re-read from Stripe here rather than trusted from the
 * URL. A `session_id` in a query string is attacker-supplied; only Stripe's
 * own answer about whether it was paid means anything.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id');
  /**
   * The public origin, never `req.nextUrl.origin`.
   *
   * Behind the droplet's Apache proxy the request this route sees is the one
   * Apache made to `127.0.0.1:3200`, so `nextUrl.origin` is the internal
   * address. Every buyer coming back from Stripe was being sent on to
   * `http://localhost:3200/order/…`, which on their machine is nothing. The
   * pre-publish gate found it on staging. `siteOrigin()` is what the checkout
   * action already uses to build `success_url`: `WEB_PUBLIC_ORIGIN` first, then
   * the forwarded host.
   */
  const origin = siteOrigin(req.headers.get('x-forwarded-host') ?? req.headers.get('host'), req.headers.get('x-forwarded-proto'));
  // The checkout page, not `/tickets#buy` — that anchor went away when buying
  // moved to its own route, and a redirect to a missing fragment silently lands
  // the buyer at the top of a price list with no form and no explanation.
  const back = new URL('/tickets/checkout', origin);

  if (!sessionId || !stripeEnabled()) return NextResponse.redirect(back);

  const session = await stripe().checkout.sessions.retrieve(sessionId);

  // `paid` for a card; `no_payment_required` for a 100% discount. Anything
  // else — `unpaid`, a delayed bank debit still processing — is not a ticket
  // yet, and the buyer goes back to the tickets page rather than to a
  // confirmation that would be a lie.
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    return NextResponse.redirect(new URL('/tickets/checkout?cancelled=1', origin));
  }

  const email = session.customer_details?.email ?? session.customer_email;
  if (!email) return NextResponse.redirect(back);

  const result = await fulfilPurchase({
    email,
    name: session.metadata?.name ?? session.customer_details?.name ?? '',
    ticketType: session.metadata?.ticketType ?? 'Main Conference',
    externalId: session.id,
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
    paid: true,
  });

  return NextResponse.redirect(
    new URL(`/order/${mintOrderToken({ rid: result.registrationId })}`, origin),
  );
}
