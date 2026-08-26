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
      extraGaps={[
        [
          'Which booth a purchase allocates',
          'A package sells a booth size, not a specific space. Assignment happens on 2.3 Booth Selection, after the sale, because a floor plan is agreed with the venue later than the catalogue is priced.',
        ],
        [
          'Load-in and load-out windows',
          'The single most-asked exhibitor question, and it is not modelled anywhere. It belongs on the exhibitor record rather than the ticket type — two exhibitors buying the same package can have different slots.',
        ],
        [
          'Staff pass allocation',
          'Every package names a number of passes in its inclusion list, and nothing enforces it. The passes are prose today; making them real means issuing registrations against the exhibitor order, which is what Pre-paid Exhibitors does by hand.',
        ],
      ]}
    />
  );
}
