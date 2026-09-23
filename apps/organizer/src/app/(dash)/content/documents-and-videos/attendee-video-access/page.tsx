import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { listWatchOverview } from '@/lib/streaming';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, NotInputted, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Documents & Videos › Attendee Video Access.
 *
 * `TicketTypeDoc.includesVideoLibrary` is set per tier and sold on the public
 * price list. This shows who gets access.
 *
 * ⚠️ Until 2026-09-23 this screen said the library did not exist, and that was
 * true. Recordings are attached to their sessions now, so the warning here
 * changed shape: it fires when a tier promises a library and no session has a
 * recording, which is the state that is actually a refund conversation.
 */
export default async function AttendeeVideoAccessPage() {
  await requireOrganizer();
  const [tickets, watch] = await Promise.all([listTicketTypes(), listWatchOverview()]);
  const recorded = watch.filter((r) => r.recording).length;
  const entitled = tickets.filter((t) => t.includes.some((i) => /video library/i.test(i)));

  return (
    <>
      <PageHeader
        title="Attendee Video Access"
        info={
          <>
            <strong>Who the ticket promises video to</strong>
            <p>
              This lists the ticket types that include the video library, beside how many sessions
              have a recording attached.
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
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      {entitled.length > 0 && recorded === 0 ? (
        <Banner kind="warning">
          <strong>
            {entitled.length} ticket {entitled.length === 1 ? 'tier advertises' : 'tiers advertise'}{' '}
            a video library and no session has a recording.
          </strong>{' '}
          Buyers are paying for it. Attach the recordings on{' '}
          <Link href={ROUTES.sessionManager}>Session Manager</Link>, or change the ticket
          description on <Link href={ROUTES.createTickets}>Ticket types</Link>.
        </Banner>
      ) : null}

      {recorded > 0 ? (
        <Banner kind="info">
          <strong>
            {recorded} {recorded === 1 ? 'session has' : 'sessions have'} a recording.
          </strong>{' '}
          A recording left open is open to every ticket. One restricted to particular tiers still
          admits every tier that includes the video library.
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
            <strong>Granting or revoking access per attendee.</strong> Access follows the ticket
            type, so one person cannot be let in or shut out on their own.
          </li>
          <li>
            <strong>A library screen in the app.</strong> Recordings are attached per session and
            appear on that session, not in one list of everything.
          </li>
          <li>
            <strong>Hosting the file.</strong> See Video Hosting — this keeps the link, not the
            video.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
