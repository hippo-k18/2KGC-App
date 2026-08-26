import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapScreen } from '../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › Registration Settings.
 *
 * ── Settings that have nowhere to live ──────────────────────────────────────
 *
 * There is no event settings document in this project. Where Whova keeps a
 * registration policy, this repo keeps either a per-tier field or a constant:
 * the sale window is `salesOpenAt` / `salesCloseAt` on each ticket type, the
 * currency is per tier, and the refund policy is prose on the website. That is
 * a defensible arrangement — a window that differs per tier is more useful than
 * one global window — but it means &ldquo;settings for the exhibitor
 * registration&rdquo; has no home rather than an empty form.
 */
export default async function ExhibitorRegistrationSettingsPage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="Registration Settings"
      links={[
        <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
          2.1 Exhibitor Tickets
        </Link>,
        <Link key="b" href={ROUTES.basics}>
          Event Basics
        </Link>,
      ]}
      lead={
        <>
          <strong>No settings document exists for any audience.</strong> The only registration
          policy this system enforces is the per-tier sale window on the ticket type itself.
        </>
      }
      whova={
        <>
          Per-audience registration controls: an open and close date for the whole flow, a total
          capacity, required buyer fields, terms an exhibitor must accept, a refund policy shown at
          checkout, an approval step before a registration becomes live, and whether one company may
          register twice.
        </>
      }
      needs={
        <>
          An event settings document, an editor for it, and — the part that decides whether it means
          anything — enforcement at the point of sale, which lives in the website&rsquo;s checkout
          rather than here. A setting the checkout does not read is a preference, not a rule, and
          this dashboard should not be the place that pretends otherwise.
        </>
      }
      size="2–3 days for the document and editor; enforcement is a change to the checkout"
      refs={
        <>
          <code>packages/shared/src/models.ts</code> — <code>TicketTypeDoc.salesOpenAt</code> /{' '}
          <code>salesCloseAt</code>, the only registration policy currently modelled.
        </>
      }
      notBuilt={[
        <li key="window">
          <strong>An audience-wide window.</strong> Set it per tier on 2.1 instead; several tiers
          means setting it several times.
        </li>,
        <li key="cap">
          <strong>A total exhibitor cap.</strong> Only per-tier <code>quantityTotal</code> exists,
          and it is a counter rather than a lock — two buyers can pass the same check.
        </li>,
        <li key="approve">
          <strong>Approval before a registration goes live.</strong> Fulfilment is automatic on
          payment; there is no pending-approval state.
        </li>,
        <li key="terms">
          <strong>Terms and refund policy at checkout.</strong> Both are static copy on the public
          site, not a field an organizer can edit.
        </li>,
      ]}
    />
  );
}
