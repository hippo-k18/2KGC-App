import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { publicSiteOrigin } from '@kgc/shared';
import { ROUTES } from '@/lib/nav';
import { GapPanel, PageHeader, Panel, Table } from '../../../ui';

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
        info={
          <>
            <strong>There is no embed snippet</strong>
            <p>
              The marketing site and the checkout are one deployment, so anywhere a widget would go,
              a link to <code>/tickets</code> goes instead. A partner site selling KGC tickets is
              what would need a real embed, and the requirements would come from that partner.
            </p>
          </>
        }
        links={[
          <Link key="p" href="/tickets/ticket-setup/1-4-registration-pages">
            Registration Pages
          </Link>,
          <Link key="c" href={ROUTES.createTickets}>
            Create Tickets
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What to put on a partner&rsquo;s site</h2>
        <p className="body-2">
          A link to the ticket page, with a tracked code on it so the partner can be credited for
          what it brings in.
        </p>
        <Table
          cols={[
            { key: 'w', label: 'What', className: 'cell-md' },
            { key: 'v', label: 'Use this', className: 'cell-fill' },
          ]}
          rows={[
            [
              'Plain link',
              <a key="v" href={`${publicSiteOrigin()}/tickets`} target="_blank" rel="noreferrer">
                {publicSiteOrigin()}/tickets
              </a>,
            ],
            [
              'Credited link',
              <span key="v">
                Give the partner their own <code>/r/</code> code on{' '}
                <Link href="/tickets/ticket-marketing/campaign-link-tracking">
                  Campaign Link Tracking
                </Link>
                . Clicks are counted by the redirect and a purchase within thirty days is credited
                back to it.
              </span>,
            ],
          ]}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
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
      </GapPanel>
    </>
  );
}
