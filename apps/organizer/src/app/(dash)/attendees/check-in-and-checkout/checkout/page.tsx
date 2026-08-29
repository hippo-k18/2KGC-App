import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { DEFAULT_LIST_ID, listRegistrations, listStations, recentCheckIns } from '@/lib/checkin';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, GapTag, NotBuilt, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Check-in & Checkout › Checkout.
 *
 * Whova's checkout is dashboard-only and never appears in the attendee app —
 * it exists so a venue can answer "how many people are in the building right
 * now", which is a fire-safety question rather than a marketing one.
 *
 * We record arrivals and nothing else. `CheckInDoc` is
 * `{ registrationId, checkedInAt, stationId, operatorUid? }` — there is no exit
 * field and no second document, so the number below is *ever checked in*, not
 * *currently present*. Those two are the same only on the first morning, and
 * the difference is exactly the number a fire marshal asks for.
 */
export default async function CheckoutPage() {
  await requireOrganizer();

  // A single `where('eventId', '==', …)` per collection with the rest done in
  // memory — an `orderBy` on a second field would need a composite index that
  // is not declared here, and the emulator does not enforce indexes, so it
  // would fail first in production rather than in a test.
  const [registrations, stations] = await Promise.all([listRegistrations(), listStations()]);
  const rows = registrations.map((r) => r.row);
  const { total: checkedIn } = await recentCheckIns(DEFAULT_LIST_ID, rows, stations);
  const active = rows.filter((r) => r.status === 'active').length;

  return (
    <>
      <PageHeader
        title="Checkout"
        tags={<GapTag />}
        links={[
          <Link key="c" href={ROUTES.checkIn}>
            Attendee Check-in
          </Link>,
          <Link key="k" href="/attendees/check-in-and-checkout/kiosk-check-in">
            Kiosk Check-in
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Nobody can be checked out, and no number here means &ldquo;in the
        building&rdquo;.</strong> The check-in document has no exit field. Read the tile below as
        &ldquo;arrived at some point&rdquo; — treating it as an occupancy figure is the one misuse
        of this screen that could actually matter, because occupancy is a safety number.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Ever checked in', value: checkedIn, sub: 'arrivals, not occupancy' },
          { label: 'Active registrations', value: active, sub: 'expected over the whole event' },
          { label: 'Checked out', value: 0, sub: 'no exit is recorded' },
        ]}
      />

      <Panel>
        <h2 className="section-header">What checkout would be</h2>
        <p className="body-2">
          The same scan at the same desk with a direction on it. Two shapes are plausible and they
          are not equivalent. A boolean or an <code>outAt</code> field on the existing check-in
          document is one write and loses history: an attendee who leaves for lunch and returns
          overwrites their own record, and the day&rsquo;s traffic is unrecoverable. A separate{' '}
          <code>movements</code> append-only log keyed for idempotency the way{' '}
          <code>scanEvents</code> already is keeps every crossing, and occupancy becomes a fold over
          it. The second is the right one, and it is the more work.
        </p>
        <p className="body-2">
          Whichever shape, the operational catch is unchanged: people leave without scanning out.
          An occupancy figure derived from voluntary exits over-counts steadily through the day, and
          an over-counting safety number is worse than an absent one, because somebody will trust
          it. Any build of this needs an end-of-day reset and a stated margin, not just a field.
        </p>
      </Panel>

      <NotBuilt
        whova="A dashboard-only checkout that pairs with check-in so an organizer can see who is currently on site. Never exposed in the attendee app."
        needs="An append-only movement log beside checkIns, a direction on the scanner, and an honest treatment of unscanned exits."
        size="2–3 days for the write path; the reporting is the interesting part"
        refs="packages/shared/src/models.ts — CheckInDoc has no exit field today"
      />

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Checking anybody out.</strong> Nothing on this page writes. The scanner at{' '}
            <Link href={ROUTES.checkIn}>Attendee Check-in</Link> records arrivals only.
          </li>
          <li>
            <strong>Live occupancy.</strong> Needs exits, which need the above, and even then needs
            a stated error margin.
          </li>
          <li>
            <strong>Re-entry counts.</strong> The current key —{' '}
            <code>checkIns/{'{registrationId}'}</code> — makes a second arrival an{' '}
            <code>already-exists</code> failure by design. That is the right behaviour for a door
            count and the wrong storage for a movement history.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
