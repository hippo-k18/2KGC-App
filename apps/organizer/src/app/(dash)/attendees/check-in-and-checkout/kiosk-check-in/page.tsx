import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listStations } from '@/lib/checkin';
import { ROUTES } from '@/lib/nav';
import { Banner, NotBuilt, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Check-in & Checkout › Kiosk Check-in.
 *
 * Whova's kiosk is an iPad app with a badge printer attached and a paid add-on
 * beside it. The part of that this repo has is the engine: the check-in write
 * is idempotent and keyed by registration, the scan log names the device, and
 * `checkInStations/{deviceId}` already exists so a station that reloads is the
 * same station. What is missing is a second client and a printer.
 *
 * The stations table below is real — every device that has ever opened the
 * scanner is in it — because the honest framing of this screen is "you already
 * have unattended-capable stations, what you do not have is the unattended
 * part", and that reads better as a list of actual devices than as prose.
 */
export default async function KioskCheckInPage() {
  await requireOrganizer();

  // One `where('eventId', '==', …)`, sorted in memory: adding an `orderBy` on a
  // second field needs a composite index that is not declared here, and the
  // emulator would not tell us — it fails first in production.
  const stations = await listStations();
  const rows = [...stations.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <>
      <PageHeader
        title="Kiosk Check-in"
        tags={<Tag color="grey">not built</Tag>}
        links={[
          <Link key="c" href={ROUTES.checkIn}>
            Attendee Check-in
          </Link>,
          <Link key="s" href="/attendees/check-in-and-checkout/self-check-in">
            Self Check-in
          </Link>,
          <Link key="b" href="/attendees/name-badges">
            Name Badges
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>There is no kiosk mode.</strong> The desk scanner at{' '}
        <Link href={ROUTES.checkIn}>Attendee Check-in</Link> is a staffed screen: it shows names,
        emails and a full attendee table, none of which may be left facing a queue. Running it
        unattended would turn the check-in desk into a public attendee directory.
      </Banner>

      <Panel>
        <h2 className="section-header">Stations that have scanned ({rows.length})</h2>
        <p className="body-2">
          <code>checkInStations</code> is keyed by device rather than generated per session, so a
          station that reloads the page is still the same station and a duplicate scan can name
          where it happened. That is the piece a kiosk needs and the piece that already works.
        </p>
        <Table
          cols={[
            { key: 'l', label: 'Label', className: 'cell-md' },
            { key: 'd', label: 'Device id', className: 'cell-fill' },
          ]}
          empty="No device has opened the scanner yet"
          rows={rows.map(([id, label]) => [
            <strong key="l">{label}</strong>,
            <code key="d" style={{ fontSize: 12 }}>
              {id}
            </code>,
          ])}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">What a kiosk would need beyond this</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>A screen that shows nothing.</strong> Kiosk mode is mostly subtraction: no
            attendee list, no email addresses, no search, one line of feedback and then a reset on a
            timer. The scanner component would need a variant that renders a verdict and forgets it.
          </li>
          <li>
            <strong>A way to lock the device.</strong> Guided Access on an iPad, or a kiosk browser.
            That is configuration on the hardware, not code here.
          </li>
          <li>
            <strong>A printer.</strong> <code>badgeTemplates</code> holds raw ZPL sent to a printer
            over TCP port 9100 — a socket a browser tab cannot open at all. A kiosk that prints
            needs a small local agent beside the printer, and that is the genuinely new component.
          </li>
        </ul>
      </Panel>

      <NotBuilt
        whova="An iPad kiosk app with badge printing and a kiosk activity dashboard. Paid add-on."
        needs="A stripped-down unattended client on the existing check-in write path, plus a local print agent, because ZPL over a raw socket is not reachable from a browser."
        size="5–8 days, and the printer half is most of it"
        refs="packages/shared/src/models.ts — BadgeTemplateDoc, BadgePrintJobDoc"
      />

      <Panel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Unattended check-in of any kind.</strong> Nothing on this page scans, and the
            desk scanner is the only thing in this project that writes a check-in.
          </li>
          <li>
            <strong>The kiosk activity dashboard.</strong> Whova reports per-kiosk throughput. The
            raw material exists — <code>scanEvents</code> names the device on every scan — so this
            is a query and a chart, but it is not written.
          </li>
          <li>
            <strong>On-demand badge printing.</strong> Modelled, inert, and blocked on the local
            agent above. Printing today is the sheet at{' '}
            <Link href="/attendees/name-badges">Name Badges</Link>, run in advance from a browser.
          </li>
        </ul>
      </Panel>
    </>
  );
}
