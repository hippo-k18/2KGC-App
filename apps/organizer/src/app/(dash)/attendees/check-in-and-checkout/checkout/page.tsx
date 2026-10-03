import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { DEFAULT_LIST_ID, listRegistrations, listStations, recentCheckIns } from '@/lib/checkin';
import { ROUTES } from '@/lib/nav';
import { stampOfInstant } from '@/lib/time';
import { Email, GapPanel, PageHeader, Panel, StatTiles, Table } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Check-in & Checkout › Checkout.
 *
 * Whova's checkout is dashboard-only and never appears in the attendee app — it
 * exists so a venue can answer "how many people are in the building right now",
 * which is a fire-safety question rather than a marketing one.
 *
 * We record arrivals and nothing else. `CheckInDoc` is
 * `{ registrationId, checkedInAt, stationId, operatorUid? }` — there is no exit
 * field and no second document, so the number below is *ever checked in*, not
 * *currently present*. Those two are the same only on the first morning, and
 * the difference is exactly the number a fire marshal asks for. Every figure on
 * this page is therefore labelled as an arrival, and the one that would be an
 * occupancy count reads `—`.
 *
 * ── What building it would take, kept here rather than on the screen ────────
 *
 * Two shapes are plausible and they are not equivalent. A boolean or an
 * `outAt` field on the existing check-in document is one write and loses
 * history: somebody who leaves for lunch and returns overwrites their own
 * record, and the day's traffic is unrecoverable. A separate append-only
 * `movements` log, keyed for idempotency the way `scanEvents` already is, keeps
 * every crossing and makes occupancy a fold over it. The second is right and is
 * the more work.
 *
 * Whichever shape, the operational catch is unchanged: people leave without
 * scanning out. Occupancy derived from voluntary exits over-counts steadily
 * through the day, and an over-counting safety number is worse than an absent
 * one, because somebody will trust it. Any build of this needs an end-of-day
 * reset and a stated margin, not just a field.
 */
export default async function CheckoutPage() {
  await requireOrganizer();

  // A single `where('eventId', '==', …)` per collection with the rest done in
  // memory — an `orderBy` on a second field would need a composite index that
  // is not declared here, and the emulator does not enforce indexes, so it
  // would fail first in production rather than in a test.
  const [registrations, stations] = await Promise.all([listRegistrations(), listStations()]);
  const rows = registrations.map((r) => r.row);
  const { rows: recent, total: checkedIn } = await recentCheckIns(DEFAULT_LIST_ID, rows, stations);
  const active = rows.filter((r) => r.status === 'active').length;

  return (
    <>
      <PageHeader
        title="Checkout"
        info={
          <>
            <strong>Arrivals only</strong>
            <p>Checkout is not available yet. This page lists arrivals, not who is on site now.</p>
          </>
        }
        links={[
          <Link key="c" href={ROUTES.checkIn}>
            Attendee Check-in
          </Link>,
          <Link key="k" href="/attendees/check-in-and-checkout/kiosk-check-in">
            Kiosk Check-in
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Arrived', value: checkedIn },
          { label: 'Active registrations', value: active },
        ]}
      />

      <Panel>
        <h2 className="section-header">Arrivals at the main door ({checkedIn})</h2>
        <p className="body-2">
          Checkout is not available yet, so this list does not show who has left.
        </p>
        <Table
          cols={[
            { key: 'w', label: 'Arrived', className: 'cell-mdsm' },
            { key: 'n', label: 'Attendee', className: 'cell-md' },
            { key: 't', label: 'Ticket', className: 'cell-sm' },
            { key: 's', label: 'Station', className: 'cell-fill' },
          ]}
          empty="Nobody has checked in yet"
          rows={recent.map((c) => [
            <span key="w" style={{ whiteSpace: 'nowrap' }}>
              {c.checkedInAt ? stampOfInstant(c.checkedInAt) : '—'}
            </span>,
            <span key="n">
              <strong>{c.name}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                <Email address={c.email} />
              </div>
            </span>,
            c.ticketType ?? <span className="muted">—</span>,
            c.stationLabel || <span className="muted">—</span>,
          ])}
        />
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Checking anybody out.</strong> Nothing on this page writes. The scanner at{' '}
            <Link href={ROUTES.checkIn}>Attendee Check-in</Link> records arrivals only.
          </li>
          <li>
            <strong>Live occupancy.</strong> Needs exits, which need an append-only movement log,
            and even then needs a stated error margin for the people who leave without scanning.
          </li>
          <li>
            <strong>Re-entry counts.</strong> The current key —{' '}
            <code>checkIns/&#123;registrationId&#125;</code> — makes a second arrival an{' '}
            <code>already-exists</code> by design. That is the right behaviour for a door count and
            the wrong storage for a movement history.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
