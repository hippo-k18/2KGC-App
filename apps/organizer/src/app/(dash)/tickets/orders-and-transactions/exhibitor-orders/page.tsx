import { requireOrganizer } from '@/lib/auth';
import { AudienceOrders } from '../../audience-orders';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Orders and Transactions › Exhibitor Orders.
 *
 * Whova splits the ledger three ways because it sells three catalogues. We sell
 * one, so this screen&rsquo;s job is to explain why it is empty and point at
 * where an exhibitor catalogue would start — not to render a filtered table
 * that looks like a search returning nothing.
 */
export default async function ExhibitorOrdersPage() {
  await requireOrganizer();

  return (
    <AudienceOrders
      audience="exhibitor"
      title="Exhibitor Orders"
      noun="exhibitor"
      catalogueHref="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets"
      catalogueLabel="2.1 Exhibitor Tickets"
    />
  );
}
