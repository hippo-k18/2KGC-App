import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { activeMerch } from '@/lib/merch';
import { readOrderToken } from '@/lib/order-token';
import { getRegistration } from '@/lib/registrations';
import { SITE } from '@/lib/site';
import { stripeEnabled } from '@/lib/stripe';
import { MerchForm } from './merch-form';

export const metadata: Metadata = {
  title: 'KGC merch',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export const dynamic = 'force-dynamic';

/**
 * Merch for people who already have a ticket (T380). Reached from the order
 * page, `/order/{token}`, whose token it carries; hidden (404) while no item
 * is switched on.
 */
export default async function MerchPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; cancelled?: string }>;
}) {
  const items = await activeMerch();
  if (items.length === 0) notFound();
  const { t = '', cancelled } = await searchParams;
  const payload = readOrderToken(t);
  const reg = payload ? await getRegistration(payload.rid) : null;
  const holder = reg && (!reg.status || reg.status === 'active') ? reg : null;

  return (
    <section className="band">
      <div className="wrap narrow">
        <h1 style={{ fontSize: '1.6rem' }}>KGC merch</h1>
        {cancelled && <p className="notice warn">Checkout was cancelled. Nothing was charged.</p>}
        {holder ? (
          <>
            <p>
              For {holder.name || holder.email}, with your {holder.ticketType} ticket.
            </p>
            <MerchForm items={items} token={t} stripeReady={stripeEnabled()} />
          </>
        ) : (
          <>
            <p>
              Merch is for ticket holders. Open this page from the link on your ticket, which is in
              your confirmation email.
            </p>
            <p>
              No ticket yet? Add merch when you <Link href="/tickets">buy one</Link>. Lost the email?
              Write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
