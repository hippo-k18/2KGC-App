import { NextResponse, type NextRequest } from 'next/server';
import { mintOrderToken } from '@/lib/order-token';
import { fulfilPurchase } from '@/lib/registrations';
import { stripe, stripeEnabled } from '@/lib/stripe';

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
  const back = new URL('/tickets#buy', req.nextUrl.origin);

  if (!sessionId || !stripeEnabled()) return NextResponse.redirect(back);

  const session = await stripe().checkout.sessions.retrieve(sessionId);

  // `paid` for a card; `no_payment_required` for a 100% discount. Anything
  // else — `unpaid`, a delayed bank debit still processing — is not a ticket
  // yet, and the buyer goes back to the tickets page rather than to a
  // confirmation that would be a lie.
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    return NextResponse.redirect(new URL('/tickets?cancelled=1#buy', req.nextUrl.origin));
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
    new URL(`/order/${mintOrderToken({ rid: result.registrationId })}`, req.nextUrl.origin),
  );
}
