import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { AudienceRegistrationPage } from '../../audience-registration';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Sponsor Ticket Setup › Registration Page.
 *
 * Two sponsor-facing pages exist on the website and they are deliberately not
 * the same thing. `/sponsor` is the prospectus — who comes, what the room is
 * worth, why a tier is priced where it is. `/tickets/sponsor` is the checkout
 * at the end of that conversation, and this screen is about the second one.
 * Merging them would put a card form under a pitch, which is the wrong shape
 * for a purchase somebody&rsquo;s marketing director has to approve.
 */
export default async function SponsorRegistrationPagePage() {
  await requireOrganizer();

  return (
    <AudienceRegistrationPage
      audience="sponsor"
      title="Registration Page"
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
