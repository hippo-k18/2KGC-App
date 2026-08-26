import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapScreen } from '../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Sponsor Ticket Setup › Registration Page.
 *
 * ── The one screen here with a real counterpart already shipped ─────────────
 *
 * The public site has a `/sponsor` page. It is a coded page that pitches
 * sponsorship and invites a conversation — which is how sponsorship is actually
 * sold — rather than a registration page that takes a card. So the gap is not
 * &ldquo;there is no sponsor page&rdquo;; it is that the existing one is prose
 * an organizer cannot edit and does not transact.
 *
 * Saying that is more useful than a generic not-built note, and it is also the
 * reason this screen ranks low: a page builder would replace something that
 * already does its job.
 */
export default async function SponsorRegistrationPagePage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="Registration Page"
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
          <strong>The public site has a sponsorship page, and it does not sell anything.</strong>{' '}
          It is a coded pitch page that asks the reader to get in touch; there is no sponsor
          checkout behind it and no way to edit it from here.
        </>
      }
      whova={
        <>
          A hosted, themed sponsor registration page with its own URL, its own banner and copy, the
          sponsor tiers with prices, the sponsor question form, and a preview — all editable without
          a developer.
        </>
      }
      needs={
        <>
          To transact: a sponsor slice of the catalogue that the page reads and a checkout that
          accepts it — the catalogue filter is one line, the rest is not. To be editable: stored
          copy plus an editor, which is a different project from ticketing and would replace a page
          that currently works.
        </>
      }
      size="1 day to render sponsor tiers on the existing page; the builder is not planned"
      refs={
        <>
          <code>apps/web/src/app/sponsor/</code> for the page that exists, and{' '}
          <code>apps/web/src/lib/catalogue.ts</code> for the audience filter that keeps sponsor
          tiers off it.
        </>
      }
      notBuilt={[
        <li key="tiers">
          <strong>Tiers and prices on the page.</strong> The catalogue is filtered to attendee
          before it reaches any public route.
        </li>,
        <li key="buy">
          <strong>Buying a sponsorship online.</strong> No sponsor checkout exists, and it is not
          obviously wanted — five-figure sponsorships close on an invoice.
        </li>,
        <li key="edit">
          <strong>Editing the page from this dashboard.</strong> Its copy is TSX; changing it is a
          deploy.
        </li>,
        <li key="preview">
          <strong>Preview.</strong> There is no draft state to preview — catalogue edits are live on
          save.
        </li>,
      ]}
    />
  );
}
