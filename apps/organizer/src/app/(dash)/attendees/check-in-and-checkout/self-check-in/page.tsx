import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { DEFAULT_LIST_ID, listRegistrations, listStations, recentCheckIns } from '@/lib/checkin';
import { ROUTES } from '@/lib/nav';
import { stampOfInstant } from '@/lib/time';
import { PageHeader, Panel, StatTiles, Table } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Check-in & Checkout › Self Check-in.
 *
 * ── This one is absent by decision, and the decision is worth keeping ───────
 *
 * Whova publishes a self-check-in URL and a printable QR poster: an attendee
 * scans the poster on arrival and checks themselves in. Building that means
 * letting a client write under `checkInLists`, and `firestore.rules` denies
 * exactly that write to every client including organizers, with a test naming
 * the guarantee, precisely so attendance cannot be self-asserted.
 *
 * The argument against opening it is not squeamishness about a rule. `qrSecret`
 * is a long-lived bearer credential, accepted as such in AGENTS.md *because*
 * stealing one only gets you checked in as somebody who is then told "already
 * checked in at 09:12 at Front desk 1". Remove the member of staff and that
 * detection goes with them: the real attendee arrives, is told they are already
 * in, and nobody is standing there to ask why.
 *
 * ── What exists instead, and it is not a consolation prize ──────────────────
 *
 * A station the organizer operates and walks away from — Kiosk Check-in, and
 * per-room doors on Session Self Check-in. Same unattended screen from the
 * queue's side; the write is still made on the organizer's credential, which is
 * the property the rule exists to protect. This screen therefore shows what the
 * door has actually recorded and sends the reader to the station, rather than
 * offering a switch that would do nothing.
 */
export default async function SelfCheckInPage() {
  await requireOrganizer();

  // Single `where('eventId', '==', …)` per collection and no `orderBy` beside
  // it: a composite index this repo does not declare would pass on the emulator
  // and fail live with `failed-precondition`. Counting happens in memory.
  const [registrations, stations] = await Promise.all([listRegistrations(), listStations()]);
  const rows = registrations.map((r) => r.row);
  const { rows: recent, total: checkedIn } = await recentCheckIns(DEFAULT_LIST_ID, rows, stations);
  const active = rows.filter((r) => r.status === 'active').length;

  return (
    <>
      <PageHeader
        title="Self Check-in"
        info={
          <>
            <strong>Attendees cannot check themselves in</strong>
            <p>Check-in is done by staff or at a kiosk station. Set up a kiosk for an unattended door.</p>
          </>
        }
        links={[
          <Link key="c" href={ROUTES.checkIn}>
            Attendee Check-in
          </Link>,
          <Link key="k" href="/attendees/check-in-and-checkout/kiosk-check-in">
            Kiosk Check-in
          </Link>,
          <Link key="r" href="/attendees/check-in-and-checkout/session-self-check-in">
            Room doors
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Checked in', value: checkedIn },
          { label: 'Active registrations', value: active },
        ]}
      />

      <Panel>
        <p className="body-2" style={{ margin: 0 }}>
          Self check-in is not available yet. For a door with no staff, use{' '}
          <Link href="/attendees/check-in-and-checkout/kiosk-check-in">Kiosk Check-in</Link>. For a
          single session, use{' '}
          <Link href="/attendees/check-in-and-checkout/session-self-check-in">Room doors</Link>.
        </p>
      </Panel>

      <Panel>
        <h2 className="section-header">Recent arrivals at the main door ({checkedIn})</h2>
        <Table
          cols={[
            { key: 'w', label: 'When', className: 'cell-mdsm' },
            { key: 'n', label: 'Attendee', className: 'cell-md' },
            { key: 's', label: 'Station', className: 'cell-fill' },
          ]}
          empty="Nobody has checked in yet"
          rows={recent.map((c) => [
            <span key="w" style={{ whiteSpace: 'nowrap' }}>
              {c.checkedInAt ? stampOfInstant(c.checkedInAt) : '—'}
            </span>,
            <strong key="n">{c.name}</strong>,
            c.stationLabel || <span className="muted">—</span>,
          ])}
        />
      </Panel>
    </>
  );
}
