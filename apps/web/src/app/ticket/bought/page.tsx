import type { Metadata } from 'next';
import { resolveEventBasics } from '@kgc/shared';
import { OrderView } from '@/app/order/order-view';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Your ticket',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

/**
 * Built once, from constants. Nothing here reads a request, so the page cannot
 * be pointed at a real order: there is no token, no query string and no
 * Firestore read behind it.
 */
export const dynamic = 'force-static';

/**
 * What a buyer sees after paying, filled with a made-up attendee.
 *
 * The team asked to see the confirmation without buying a ticket on the live
 * Stripe account. It renders the same `OrderView` as `/order/[token]`, so a
 * change to the real screen shows up here too.
 *
 * The event details are the code defaults rather than the saved event
 * settings, to keep this page free of data reads. They only differ if an
 * organizer has changed the dates or venue on the dashboard.
 */
const SAMPLE_EVENT = (() => {
  const basics = resolveEventBasics(null);
  return {
    ...basics,
    venueShort: basics.venue === SITE.venue ? SITE.venueShort : basics.venue,
  };
})();

const SAMPLE_REGISTRATION = {
  registrationId: 'reg_sample_000000000000000',
  email: 'jordan.rivera@example.com',
  name: 'Jordan Rivera',
  ticketType: 'Main Conference',
};

export default function TicketBoughtPreview() {
  return <OrderView ev={SAMPLE_EVENT} reg={SAMPLE_REGISTRATION} />;
}
