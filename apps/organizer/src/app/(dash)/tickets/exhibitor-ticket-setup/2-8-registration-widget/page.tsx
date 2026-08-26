import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { AudienceRegistrationWidget } from '../../audience-registration';

export const dynamic = 'force-dynamic';

/** Tickets › Exhibitor Ticket Setup › 2.8 Registration Widget. */
export default async function ExhibitorRegistrationWidgetPage() {
  await requireOrganizer();

  return (
    <AudienceRegistrationWidget
      audience="exhibitor"
      title="2.8 Registration Widget"
      links={[
        <Link key="p" href="/tickets/exhibitor-ticket-setup/2-7-registration-page">
          2.7 Registration Page
        </Link>,
      ]}
    />
  );
}
