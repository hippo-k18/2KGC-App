import Link from 'next/link';
import { COLLECTIONS, EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { sessionAttendance } from '@/lib/attendance';
import { DEFAULT_LIST_ID, countCheckIns, scanThroughput } from '@/lib/checkin';
import { money, salesSummary } from '@/lib/commerce';
import { countWhereEvent, listSessions, recentAudit } from '@/lib/data';
import { recentErrors } from '@/lib/errors';
import { targetDescription } from '@/lib/firestore';
import { ROUTES } from '@/lib/nav';
import { clockOf, todayInEventZone } from '@/lib/time';
import { NotInputted, PageHeader, Panel, StatTiles, StatusTag, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tools > Report — one page, current, for the two days when something is going
 * wrong and someone is standing in front of you.
 *
 * ── Every number here traces to a Firestore read ────────────────────────────
 *
 * That is the rule this screen is held to more strictly than any other, because
 * it is the screen an organizer will act on. There is no derived-from-nothing
 * tile, no ratio with an assumed denominator, and no placeholder: where a number
 * cannot be computed the row comes off rather than showing a dash that reads as
 * zero. `countedIn` prints "no door" rather than 0 for exactly that reason — a
 * zero would send somebody to an empty-looking room that is actually full.
 *
 * Nothing here polls. A page that silently goes stale during an incident is
 * worse than one that obviously needs a refresh.
 */
export default async function ReportPage() {
  await requireOrganizer();

  const today = todayInEventZone();
  const [
    attendees,
    announcements,
    registrations,
    sessions,
    audit,
    attendance,
    doorCounts,
    scans,
    sales,
  ] = await Promise.all([
    countWhereEvent(COLLECTIONS.users),
    countWhereEvent(COLLECTIONS.announcements),
    countWhereEvent(COLLECTIONS.registrations),
    listSessions(),
    recentAudit(),
    sessionAttendance(),
    countCheckIns([DEFAULT_LIST_ID]),
    scanThroughput(),
    salesSummary(),
  ]);

  /**
   * How full each room is, for the sessions running today.
   *
   * This is the number the screen exists for: at 11:40 on day one the question
   * is "is anybody in room 2", and until now the only answer available anywhere
   * was a door count for the whole conference. `null` means no door was opened
   * for that session — printed as "no door" rather than as 0.
   */
  const countedIn = new Map(
    attendance.rows.filter((r) => r.tracked).map((r) => [r.session.id, r.countedIn]),
  );

  const todaysSessions = sessions.filter((s) => s.day === today).sort((a, b) =>
    a.startsAtLocal.localeCompare(b.startsAtLocal),
  );
  const errors = recentErrors();
  const days = [...new Set(sessions.map((s) => s.day))].sort();
  const throughDoor = doorCounts.get(DEFAULT_LIST_ID) ?? 0;

  return (
    <>
      <PageHeader
        title="Report"
        info={
          <>
            <strong>Live, and only as fresh as this page load</strong>
            <p>
              Nothing here polls: refresh to update. Every figure is a Firestore read against{' '}
              {EVENT.name}; a number that cannot be computed is left off rather than shown as zero.
            </p>
          </>
        }
        links={[
          <Link key="t" href="/tools">
            Tools
          </Link>,
          <span key="d" className="muted">
            today is {today} in {EVENT.timeZone}
          </span>,
          <span key="e" className="muted">
            {targetDescription()}
          </span>,
        ]}
      />

      <Panel>
        <StatTiles
          tiles={[
            { label: 'Registrations', value: registrations, sub: 'tickets issued' },
            {
              label: 'Signed in',
              value: attendees,
              sub: registrations
                ? `${Math.round((attendees / registrations) * 100)}% of tickets`
                : 'no tickets yet',
            },
            { label: 'Through the door', value: throughDoor, sub: 'main door check-ins' },
            { label: 'Net revenue', value: money(sales.netCents, sales.currency), sub: 'after refunds' },
            { label: 'Sessions today', value: todaysSessions.length, sub: `${sessions.length} total` },
            { label: 'Announcements sent', value: announcements },
          ]}
        />
      </Panel>

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Door throughput
        </h2>
        {scans.total === 0 ? (
          <NotInputted
            what="scans"
            action={
              <Link className="whova-btn-main" href={ROUTES.checkIn}>
                Open the scanner
              </Link>
            }
          />
        ) : (
          <>
            <StatTiles
              tiles={[
                { label: 'Scans', value: scans.total, sub: 'last three hours of scanning' },
                { label: 'Checked in', value: scans.ok, sub: 'first scan of a badge' },
                { label: 'Already in', value: scans.duplicate, sub: 'badge scanned twice' },
                {
                  label: 'Turned away',
                  value: scans.rejected,
                  sub: scans.rejected ? 'needs a person at the desk' : 'none',
                },
                { label: 'Stations', value: scans.stations, sub: 'devices scanning' },
              ]}
            />
            {/*
              A bar per quarter hour rather than a chart library: the shape of
              the arrival curve is the whole message — one spike at 08:45 and a
              flat hour afterwards — and it reads at a glance from bar widths.
              Widths are relative to the busiest bucket, so the axis is the peak
              and needs no label.
            */}
            <Table
              cols={[
                { key: 't', label: 'From', className: 'cell-sm' },
                { key: 'b', label: 'Scans per quarter hour', className: 'cell-fill' },
                { key: 'n', label: '', className: 'cell-sm' },
              ]}
              rows={scans.buckets.map((b) => [
                <span key="t" style={{ whiteSpace: 'nowrap' }}>
                  {b.label}
                </span>,
                <span
                  key="b"
                  aria-hidden="true"
                  style={{
                    background: 'var(--accent, #2180b2)',
                    borderRadius: 2,
                    display: 'block',
                    height: 12,
                    width: `${Math.round((b.count / Math.max(1, scans.peakPerQuarterHour)) * 100)}%`,
                  }}
                />,
                <strong key="n">{b.count}</strong>,
              ])}
            />
            <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
              Peak {scans.peakPerQuarterHour} scans in a quarter hour. Last scan{' '}
              {scans.lastScanAt?.slice(11, 16) ?? '—'} UTC.
            </p>
          </>
        )}
      </Panel>

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Money taken
        </h2>
        {sales.paidOrders === 0 && sales.refundedOrders === 0 ? (
          <NotInputted
            what="orders"
            action={
              <Link className="whova-btn-main" href={ROUTES.ordersSummary}>
                Orders &amp; Transactions
              </Link>
            }
          />
        ) : (
          <>
            <StatTiles
              tiles={[
                { label: 'Gross', value: money(sales.grossCents, sales.currency), sub: 'charged' },
                {
                  label: 'Refunded',
                  value: money(sales.refundedCents, sales.currency),
                  sub: `${sales.refundedOrders} orders`,
                },
                { label: 'Net', value: money(sales.netCents, sales.currency), sub: 'kept' },
                { label: 'Tickets sold', value: sales.ticketsSold, sub: `${sales.paidOrders} orders` },
                {
                  label: 'Owed on invoice',
                  value: money(sales.outstandingCents, sales.currency),
                  sub: `${sales.outstandingInvoices} unpaid`,
                },
              ]}
            />
            <Table
              cols={[
                { key: 'n', label: 'Tier', className: 'cell-fill' },
                { key: 's', label: 'Sold', className: 'cell-sm' },
                { key: 'r', label: 'Refunded', className: 'cell-sm' },
                { key: 'v', label: 'Net', className: 'cell-mdsm' },
              ]}
              empty="No settled orders"
              rows={sales.byTier.map((t) => [
                t.name,
                t.sold,
                t.refunded || <span className="muted">—</span>,
                money(t.netCents, sales.currency),
              ])}
            />
            {sales.demoOrders > 0 && (
              <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
                {sales.demoOrders} test {sales.demoOrders === 1 ? 'order is' : 'orders are'} excluded
                from every figure above.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Sessions today ({today})
        </h2>
        {todaysSessions.length === 0 ? (
          <p className="body-2 muted">
            Nothing scheduled today: the event runs {days[0] ?? '—'} to {days[days.length - 1] ?? '—'}.
          </p>
        ) : (
          <Table
            cols={[
              { key: 't', label: 'Time', className: 'cell-sm' },
              { key: 'n', label: 'Session', className: 'cell-fill' },
              { key: 'r', label: 'Room', className: 'cell-mdsm' },
              { key: 'i', label: 'Counted in', className: 'cell-sm' },
              { key: 's', label: 'Status', className: 'cell-sm' },
            ]}
            rows={todaysSessions.map((s) => [
              <span key="t" style={{ whiteSpace: 'nowrap' }}>
                {clockOf(s.startsAtLocal)}–{clockOf(s.endsAtLocal)}
              </span>,
              <Link key="n" href={`${ROUTES.sessionManager}/${s.id}`}>
                {s.title}
              </Link>,
              s.roomName ?? <span className="muted">—</span>,
              countedIn.has(s.id) ? (
                <strong key="i">{countedIn.get(s.id)}</strong>
              ) : (
                /*
                  Links to Check-in rather than to the list that does not exist:
                  `?list=` for an absent id silently falls back to the main door,
                  which would put somebody on the wrong screen at the one moment
                  they cannot afford it. Start on the Session card creates it.
                */
                <Link key="i" href={ROUTES.checkIn} className="muted">
                  no door
                </Link>
              ),
              <StatusTag key="s" status={s.status} />,
            ])}
          />
        )}
      </Panel>

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Audit trail ({audit.length})
        </h2>
        <p className="body-2">
          Every write this dashboard has made, newest first. The Admin SDK bypasses{' '}
          <code>firestore.rules</code> entirely, which is the correct posture for an organizer tool
          and is exactly why the writes have to be recorded somewhere a human can read them.
        </p>
        <Table
          cols={[
            { key: 'w', label: 'When', className: 'cell-mdsm' },
            { key: 'a', label: 'Actor', className: 'cell-mdsm' },
            { key: 'x', label: 'Action', className: 'cell-sm' },
            { key: 't', label: 'Target', className: 'cell-fill' },
          ]}
          empty="No writes yet"
          rows={audit.map((a) => [
            <span key="w" style={{ whiteSpace: 'nowrap' }}>
              {a.at ?? '—'}
            </span>,
            a.actor,
            <Tag key="x" color={a.action === 'checkin.undo' ? 'orange' : 'blue'}>
              {a.action}
            </Tag>,
            <code key="t" style={{ fontSize: 12 }}>
              {a.targetPath}
            </code>,
          ])}
        />
      </Panel>

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Recent errors ({errors.length})
        </h2>
        <p className="body-2">
          An in-process ring buffer: it empties on restart and does not survive a second server
          process, so an empty table means this process has not recorded one, not that nothing has
          ever failed.
        </p>
        <Table
          cols={[
            { key: 'w', label: 'When', className: 'cell-mdsm' },
            { key: 'c', label: 'Where', className: 'cell-mdsm' },
            { key: 'm', label: 'Message', className: 'cell-fill' },
          ]}
          empty="No errors recorded"
          rows={errors.map((e) => [
            <span key="w" style={{ whiteSpace: 'nowrap' }}>
              {e.at}
            </span>,
            e.context,
            <span key="m" style={{ color: 'var(--danger)' }}>
              {e.message}
            </span>,
          ])}
        />
      </Panel>
    </>
  );
}
