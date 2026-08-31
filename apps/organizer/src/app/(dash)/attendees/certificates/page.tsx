import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { attendeeAttendance, formatHours } from '@/lib/attendance';
import {
  DEFAULT_LIST_ID,
  listRegistrations,
  listStations,
  recentCheckIns,
} from '@/lib/checkin';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, GapTag, NotBuilt, PageHeader, Panel, StatTiles, Table } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Certificates.
 *
 * Attendance certificates are the feature that makes an event billable for
 * anyone claiming CPE or CE credit, and Whova sells them by the send: 1/10/10
 * templates and 500/1000/3000 emails depending on the package.
 *
 * None of that exists here, and the screen says so rather than showing a
 * template picker that writes nothing. What it *does* show is the half that is
 * real — who attended, evidenced by a check-in — because that is the input a
 * certificate run would take, and an organizer's first question about
 * certificates is always "how many people would get one".
 */
export default async function CertificatesPage() {
  await requireOrganizer();

  /**
   * One `where('eventId', '==', …)` and no `orderBy` beside it: a second field
   * would need a composite index this repo does not declare, and the emulator
   * does not enforce indexes, so it would pass here and fail in production with
   * `failed-precondition`. The counting happens in memory instead.
   */
  const [registrations, stations, hours] = await Promise.all([
    listRegistrations(),
    listStations(),
    attendeeAttendance(),
  ]);
  const rows = registrations.map((r) => r.row);
  const { rows: recent, total: attended } = await recentCheckIns(DEFAULT_LIST_ID, rows, stations);

  const active = rows.filter((r) => r.status === 'active');
  const noShows = active.length - attended;
  const totalMinutes = hours.rows.reduce((n, r) => n + r.minutes, 0);

  return (
    <>
      <PageHeader
        title="Certificates"
        tags={<GapTag />}
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="c" href={ROUTES.checkIn}>
            Check-in
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Nothing on this screen sends a certificate.</strong> There is no template store, no
        PDF renderer and no per-attendee mail merge in this project. The numbers below are the real
        attendance record and are shown because they are what a certificate run would read — not
        because a run can be started.
      </Banner>

      <StatTiles
        tiles={[
          {
            label: 'Would qualify',
            value: attended,
            sub: 'checked in at the door at least once',
          },
          {
            label: 'Registered, no check-in',
            value: noShows < 0 ? 0 : noShows,
            sub: `of ${active.length} active registrations`,
          },
          {
            label: 'With session hours',
            value: hours.rows.length,
            sub: `${hours.tracked} of ${hours.live} sessions counted`,
          },
          { label: 'Certificates sent', value: 0, sub: 'no sender exists' },
        ]}
      />

      <Panel>
        <h2 className="section-header">What attendance means here</h2>
        <p className="body-2">
          Two different records, and the difference between them is the difference between a
          certificate of attendance and a CPE certificate. A check-in on the door list says somebody
          came to the conference. A check-in on a <em>session</em> door — the Session card on{' '}
          <Link href={ROUTES.checkIn}>Check-in</Link> — says which room they were counted into, and
          that is what an hours claim is built from.
        </p>
        <Banner kind="warning">
          <strong>These are scheduled hours, not hours sat through.</strong> A badge scanned at the
          door of a 90-minute workshop credits 90 minutes whether the person stayed for all of it or
          left after ten. Nothing in this system records a departure:{' '}
          <code>checkIns/{'{registrationId}'}</code> makes a second scan an{' '}
          <code>already-exists</code> by design, and Checkout is unbuilt. An accrediting body that
          asks what the number measures has to be told &ldquo;presence at a door&rdquo;, and{' '}
          {hours.tracked} of {hours.live} sessions had a door at all.
        </Banner>

        <Table
          cols={[
            { key: 'w', label: 'Checked in', className: 'cell-mdsm' },
            { key: 'n', label: 'Attendee', className: 'cell-md' },
            { key: 't', label: 'Ticket', className: 'cell-sm' },
            { key: 's', label: 'Station', className: 'cell-fill' },
          ]}
          empty="Nobody has checked in yet — there is no attendance to certify"
          rows={recent.map((c) => [
            <span key="w" style={{ whiteSpace: 'nowrap' }}>
              {c.checkedInAt ? c.checkedInAt.slice(0, 16).replace('T', ' ') : '—'}
            </span>,
            <strong key="n">{c.name}</strong>,
            c.ticketType ?? <span className="muted">—</span>,
            c.stationLabel || <span className="muted">—</span>,
          ])}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          The twenty most recent, from the main door list. The count above is every check-in on it.
        </p>
      </Panel>

      <Panel>
        <div style={{ alignItems: 'baseline', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
          <h2 className="section-header" style={{ marginBottom: 0 }}>
            Hours by attendee ({hours.rows.length})
          </h2>
          {hours.rows.length > 0 ? (
            <a href="/export/attendance-hours" className="whova-btn-main small" download>
              Download CSV
            </a>
          ) : null}
        </div>
        <p className="body-2">
          Everyone counted into at least one session, and the scheduled length of the sessions they
          were counted into. This is the mail-merge input a certificate run would take —{' '}
          {totalMinutes > 0 ? formatHours(totalMinutes) : 'no hours'} across {hours.rows.length}{' '}
          {hours.rows.length === 1 ? 'attendee' : 'attendees'} so far.
        </p>
        <Table
          cols={[
            { key: 'n', label: 'Attendee', className: 'cell-md' },
            { key: 't', label: 'Ticket', className: 'cell-sm' },
            { key: 'c', label: 'Sessions', className: 'cell-xs' },
            { key: 'h', label: 'Scheduled hours', className: 'cell-sm' },
            { key: 's', label: 'Which', className: 'cell-fill' },
          ]}
          empty="Nobody has been counted into a session yet. Open a session door on Check-in first."
          rows={hours.rows.map((r) => [
            <span key="n">
              <strong>{r.registration.name}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {r.registration.email}
              </div>
            </span>,
            r.registration.ticketType ?? <span className="muted">—</span>,
            r.sessions.length,
            <strong key="h">{formatHours(r.minutes)}</strong>,
            <span key="s" className="muted" style={{ fontSize: 12 }}>
              {r.sessions.map((s) => s.title).join(' · ')}
            </span>,
          ])}
        />
      </Panel>

      <NotBuilt
        whova="Attendance certificates: 1/10/10 templates by package and 500/1000/3000 sends, often the CPE or CE requirement that makes an event billable in the first place."
        needs="A template store, a PDF renderer and a bulk sender. The sender is no longer the blocker it was — the ticket-receipt work put a real transactional path in @kgc/scripts/src/lib — but a per-attendee PDF generated on a laptop and posted to a thousand addresses is a job for a queue, and this dashboard has none."
        size="4–6 days, most of it the renderer and the retry behaviour around the send"
        refs="AGENTS.md, “The money path” — where the email templates live and why they are shared"
      />

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Time in the seat, as opposed to time at the door.</strong> Session hours are
            built and shown above, but they are the session&apos;s <em>scheduled</em> length. A
            departure is not recorded anywhere, so the number cannot be narrowed and should not be
            described as anything but arrivals. Closing this needs Checkout — an append-only
            movement log beside <code>checkIns</code> and a direction on the scanner.
          </li>
          <li>
            <strong>Coverage.</strong> A session only has hours if somebody opened its door. Nothing
            warns an organizer at 17:00 that four of the day&apos;s rooms were never scanned, which
            is when it is still fixable.
          </li>
          <li>
            <strong>Templates and branding.</strong> <code>badgeTemplates</code> is the nearest
            modelled thing and it is for badges. A certificate template is a second shape and
            nothing writes either.
          </li>
          <li>
            <strong>Bulk send and resend.</strong> No queue, no per-recipient status, no bounce
            handling. A certificate mailing is the one send where &ldquo;did it arrive&rdquo; is
            asked months later, so a sent log is not optional for it.
          </li>
          <li>
            <strong>Self-serve download.</strong> Whova lets an attendee fetch their own
            certificate. That is a route in the app plus a rule allowing a holder to read their own
            attendance, and today <code>checkIns</code> has no client rule at all.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
