import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { AudienceRegistrationSettings } from '../../audience-registration';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Sponsor Ticket Setup › Registration Settings.
 *
 * The exclusivity row is the one that matters here. Platinum is capped at one
 * seat by `quantityTotal`, and that cap is a **counter, not a lock** — so the
 * one sponsorship level whose entire value is being the only one is also the
 * level where the counter&rsquo;s weakness is most expensive. It is called out
 * rather than left to be discovered.
 */
export default async function SponsorRegistrationSettingsPage() {
  await requireOrganizer();

  return (
    <AudienceRegistrationSettings
      audience="sponsor"
      title="Registration Settings"
      links={[
        <Link key="t" href="/tickets/sponsor-ticket-setup/sponsor-tickets">
          Sponsor Tickets
        </Link>,
        <Link key="m" href="/content/sponsor-center/sponsor-manager">
          Sponsor Manager
        </Link>,
      ]}
    />
  );
}
