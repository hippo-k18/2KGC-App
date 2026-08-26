import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.5 Ticket Add-ons.
 *
 * Exhibitor add-ons are the electricity, the furniture rental, the extra booth
 * staff badges — separately priced, separately stocked, bought alongside the
 * package. The order model can already *express* several priced lines, which
 * makes this look closer than it is: nothing anywhere produces a line that is
 * not a ticket tier.
 */
export default async function ExhibitorAddOnsPage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="2.5 Ticket Add-ons"
      links={[
        <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
          2.1 Exhibitor Tickets
        </Link>,
        <Link key="a" href="/tickets/ticket-setup/ticket-add-ons">
          Ticket Add-ons (attendee)
        </Link>,
      ]}
      lead={
        <>
          <strong>No add-on exists in the catalogue or in the checkout.</strong> Every order line
          this system can create is one quantity of one ticket tier.
        </>
      }
      whova={
        <>
          Named add-ons with their own price, their own stock and their own tax treatment, attached
          to chosen ticket types, offered during registration and itemised on the confirmation and
          the invoice. Extra exhibitor badges are the archetype: five included, more at a price.
        </>
      }
      needs={
        <>
          An add-on catalogue (or an <code>audience</code>-style flag distinguishing add-ons from
          admission in <code>ticketTypes</code>), a selection step before Checkout, and line-item
          construction that mixes the two. <code>OrderLine</code> already carries{' '}
          <code>ticketTypeId</code>, <code>quantity</code> and <code>unitPriceCents</code> — integer
          minor units throughout — so the ledger side needs nothing new.
        </>
      }
      size="3–5 days, of which the selection UI before the Stripe redirect is most of it"
      refs={
        <>
          <code>packages/shared/src/models.ts</code> — <code>OrderLine</code>, and the note that a
          tier carries its own <code>taxCode</code> because a workshop and a video-library add-on
          are not the same product for tax.
        </>
      }
      notBuilt={[
        <li key="cat">
          <strong>An add-on catalogue.</strong> Nothing distinguishes admission from an extra, so
          an add-on created as a tier would appear as a ticket for sale.
        </li>,
        <li key="stock">
          <strong>Stock per add-on.</strong> Furniture and power drops are genuinely finite, and{' '}
          <code>quantitySold</code> is documented as a counter, not a lock.
        </li>,
        <li key="badges">
          <strong>Extra badges producing extra registrations.</strong> The reason exhibitors buy
          add-ons at all. One line produces one registration today.
        </li>,
        <li key="fulfil">
          <strong>An operations view of what was bought.</strong> The venue needs a list of power
          drops by booth; nothing would assemble one.
        </li>,
      ]}
    />
  );
}
