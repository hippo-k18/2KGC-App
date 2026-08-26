import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { AudienceCatalogue } from '../../audience-catalogue';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Sponsor Ticket Setup › Sponsor Tickets.
 *
 * The same screen as 2.1 Exhibitor Tickets over a different slice — Whova gives
 * the sponsor flow no step numbers, and neither does the nav tree, so neither
 * does this.
 *
 * ── Why a sponsor tier is the least convincing of the three ─────────────────
 *
 * Sponsorship at KGC is negotiated, invoiced and signed, not bought from a
 * page. So even a fully wired sponsor catalogue would mostly be a price list
 * that the sales conversation starts from — which is worth saying on the screen
 * rather than letting a table imply that sponsors self-serve.
 */
export default async function SponsorTicketsPage() {
  await requireOrganizer();

  return (
    <AudienceCatalogue
      audience="sponsor"
      title="Sponsor Tickets"
      noun="sponsor"
      links={[
        <Link key="s" href={ROUTES.sponsorManager}>
          Sponsor Manager
        </Link>,
        <Link key="o" href="/tickets/orders-and-transactions/sponsor-orders">
          Sponsor Orders
        </Link>,
      ]}
      notBuilt={[
        <li key="benefits">
          <strong>Benefit fulfilment.</strong> A sponsor tier is a bundle — logo placement, booth,
          N complimentary passes, a session slot. <code>TicketTypeDoc.includes</code> holds display
          bullets, and nothing reads them as entitlements, so buying a tier would grant none of it.
        </li>,
        <li key="comps">
          <strong>The complimentary passes.</strong> The part sponsors actually chase. It needs a
          tier that mints N attendee registrations on fulfilment; today one order line produces one
          registration and there is no code path that produces more.
        </li>,
        <li key="invoice">
          <strong>The way sponsorship is really sold.</strong> Negotiated, then invoiced. Stripe
          Invoicing is wired for attendee orders, but there is no sponsor-scoped invoice flow, and{' '}
          <Link href={ROUTES.sponsorManager}>Sponsor Manager</Link> records the sponsor without
          recording what was owed for it.
        </li>,
      ]}
    />
  );
}
