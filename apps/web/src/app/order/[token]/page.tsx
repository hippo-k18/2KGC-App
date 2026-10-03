import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { analyticsConfig, decodePurchase, PURCHASE_COOKIE } from '@/lib/analytics';
import { PurchaseEvent } from './purchase-event';
import { readOrderToken } from '@/lib/order-token';
import { getRegistration } from '@/lib/registrations';
import { siteEvent } from '@/lib/data';
import { OrderView } from '../order-view';

export const metadata: Metadata = {
  title: 'Your ticket',
  // This page shows who holds a ticket. It must never be indexed, and
  // `noarchive` also keeps it out of search-engine caches.
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

/** Per-request, and it has to be. Reads a capability token and the live state of the ticket behind it. A refunded or cancelled order has to stop showing as a ticket on the next load, not a minute later, and two visitors never hold the same token. */
export const dynamic = 'force-dynamic';

/**
 * The order confirmation — the screen the whole site exists to reach.
 *
 * It is reached through an HMAC-signed capability token rather than the
 * registration id, because the registration id is `sha256(email)` and would
 * therefore be computable by anyone who knew the attendee's address. See
 * `src/lib/order-token.ts`.
 *
 * The screen itself is `OrderView`, shared with the `/ticket/bought` preview.
 */
export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const ev = await siteEvent();
  const { token } = await params;
  const payload = readOrderToken(decodeURIComponent(token));
  if (!payload) notFound();

  const reg = await getRegistration(payload.rid);
  if (!reg) notFound();

  // Set only by the checkout return redirect for this registration. See `purchase-event.tsx`.
  const purchase = analyticsConfig() ? decodePurchase((await cookies()).get(PURCHASE_COOKIE)?.value) : null;

  return (
    <>
      <OrderView ev={ev} reg={reg} />
      {purchase && reg.orderId && purchase.transaction_id === reg.orderId && <PurchaseEvent purchase={purchase} cookie={PURCHASE_COOKIE} />}
    </>
  );
}
