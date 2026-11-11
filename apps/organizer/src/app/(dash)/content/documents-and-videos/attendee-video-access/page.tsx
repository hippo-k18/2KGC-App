import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { listWatchOverview, ticketHolderCounts } from '@/lib/streaming';
import { strandedHolders, ticketAudienceRows } from '@/lib/ticket-audience-core';
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
  const [tickets, watch, held] = await Promise.all([
    listTicketTypes(),
    listWatchOverview(),
    ticketHolderCounts(),
  ]);
  const recorded = watch.filter((r) => r.recording).length;
  const entitled = tickets.filter((t) => t.includes.some((i) => /video library/i.test(i)));

  /*
    Who actually holds each tier, from the registrations. This screen used to
    print `quantitySold`, which counts orders placed through this system — four
    of them — while sixty-three registrations hold tickets. See
    `ticket-audience-core.ts`.
  */
  const audience = ticketAudienceRows(
    tickets.map((t) => ({
      name: t.name,
      videoLibrary: t.includes.some((i) => /video library/i.test(i)),
    })),
    held,
  );
  const stranded = strandedHolders(audience);

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

      {stranded > 0 ? (
        <Banner kind="warning">
          <strong>
            {stranded} {stranded === 1 ? 'person holds' : 'people hold'} a ticket type you do not
            sell.
          </strong>{' '}
          It is listed below. Every &ldquo;who can watch&rdquo; control is built from your ticket
          types, so nothing you can tick includes them: the moment you restrict a video they are
          shut out and there is no box that would let them in. Move them onto a ticket type you
          sell on <Link href={ROUTES.attendees}>Attendees</Link>, or leave those videos open.
        </Banner>
      ) : null}

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Who would get access</h2>
        {tickets.length === 0 ? (
          <NotInputted what="ticket types" />
        ) : (
        <Table
          stackSm
          cols={[
            { key: 't', label: 'Ticket type', className: 'cell-fill' },
            { key: 's', label: 'People holding it', className: 'cell-sm' },
            { key: 'v', label: 'Video library', className: 'cell-sm' },
          ]}
          rows={audience.map((row) => [
            <span key="t">
              {row.name}
              {!row.inCatalogue ? (
                <div className="muted" style={{ fontSize: 11 }}>
                  not a ticket type you sell
                </div>
              ) : null}
            </span>,
            row.holders,
            /*
              Read straight off the ticket type rather than recomputed, because
              this is the same field Checkout charges against and the app would
              read. A second source here would eventually disagree with the
              thing the buyer actually paid for.
            */
            row.videoLibrary ? (
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
