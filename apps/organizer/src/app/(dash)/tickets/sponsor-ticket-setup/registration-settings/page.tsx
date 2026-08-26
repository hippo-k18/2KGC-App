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
      extraGaps={[
        [
          'Exclusivity on a capped tier',
          '⚠️ Platinum is capped at one, and the cap is a sold counter rather than a reservation — two buyers can pass the check and both pay. On the one tier whose value IS exclusivity that is worth watching manually until a real hold exists.',
        ],
        [
          'Category exclusivity',
          'Sponsors routinely buy the right to be the only graph-database vendor at that level. Nothing models a category, so nothing can enforce it — today this is a contract term and a human memory.',
        ],
        [
          'Deliverables the tier promises',
          'Each level lists a sponsored session, logo placements and a pass count. They are prose in the inclusion list; no screen tracks whether any of them has been delivered.',
        ],
        [
          'A sponsor record the purchase should create',
          'Buying a sponsorship should produce a `sponsors` document the app renders. Sponsor Manager is populated by the seed and by hand — the two collections have no link between them.',
        ],
      ]}
    />
  );
}
