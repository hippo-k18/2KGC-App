import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { capacityIndex } from '@/lib/cohorts';
import { listSessions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { seatCounts } from '@/lib/session-seats';
import { joinNames, seatFill } from '@/lib/session-seats-core';
import { GapPanel, PER_PAGE, PageHeader, Pagination, Panel, StatTiles, Table, Tag, listParams, paginate } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › Session RSVP.
 *
 * ── The distinction this screen exists to keep straight ─────────────────────
 *
 * "Add to my schedule" is a private bookmark: nobody is turned away for not
 * having one and nothing is counted from it. An RSVP is a promise the event can
 * act on, and the difference is the cap. A session with a cap or a ticket list
 * takes a real booking — a seat in `sessionSeats/{sessionId}`, moved inside a
 * transaction that `firestore.rules` re-check — and everything else stays a
 * bookmark.
 *
 * ⚠️ This screen said "Session RSVP is not available yet" until 2026-09-20,
 * which stopped being true when the seat transaction shipped. It is a list, not
 * a second manager: bookings are opened by setting a cap in Session Cap or a
 * ticket list in Ticket Session Mapping, and the people are managed there.
 *
 * Treating the bookmark count as an RSVP count is still the mistake to avoid,
 * because the number looks plausible and systematically overstates attendance:
 * people save four parallel sessions and attend one. Only the seat counts below
 * are bookings.
 *
 * ── Reads ───────────────────────────────────────────────────────────────────
 *
 * `listSessions()` for the programme, `capacityIndex()` for caps and ticket
 * lists, `seatCounts()` for the counters. Each is a single
 * `where('eventId', '==', EVENT_ID)` sorted in memory, for the reason the two
 * screens it links to give: an `orderBy` would need a composite index this repo
 * does not declare, and the emulator would never show the failure.
 */
export default async function SessionRsvpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();

  const { page, baseParams } = listParams(await searchParams);
  const [sessions, caps, counts] = await Promise.all([listSessions(), capacityIndex(), seatCounts()]);

  // Cancelled sessions are dropped: a booking for something that is not
  // happening is not a number an organizer can act on.
  const live = sessions.filter((s) => s.status !== 'cancelled');

  const booking = live
    .filter((s) => caps.sessionCapacity.has(s.id) || caps.sessionTicketTypes.has(s.id))
    .map((s) => {
      const capacity = caps.sessionCapacity.get(s.id);
      const state = counts.get(s.id);
      return {
        session: s,
        capacity,
        tickets: caps.sessionTicketTypes.get(s.id),
        taken: state?.taken ?? 0,
        waiting: state?.waitlist.length ?? 0,
      };
    });

  // Fullest first, then by start time: the rows worth looking at are the ones
  // with people waiting behind them.
  const ordered = [...booking].sort(
    (a, b) =>
      b.waiting - a.waiting ||
      (b.capacity ? b.taken / b.capacity : 0) - (a.capacity ? a.taken / a.capacity : 0) ||
      a.session.startsAtLocal.localeCompare(b.session.startsAtLocal),
  );
  const pageRows = paginate(ordered, page, PER_PAGE);

  const capped = booking.filter((r) => r.capacity !== undefined);
  const seatsTaken = booking.reduce((n, r) => n + r.taken, 0);
  const seatsCapped = capped.reduce((n, r) => n + (r.capacity ?? 0), 0);
  const waitingTotal = booking.reduce((n, r) => n + r.waiting, 0);
  const full = capped.filter((r) => r.taken >= (r.capacity ?? 0));
  const byTicket = booking.filter((r) => r.tickets);

  return (
    <>
      <PageHeader
        title="Session RSVP"
        info={
          <>
            <strong>Which sessions take bookings</strong>
            <p>
              A session with a cap or a ticket limit takes a booking when an attendee adds it in the
              app. A full one offers a waitlist. Every other session stays a private bookmark that
              nothing counts.
            </p>
          </>
        }
        links={[
          <Link key="c" href="/attendees/session-cap">
            Session Cap
          </Link>,
          <Link key="m" href="/attendees/ticket-session-mapping">
            Ticket Session Mapping
          </Link>,
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      <Panel>
        <StatTiles
          tiles={[
            {
              label: 'Sessions taking bookings',
              value: booking.length,
              sub: `of ${live.length} in the programme`,
            },
            {
              label: 'Seats taken',
              value: seatsTaken,
              sub: seatsCapped ? `of ${seatsCapped} capped seats` : 'no caps set',
            },
            {
              label: 'Full sessions',
              value: full.length,
              sub: waitingTotal ? `${waitingTotal} waiting across them` : 'nobody waiting',
            },
            {
              label: 'Limited by ticket',
              value: byTicket.length,
              sub: 'only some tickets may book',
            },
          ]}
        />

        <Table
          stackSm
          cols={[
            { key: 't', label: 'Session', className: 'cell-fill' },
            { key: 'w', label: 'When', className: 'cell-sm' },
            { key: 'b', label: 'Booking', className: 'cell-md' },
            { key: 'n', label: 'Seats taken', className: 'cell-sm' },
            { key: 'm', label: '', className: 'cell-xs' },
          ]}
          empty="No session takes bookings yet. Set a cap or a ticket limit to open one."
          rows={pageRows.map((r) => [
            <span key="t">
              <strong>{r.session.title}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {r.session.format}
                {r.session.roomName ? ` · ${r.session.roomName}` : ''}
                {r.session.status !== 'published' ? ` · ${r.session.status}` : ''}
              </div>
            </span>,
            <span key="w" style={{ fontSize: 12 }}>
              {r.session.day}
              <div className="muted">
                {r.session.startsAtLocal.slice(11, 16)} to {r.session.endsAtLocal.slice(11, 16)}
              </div>
            </span>,
            <span key="b">
              {r.capacity ? `${r.capacity} places` : 'No cap'}
              <div className="muted" style={{ fontSize: 12 }}>
                {r.tickets ? joinNames(r.tickets) : 'Every ticket'}
              </div>
            </span>,
            <span key="n">
              <strong>{r.taken}</strong>
              {r.capacity ? ` of ${r.capacity}` : ''}
              {r.waiting > 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {r.waiting} waiting
                </div>
              ) : null}
              {r.capacity && seatFill(r.taken, r.capacity) !== 'open' ? (
                <div>
                  <Tag color={seatFill(r.taken, r.capacity) === 'over' ? 'red' : 'orange'} fill="outline" small>
                    {seatFill(r.taken, r.capacity) === 'over' ? 'over cap' : 'full'}
                  </Tag>
                </div>
              ) : null}
            </span>,
            <Link key="m" href={`/attendees/session-cap?session=${encodeURIComponent(r.session.id)}`}>
              Manage
            </Link>,
          ])}
        />
        <Pagination total={ordered.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>

      <Panel>
        <h2 className="section-header">Opening and closing bookings</h2>
        <p className="body-2" style={{ marginBottom: 0 }}>
          Set a cap on <Link href="/attendees/session-cap">Session Cap</Link> to open bookings, and
          choose which tickets may book on{' '}
          <Link href="/attendees/ticket-session-mapping">Ticket Session Mapping</Link>. Removing the
          cap and the ticket limit closes bookings again and gives everybody waiting a place.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No booking window.</strong> Bookings open the moment a cap is set and close when
            it is removed. Whova has an opening and closing time per session.
          </li>
          <li>
            <strong>No deadline on cancelling.</strong> An attendee can give up a seat at any time,
            including during the session, and it goes straight to the first person waiting.
          </li>
          <li>
            <strong>Bookmark counts are not shown anywhere</strong>, deliberately. A number labelled
            &ldquo;interested&rdquo; becomes a number somebody orders catering from.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
