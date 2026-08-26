import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import {
  DEFAULT_LIST_ID,
  listRegistrations,
  listStations,
  recentCheckIns,
} from '@/lib/checkin';
import { ROUTES } from '@/lib/nav';
import { Banner, NotBuilt, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';

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
  const [registrations, stations] = await Promise.all([listRegistrations(), listStations()]);
  const rows = registrations.map((r) => r.row);
  const { rows: recent, total: attended } = await recentCheckIns(DEFAULT_LIST_ID, rows, stations);

  const active = rows.filter((r) => r.status === 'active');
  const noShows = active.length - attended;

  return (
    <>
      <PageHeader
        title="Certificates"
        tags={<Tag color="grey">not built</Tag>}
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
          { label: 'Certificates sent', value: 0, sub: 'no sender exists' },
        ]}
      />

      <Panel>
        <h2 className="section-header">What attendance means here</h2>
        <p className="body-2">
          A check-in on the door list, and nothing finer. The scanner writes{' '}
          <code>checkInLists/{'{listId}'}/checkIns/{'{registrationId}'}</code> for the event door;
          it does not record which sessions somebody sat in, so this dashboard cannot substantiate
          a claim of the form &ldquo;attended 6.5 hours of qualifying content&rdquo;. That
          distinction is the whole of the difference between a certificate of attendance, which the
          data below could support, and a CPE certificate, which it cannot.
        </p>

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

      <NotBuilt
        whova="Attendance certificates: 1/10/10 templates by package and 500/1000/3000 sends, often the CPE or CE requirement that makes an event billable in the first place."
        needs="A template store, a PDF renderer and a bulk sender. The sender is no longer the blocker it was — the ticket-receipt work put a real transactional path in @kgc/scripts/src/lib — but a per-attendee PDF generated on a laptop and posted to a thousand addresses is a job for a queue, and this dashboard has none."
        size="4–6 days, most of it the renderer and the retry behaviour around the send"
        refs="AGENTS.md, “The money path” — where the email templates live and why they are shared"
      />

      <Panel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Session-level attendance.</strong> A certificate that names hours needs
            per-session check-in. The engine would take it — a session scope is just another{' '}
            <code>checkInLists</code> document — but nothing creates one per session today, so the
            hours do not exist to print.
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
      </Panel>
    </>
  );
}
