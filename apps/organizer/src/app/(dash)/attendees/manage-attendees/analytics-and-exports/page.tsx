import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
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
export default async function AnalyticsAndExportsPage() {
  await requireOrganizer();
  const a = await eventAnalytics();

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
          This is the
          number worth moving before doors open — an attendee without the app has no agenda, no
          badge QR, and has to be checked in by hand at the desk.
        </p>

        <Table
          cols={[
            { key: 'g', label: 'Group', className: 'cell-fill' },
            { key: 'n', label: 'People', className: 'cell-sm' },
          ]}
          rows={a.bySignup.map((r) => [r.label, r.count])}
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
            />
          </div>
        </div>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Exports</h2>

        <Banner kind="warning">
          <strong>These files contain personal data and leave the building.</strong> Each one names
          what it contains below — send the narrowest that answers the question. Badge secrets and
          claim codes are in <em>no</em> export: either one is a working credential, and a
          spreadsheet forwarded to a supplier would become a set of usable tickets.
        </Banner>

        <Table
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
            <a key="d" href={`/export/${e.kind}`} className="whova-btn-main" download>
              Download
            </a>,
          ])}
        />

        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
          Every field is escaped against spreadsheet formula injection — a cell beginning{' '}
          <code>=</code> is neutralised, because an attendee can type one into a registration form
          and Excel would otherwise run it. Files are UTF-8 with a byte-order mark so accented
          names survive Excel on Windows.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Session-level attendance.</strong> Whova reports who attended which session,
            which needs per-session check-in — the scanner writes event-door check-ins only.
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
