import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapScreen } from '../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Sponsor Ticket Setup › Registration Settings.
 *
 * Same absent settings document as the exhibitor screen — this project keeps
 * registration policy per tier or as code, never as an event-wide settings
 * record — but the sponsor version of the gap is smaller than it looks.
 *
 * Sponsorship is agreed in a conversation and closed on an invoice. A deadline
 * enforced by a checkout would not be the thing standing between KGC and a
 * signed sponsor, so the honest note here is that most of what Whova offers on
 * this screen would go unused even if it existed.
 */
export default async function SponsorRegistrationSettingsPage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="Registration Settings"
      links={[
        <Link key="t" href="/tickets/sponsor-ticket-setup/sponsor-tickets">
          Sponsor Tickets
        </Link>,
        <Link key="s" href={ROUTES.sponsorManager}>
          Sponsor Manager
        </Link>,
      ]}
      lead={
        <>
          <strong>No settings document exists for any audience.</strong> The only registration
          policy this system enforces is the sale window on an individual ticket type.
        </>
      }
      whova={
        <>
          Per-audience registration controls — open and close dates, capacity, required fields,
          terms, refund policy, an approval step, and whether a company may register more than once.
        </>
      }
      needs={
        <>
          A settings document, an editor, and enforcement in the website&rsquo;s checkout, which is
          where a rule would actually have to bite. Worth ranking below almost everything else on
          the sponsor list: a sponsor deal is closed by a person, and the setting that matters most
          — a deadline for sending a logo — belongs on the sponsor record rather than on the
          checkout.
        </>
      }
      size="2–3 days, shared with the exhibitor settings screen"
      refs={
        <>
          <code>packages/shared/src/models.ts</code> — <code>TicketTypeDoc.salesOpenAt</code> /{' '}
          <code>salesCloseAt</code>, the only registration policy currently modelled.
        </>
      }
      notBuilt={[
        <li key="doc">
          <strong>The settings document.</strong> Nothing to store a policy in.
        </li>,
        <li key="approve">
          <strong>Approval before a sponsorship goes live.</strong> Fulfilment is automatic on
          payment; there is no pending state, and a sponsor listing appearing in the app the instant
          a card clears is not what an organizer wants.
        </li>,
        <li key="terms">
          <strong>Sponsorship terms at checkout.</strong> Static copy on the public site, not an
          editable field.
        </li>,
        <li key="deadline">
          <strong>A deliverables deadline.</strong> The one control that would earn its place here,
          and <code>SponsorDoc</code> has no field for it.
        </li>,
      ]}
    />
  );
}
