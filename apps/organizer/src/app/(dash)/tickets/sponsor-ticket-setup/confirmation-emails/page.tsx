import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { AudienceConfirmationEmails } from '../../audience-registration';

export const dynamic = 'force-dynamic';

/** Tickets › Sponsor Ticket Setup › Confirmation Emails. */
export default async function SponsorConfirmationEmailsPage() {
  await requireOrganizer();

  return (
    <AudienceConfirmationEmails
      audience="sponsor"
      title="Confirmation Emails"
      links={[
        <Link key="o" href="/tickets/orders-and-transactions/sponsor-orders">
          Sponsor Orders
        </Link>,
        <Link key="m" href="/content/sponsor-center/message-sponsors">
          Message Sponsors
        </Link>,
      ]}
    />
  );
}
