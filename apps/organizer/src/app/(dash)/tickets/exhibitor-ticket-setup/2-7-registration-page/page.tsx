import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { AudienceRegistrationPage } from '../../audience-registration';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.7 Registration Page.
 *
 * The page is `/tickets/exhibitor` on the marketing site and it is real: it
 * lists the exhibitor slice of `ticketTypes` and sells it through the same
 * Checkout the attendee page uses. It did not exist until August 2026, which
 * is why every screen in this tree used to describe a catalogue nobody could
 * buy from.
 */
export default async function ExhibitorRegistrationPagePage() {
  await requireOrganizer();

  return (
    <AudienceRegistrationPage
      audience="exhibitor"
      title="2.7 Registration Page"
      links={[
        <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
          2.1 Exhibitor Tickets
        </Link>,
        <Link key="s" href="/tickets/exhibitor-ticket-setup/registration-settings">
          Registration Settings
        </Link>,
      ]}
    />
  );
}
