import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { AudienceRegistrationWidget } from '../../audience-registration';

export const dynamic = 'force-dynamic';

/** Tickets › Sponsor Ticket Setup › Registration Widget. */
export default async function SponsorRegistrationWidgetPage() {
  await requireOrganizer();

  return (
    <AudienceRegistrationWidget
      audience="sponsor"
      title="Registration Widget"
      links={[
        <Link key="p" href="/tickets/sponsor-ticket-setup/registration-page">
          Registration Page
        </Link>,
      ]}
    />
  );
}
