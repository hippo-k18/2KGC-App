import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { AudienceConfirmationEmails } from '../../audience-registration';

export const dynamic = 'force-dynamic';

/** Tickets › Exhibitor Ticket Setup › 2.4 Confirmation Emails. */
export default async function ExhibitorConfirmationEmailsPage() {
  await requireOrganizer();

  return (
    <AudienceConfirmationEmails
      audience="exhibitor"
      title="2.4 Confirmation Emails"
      links={[
        <Link key="o" href="/tickets/orders-and-transactions/exhibitor-orders">
          Exhibitor Orders
        </Link>,
      ]}
    />
  );
}
