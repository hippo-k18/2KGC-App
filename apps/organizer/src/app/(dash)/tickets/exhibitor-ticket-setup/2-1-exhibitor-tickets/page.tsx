import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { AudienceCatalogue } from '../../audience-catalogue';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.1 Exhibitor Tickets.
 *
 * Whova numbers the exhibitor flow &ldquo;2.x&rdquo; the way it numbers the
 * attendee flow &ldquo;1.x&rdquo;, and the numbering is kept for the same
 * reason it is kept on 1.1: an organizer who knows Whova is looking for
 * &ldquo;2.1&rdquo;, and renumbering to something tidier costs them that.
 *
 * The screen is real — it lists the exhibitor slice of `ticketTypes` — and
 * today that slice is empty. Rendering an empty table is the honest outcome,
 * not a bug: the exhibitor catalogue has never been written to.
 */
export default async function ExhibitorTicketsPage() {
  await requireOrganizer();

  return (
    <AudienceCatalogue
      audience="exhibitor"
      title="2.1 Exhibitor Tickets"
      noun="exhibitor"
      links={[
        <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
          Exhibitor Manager
        </Link>,
        <Link key="o" href="/tickets/orders-and-transactions/exhibitor-orders">
          Exhibitor Orders
        </Link>,
      ]}
      notBuilt={[
        <li key="booth">
          <strong>Booth inventory.</strong> An exhibitor tier in Whova is priced <em>per booth
          size</em>, and buying one takes a booth out of stock. Nothing in{' '}
          <code>ticketTypes</code> models a floor plan, so a tier here could only ever be a flat
          price — see <Link href="/tickets/exhibitor-ticket-setup/2-3-booth-selection">2.3 Booth
          Selection</Link>.
        </li>,
        <li key="profile">
          <strong>The exhibitor record that a purchase should create.</strong> Buying an attendee
          ticket produces a registration. Buying an exhibitor package should produce an entry the{' '}
          <Link href="/content/exhibitor-center/exhibitor-manager">Exhibitor Manager</Link> can see;
          the two collections have no link between them at all.
        </li>,
      ]}
    />
  );
}
