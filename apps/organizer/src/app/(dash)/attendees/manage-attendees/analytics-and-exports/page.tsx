import Link from 'next/link';
import { attendeeCategories } from '@/lib/attendee-categories';
import { UNCATEGORISED } from '@/lib/attendee-categories-core';
import { requireOrganizer } from '@/lib/auth';
import { formatHours, sessionAttendance } from '@/lib/attendance';
import { EXPORTS, eventAnalytics } from '@/lib/exports';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, ProgressBar, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Manage Attendees › Analytics & Exports.
 *
 * Two jobs on one screen, which is how Whova has it: the numbers an organizer
 * watches, and the spreadsheets they hand to other people.
 *
 * ── App adoption leads ──────────────────────────────────────────────────────
 *
 * Every other figure here is a fact about the past. Adoption is the one an
 * organizer can still change in the fortnight before doors open — and the
 * lever for changing it is one click away (Message Speakers, announcements),
 * which is why it is a bar and not a row in a table.
 *
 * ── Exports say what they contain before you click ──────────────────────────
 *
 * These files get emailed to badge printers and caterers, so each one names its
 * columns and its purpose on screen. The narrow supplier list exists precisely
 * so nobody sends the full attendee export — with every email address on it —
 * to a company that asked for a headcount.
 */
export default async function AnalyticsAndExportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const category = typeof sp.category === 'string' ? sp.category : '';
  const [a, attendance, { categories }] = await Promise.all([
    eventAnalytics(),
    sessionAttendance(),
    attendeeCategories(),
  ]);
  // Only the two attendee files have a category to filter on.
  const exportHref = (kind: string) =>
    category && (kind === 'attendees' || kind === 'catering')
      ? `/export/${kind}?category=${encodeURIComponent(category)}`
      : `/export/${kind}`;

  // Sessions somebody actually counted, busiest first. Untracked rooms are a
  // separate figure rather than a run of zeroes at the bottom of the table:
  // "nobody came" and "nobody was counting" look identical as a number and are
  // opposite as a fact.
  const counted = attendance.rows
    .filter((r) => r.tracked)
    .sort(
      (x, y) =>
        y.countedIn - x.countedIn || x.session.startsAtLocal.localeCompare(y.session.startsAtLocal),
    );

  return (
    <>
      <PageHeader
        title="Analytics & Exports"
        tags={<Tag color="blue">{a.attendees} attendees</Tag>}
        links={[
          <Link key="at" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="ci" href={ROUTES.checkIn}>
            Check-in
          </Link>,
          <Link key="or" href={ROUTES.ordersSummary}>
            Orders summary
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Attendees', value: a.attendees, sub: `${a.ticketHolders} holding a ticket` },
          {
            label: 'App adoption',
            value: `${a.adoptionPct}%`,
            sub: `${a.ticketHoldersSignedIn} of ${a.ticketHolders} ticket holders`,
          },
          { label: 'Net revenue', value: a.revenueNet, sub: `${a.refunded} refunded` },
          {
            label: 'In the directory',
            value: a.inDirectory,
            sub: a.optedOut > 0 ? `${a.optedOut} opted out` : 'nobody opted out',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>App adoption</h2>
        <ProgressBar pct={a.adoptionPct} />
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {a.ticketHolders - a.ticketHoldersSignedIn} ticket holders have not opened the app yet.
          Without the app they have no badge code and are checked in by name.
        </p>

        <Table
          cols={[
            { key: 'g', label: 'Group', className: 'cell-fill' },
            { key: 'n', label: 'People', className: 'cell-sm' },
          ]}
          rows={a.bySignup.map((r) => [r.label, r.count])}
          stackSm={false}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Breakdown</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <h3 style={{ fontSize: 13 }}>By ticket type</h3>
            <Table
              cols={[
                { key: 't', label: 'Ticket', className: 'cell-fill' },
                { key: 'n', label: 'Held', className: 'cell-sm' },
              ]}
              rows={a.byTicket.map((r) => [r.label, r.count])}
              empty="No tickets issued yet."
              stackSm={false}
            />
          </div>
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <h3 style={{ fontSize: 13 }}>Top organisations</h3>
            <Table
              cols={[
                { key: 'c', label: 'Company', className: 'cell-fill' },
                { key: 'n', label: 'People', className: 'cell-sm' },
              ]}
              rows={a.byCompanyTop.map((r) => [r.label, r.count])}
              empty="Nobody has filled in a company yet."
              stackSm={false}
            />
          </div>
        </div>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Session attendance</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          Counted at the door of each session. {attendance.tracked} of {attendance.live} sessions
          have had check-in opened.{' '}
          {attendance.tracked === 0 ? (
            <>
              Open one from <Link href={ROUTES.checkIn}>Check-in</Link> with Start under Check-in
              for the session.
            </>
          ) : (
            <>
              Sessions with no door opened are left out of the table.
            </>
          )}
        </p>

        {attendance.tracked > 0 ? (
          <Table
            cols={[
              { key: 's', label: 'Session', className: 'cell-fill' },
              { key: 'w', label: 'When', className: 'cell-sm' },
              { key: 'r', label: 'Room', className: 'cell-mdsm cell-truncate' },
              { key: 'l', label: 'Length', className: 'cell-xs' },
              { key: 'c', label: 'Counted in', className: 'cell-xs' },
            ]}
            rows={counted.map((r) => [
              <span key="s">
                <strong>{r.session.title}</strong>
                {r.session.primaryTrackName ? (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.session.primaryTrackName}
                  </div>
                ) : null}
              </span>,
              <span key="w" style={{ fontSize: 12 }}>
                {r.session.day}
                <div className="muted">{r.session.startsAtLocal.slice(11, 16)}</div>
              </span>,
              r.session.roomName ?? <span className="muted">—</span>,
              formatHours(r.minutes),
              <strong key="c">{r.countedIn}</strong>,
            ])}
            empty="No session door has been opened yet."
          />
        ) : null}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Exports</h2>

        <Banner kind="warning">
          <strong>These files contain personal data.</strong> Share the smallest one that does the
          job. No export includes badge codes.
        </Banner>

        <form id="exports" method="get" action="#exports" className="toolbar" style={{ alignItems: 'center', marginTop: 12 }}>
          <label htmlFor="export-category" className="body-2">
            Attendee files include
          </label>
          <select
            id="export-category"
            name="category"
            className="whova-text-input"
            defaultValue={category}
            style={{ width: 200 }}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={UNCATEGORISED}>No category</option>
          </select>
          <button type="submit" className="btn btn-default">
            Apply
          </button>
        </form>

        {/* On a phone each export is a card, so what it is for stays beside the button. */}
        <div className="exports-table">
          <Table
            stackSm
            cols={[
              { key: 'n', label: 'Export', className: 'cell-md' },
              { key: 'p', label: 'What it is for', className: 'cell-fill' },
              { key: 'c', label: 'Columns', className: 'cell-fill' },
              { key: 'd', label: '', className: 'cell-sm' },
            ]}
            rows={EXPORTS.map((e) => [
              <strong key="n">{e.title}</strong>,
              <span key="p" style={{ fontSize: 13 }}>
                {e.purpose}
              </span>,
              <span key="c" className="muted" style={{ fontSize: 12 }}>
                {e.contains}
              </span>,
              /*
                A plain link, not a form. A CSV download is a GET that changes
                nothing, and `download` plus a real Content-Disposition is what
                makes the browser save it rather than render it.
              */
              <a key="d" href={exportHref(e.kind)} className="whova-btn-main secondary small" download>
                Download
              </a>,
            ])}
          />
        </div>

        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
          Files are UTF-8 CSV and open in Excel and Google Sheets.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Dwell time.</strong> Session attendance above is arrivals. Nothing records a
            departure — <code>checkIns/&#123;registrationId&#125;</code> makes a second scan an{' '}
            <code>already-exists</code> by design, and Checkout is unbuilt — so &ldquo;counted in&rdquo;
            credits the whole scheduled length whether somebody stayed or left after ten minutes.
            Every hours figure in this dashboard carries that caveat.
          </li>
          <li>
            <strong>Popularity before the event.</strong> These numbers exist only after a door has
            been scanned. A saved session is a private bookmark under{' '}
            <code>users/&#123;uid&#125;/savedSessions</code> that an organizer cannot enumerate, so
            there is no way to see which sessions are filling up in advance.
          </li>
          <li>
            <strong>Engagement scores and leaderboards.</strong> These derive from counters that
            Cloud Function triggers maintain, and the project is on the Spark plan.
          </li>
          <li>
            <strong>Cross-event reporting.</strong> Needs a second event to compare against.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
