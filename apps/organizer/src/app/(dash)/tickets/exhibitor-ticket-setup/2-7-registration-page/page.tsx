import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.7 Registration Page.
 *
 * Whova hosts the registration page, so it can offer a page builder. We do not:
 * the buyer-facing site is `apps/web`, a Next.js application whose `/tickets`
 * route is written in TSX and deployed. Its content is partly dynamic — the
 * tiers come from Firestore — and its structure is code.
 *
 * That difference is worth stating plainly rather than promising a builder,
 * because it is a deliberate trade. A hand-built page is why the public site
 * looks like KGC instead of like a ticketing vendor.
 */
export default async function ExhibitorRegistrationPagePage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="2.7 Registration Page"
      links={[
        <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
          2.1 Exhibitor Tickets
        </Link>,
        <Link key="a" href="/tickets/ticket-setup/1-4-registration-pages">
          1.4 Registration Pages (attendee)
        </Link>,
      ]}
      lead={
        <>
          <strong>There is no exhibitor registration page, and no page builder.</strong> The public
          tickets page is a coded route that renders the attendee catalogue only.
        </>
      }
      whova={
        <>
          A hosted, themed registration page per audience with its own URL, its own banner and
          description, the audience&rsquo;s tickets, its question form, and a preview — editable
          without a developer.
        </>
      }
      needs={
        <>
          A per-audience route on <code>apps/web</code> that reads the exhibitor slice, plus editable
          copy for the parts that are prose today. The catalogue query is a one-line change — it
          already filters on <code>audience</code>. What is missing above it is everything an
          exhibitor page is <em>for</em>: booth selection, the question form, the prospectus.
        </>
      }
      size="1 day for a bare page; it is not worth shipping before 2.2 and 2.3 exist"
      refs={
        <>
          <code>apps/web/src/lib/catalogue.ts</code> — the audience filter that a second page would
          change, and <code>apps/web/src/app/tickets/</code> for what a coded page currently is.
        </>
      }
      notBuilt={[
        <li key="route">
          <strong>The route.</strong> No <code>/exhibit</code> or <code>/tickets/exhibitor</code>{' '}
          exists on the public site.
        </li>,
        <li key="builder">
          <strong>A page builder.</strong> Not planned. Page structure is code here, on purpose.
        </li>,
        <li key="copy">
          <strong>Editable copy.</strong> Headings and body text on the public tickets page are in
          TSX; changing them is a deploy.
        </li>,
        <li key="preview">
          <strong>Preview.</strong> There is no draft state to preview — what is in{' '}
          <code>ticketTypes</code> is live the moment it is saved.
        </li>,
      ]}
    />
  );
}
