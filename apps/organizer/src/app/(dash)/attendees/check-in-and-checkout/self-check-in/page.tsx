import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { DEFAULT_LIST_ID, listRegistrations, listStations, recentCheckIns } from '@/lib/checkin';
import { ROUTES } from '@/lib/nav';
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
            <p>
              Every client write under <code>checkInLists</code> is denied by{' '}
              <code>firestore.rules</code>, on purpose: a check-in is a fact witnessed by staff, not
              a claim made by whoever holds a phone. Use a kiosk station instead.
            </p>
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
          {
            label: 'Checked in',
            value: checkedIn,
            sub: checkedIn ? 'every one at a staffed or organizer-run station' : 'not inputted yet',
          },
          { label: 'Active registrations', value: active, sub: 'the denominator at the door' },
          { label: 'Self check-ins', value: 0, sub: 'the rule denies the write' },
        ]}
      />

      <Panel>
        <h2 className="section-header">Unattended check-in, the way it works here</h2>
        <p className="body-2">
          <Link href="/attendees/check-in-and-checkout/kiosk-check-in">Kiosk Check-in</Link> is the
          scanner with the operator&rsquo;s half removed: no attendee list, no addresses, no
          identifiers, and a verdict that clears itself. Set the station name, leave the device at
          the entrance, and it counts people into the door list.{' '}
          <Link href="/attendees/check-in-and-checkout/session-self-check-in">Room doors</Link> is
          the same station pointed at one session.
        </p>
        <p className="body-2">
          The difference from Whova&rsquo;s poster is who the write belongs to. A kiosk records
          what the organizer&rsquo;s station saw; a poster scanned on a personal phone records what
          the phone claimed. Only the first is evidence, and a certificate of attendance is
          eventually computed from it.
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
              {c.checkedInAt ? c.checkedInAt.slice(0, 16).replace('T', ' ') : '—'}
            </span>,
            <strong key="n">{c.name}</strong>,
            c.stationLabel || <span className="muted">—</span>,
          ])}
        />
      </Panel>
    </>
  );
}
