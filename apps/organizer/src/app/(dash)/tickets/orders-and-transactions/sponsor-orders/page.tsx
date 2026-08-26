import { requireOrganizer } from '@/lib/auth';
import { AudienceOrders } from '../../audience-orders';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Orders and Transactions › Sponsor Orders.
 *
 * The same empty ledger as Exhibitor Orders, for the same reason, and with the
 * same refusal to dress it as a filter that found nothing.
 *
 * Worth knowing when reading this screen: sponsorship money at KGC is real
 * whether or not it appears here. It arrives on an invoice agreed outside the
 * platform, and this dashboard sees an order only when the platform created one.
 */
export default async function SponsorOrdersPage() {
  await requireOrganizer();

  return (
    <AudienceOrders
      audience="sponsor"
      title="Sponsor Orders"
      noun="sponsor"
      catalogueHref="/tickets/sponsor-ticket-setup/sponsor-tickets"
      catalogueLabel="Sponsor Tickets"
    />
  );
}
