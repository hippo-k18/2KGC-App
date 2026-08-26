import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › 1.5 Registration Widgets.
 *
 * Whova gives you a snippet to paste into your own site — an iframe or a script
 * tag that renders the ticket catalogue and a buy button on someone else's
 * page. The point is that a conference usually has a WordPress site older than
 * its ticketing platform, and nobody wants to send visitors away from it.
 *
 * KGC does not have that problem in the same shape: the marketing site and the
 * ticket catalogue are the same Next.js app, so the "widget" is a link. Saying
 * that plainly is more useful than generating an embed snippet for a widget
 * endpoint that does not exist — which is the failure mode worth avoiding here,
 * because a copyable code block is the most convincing possible lie.
 */
export default async function RegistrationWidgetsPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="1.5 Registration Widgets"
        links={[
          <Link key="p" href="/tickets/ticket-setup/1-4-registration-pages">
            Registration Pages
          </Link>,
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>There is no embeddable widget and no snippet to copy.</strong> A code block here
        would be pasted into a real site and render nothing, so there is not one.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Why the need is smaller here</h2>
        <p className="body-2">
          Whova&rsquo;s widget bridges two systems: your website, and their ticketing. This project
          has one — <code>apps/web</code> serves the marketing pages, the blog, the agenda and the
          checkout from a single deployment reading a single Firestore database. Anywhere a widget
          would go, a link to <code>/tickets</code> goes instead, and it is faster, accessible, and
          impossible to break by upgrading a host page&rsquo;s CSS.
        </p>
        <p className="body-2">
          The case that would genuinely need one is a <em>third-party</em> site selling KGC tickets
          — a partner association, a sponsor&rsquo;s events page. That is worth building only when
          such a partner exists, and its requirements come from them.
        </p>

        <h2 className="section-header">What it would take, if a partner asked</h2>
        <p className="body-2">
          A public JSON endpoint for the catalogue (there is none — <code>catalogue.ts</code> is{' '}
          <code>server-only</code> and reads with the Admin SDK), an iframe route with a permissive
          frame policy for named origins only, and a decision about where checkout opens. The last
          is the awkward one: Stripe&rsquo;s hosted Checkout will not run inside a cross-origin
          iframe, so the buy button has to break out to a top-level navigation, which is exactly the
          thing an embed was adopted to avoid.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No embed snippet, iframe route or script tag.</strong> Nothing in{' '}
            <code>apps/web</code> is designed to render inside another origin.
          </li>
          <li>
            <strong>No public catalogue API.</strong> Every read of <code>ticketTypes</code> in this
            project is server-side with the Admin SDK, and the collection has no{' '}
            <code>firestore.rules</code> match block on purpose.
          </li>
          <li>
            <strong>No per-partner attribution.</strong> A widget usually comes with tracking so a
            partner can be credited for sales; that is campaign link tracking, also unbuilt.
          </li>
        </ul>
      </Panel>
    </>
  );
}
