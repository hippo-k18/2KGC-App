import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, NotInputted, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Documents & Videos › Attendee Video Access.
 *
 * The entitlement half of video is real even though the video half is not:
 * `TicketTypeDoc.includesVideoLibrary` is set per tier and is sold on the
 * public price list. This shows who would get access, which is worth knowing
 * before anybody builds the player — and worth flagging, because KGC is
 * currently taking money for a video library that does not exist yet.
 */
export default async function AttendeeVideoAccessPage() {
  await requireOrganizer();
  const tickets = await listTicketTypes();
  const entitled = tickets.filter((t) => t.includes.some((i) => /video library/i.test(i)));

  return (
    <>
      <PageHeader
        title="Attendee Video Access"
        info={
          <>
            <strong>The entitlement, not the library</strong>
            <p>
              This reads <code>TicketTypeDoc.includesVideoLibrary</code>, which Checkout charges
              against. Nothing serves a recording yet. Video Hosting is waiting on a provider
              account.
            </p>
          </>
        }
        links={[
          <Link key="t" href={ROUTES.createTickets}>
            Ticket types
          </Link>,
          <Link key="v" href="/content/documents-and-videos/video-hosting">
            Video hosting
          </Link>,
        ]}
      />

      {entitled.length > 0 ? (
        <Banner kind="warning">
          <strong>
            {entitled.length} ticket {entitled.length === 1 ? 'tier advertises' : 'tiers advertise'}{' '}
            a video library that nothing serves.
          </strong>{' '}
          It is on the public price list and buyers are paying for it. Resolve it before doors open. Either serve it, or change the copy on{' '}
          <Link href={ROUTES.createTickets}>Ticket types</Link>.
        </Banner>
      ) : null}

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Who would get access</h2>
        {tickets.length === 0 ? (
          <NotInputted what="ticket types" />
        ) : (
        <Table
          cols={[
            { key: 't', label: 'Ticket type', className: 'cell-fill' },
            { key: 's', label: 'Sold', className: 'cell-sm' },
            { key: 'v', label: 'Video library', className: 'cell-sm' },
          ]}
          rows={tickets.map((t) => [
            t.name,
            t.quantitySold,
            /*
              Read straight off the ticket type rather than recomputed, because
              this is the same field Checkout charges against and the app would
              read. A second source here would eventually disagree with the
              thing the buyer actually paid for.
            */
            t.includes.some((i) => /video library/i.test(i)) ? (
              <Tag key="v" color="green" fill="outline" small>
                included
              </Tag>
            ) : (
              <span key="v" className="muted">
                no
              </span>
            ),
          ])}
        />
        )}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Granting or revoking access per attendee.</strong>{' '}
            <code>users/&#123;uid&#125;/entitlements</code> is modelled for exactly this and nothing
            writes to it.
          </li>
          <li>
            <strong>An expiry.</strong> &ldquo;Three months&rdquo; is copy on a ticket, not a date
            on a record.
          </li>
          <li>
            <strong>A player.</strong> See Video Hosting — this is a bill, not a screen.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
