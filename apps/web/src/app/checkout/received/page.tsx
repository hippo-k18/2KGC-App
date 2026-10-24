import type { Metadata } from 'next';
import { ScrollToTop } from '@/components/scroll-to-top';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Payment received',
  robots: { index: false, follow: false },
};

/**
 * Where `/checkout/return` sends a buyer it could not take to their ticket.
 *
 * Two reasons, both after Stripe has said the session is paid. Most often our
 * own fulfilment threw (Firestore or Auth unreachable, a misconfigured secret):
 * the buyer has paid, and a 500 page is the worst thing to show them, so this
 * says the payment arrived and the ticket follows by email, which the webhook
 * makes true when Stripe redelivers (T135, S5). Less often the order was
 * refunded or cancelled before they came back (`?state=refunded`), or the
 * buyer paid by a delayed method whose money has not cleared
 * (`?state=processing`, T257 #3).
 */
export default async function CheckoutReceived({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const refunded = state === 'refunded';
  const processing = state === 'processing';

  return (
    <section className="order-page">
      <ScrollToTop />
      <div className="wrap narrow order-wrap">
        <p className="eyebrow">{refunded ? 'Refunded' : processing ? 'Payment processing' : 'Payment received'}</p>
        <h1 className="order-headline">
          {refunded
            ? 'This purchase was refunded.'
            : processing
              ? 'Your payment is processing.'
              : 'Your payment went through.'}
        </h1>
        <p className="notice">
          {refunded
            ? 'No ticket was issued for it. The money goes back to the card you paid with.'
            : processing
              ? 'Your bank is still sending the payment, which can take a few working days. Your ticket follows by email as soon as it clears. There is no need to pay again.'
              : 'Your ticket is on its way. We will email it to you within a few minutes, with a link to the ticket and how to get into the app.'}
        </p>
        <p className="muted order-fine">
          {refunded
            ? 'Questions: '
            : processing
              ? 'If no ticket arrives within a week, email '
              : 'If nothing arrives within the hour, email '}
          <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </p>
      </div>
    </section>
  );
}
