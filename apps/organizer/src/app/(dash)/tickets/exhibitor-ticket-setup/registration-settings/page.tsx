import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { AudienceRegistrationSettings } from '../../audience-registration';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › Registration Settings.
 *
 * The two extra rows below are the ones that are genuinely exhibitor-shaped —
 * booth allocation and load-in logistics have no home in the data model, and
 * naming them here is more useful than a generic note about settings.
 */
export default async function ExhibitorRegistrationSettingsPage() {
  await requireOrganizer();

  return (
    <AudienceRegistrationSettings
      audience="exhibitor"
      title="Registration Settings"
      links={[
        <Link key="b" href="/tickets/exhibitor-ticket-setup/2-3-booth-selection">
          2.3 Booth Selection
        </Link>,
        <Link key="p" href="/tickets/exhibitor-ticket-setup/pre-paid-exhibitors">
          Pre-paid Exhibitors
        </Link>,
      ]}
    />
  );
}
