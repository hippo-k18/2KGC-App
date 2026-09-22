import Link from 'next/link';
import { DEFAULT_LIST_ID, listCheckInLists, listStations } from '@/lib/checkin';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { PageHeader, Panel, Table, Tag } from '../../../ui';
import { Scanner } from '../check-in/scanner';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Check-in & Checkout › Kiosk Check-in.
 *
 * An unattended station: the same scanner, the same idempotent write, with the
 * operator's half of the screen taken away. Kiosk mode is subtraction — no
 * attendee table, no email addresses, no document paths, no scan ids, and a
 * verdict that clears itself after a few seconds so the next person in the
 * queue does not read the last one's name.
 *
 * ── It is a station, not self-service ───────────────────────────────────────
 *
 * The distinction matters and is easy to lose. `firestore.rules` denies every
 * client write under `checkInLists`, `scanEvents` and `checkInStations` — to
 * every client, organizers included — so that attendance cannot be
 * self-asserted, and this screen does not open that. The credential in front of
 * the write is still the organizer's dashboard session; what changed is that
 * the organizer has walked away from the tab. An attendee scanning here is
 * being counted by the organizer's station, which is the same claim a member of
 * staff makes at the desk, and it is why the honest name for the risk is "an
 * unattended screen anybody can queue at" rather than "attendees may check
 * themselves in".
 *
 * ── The station name is a query parameter ───────────────────────────────────
 *
 * Not a box on the screen. Whoever sets the kiosk up names it in the URL and
 * then leaves; a text input labelled "this station's name" facing a queue is a
 * field somebody eventually types into. The name is *not* written back to this
 * browser's `localStorage`, so borrowing a laptop for an afternoon does not
 * rename the desk station it uses the rest of the time.
 */
export default async function KioskCheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; station?: string }>;
}) {
  await requireOrganizer();

  const { list: listParam, station } = await searchParams;
  const [lists, stations] = await Promise.all([listCheckInLists(), listStations()]);

  /*
    The door is pinned by id rather than taken as `lists[0]`, the same rule the
    staffed screen follows: creating a list called "Day 2 door" moves it to the
    front alphabetically, and a kiosk that silently starts counting people into
    the wrong list is worse here than at the desk, because nobody is watching.
  */
  const selected =
    lists.find((l) => l.id === listParam) ??
    lists.find((l) => l.id === DEFAULT_LIST_ID) ??
    lists.find((l) => l.kind === 'event') ??
    lists[0];

  const stationName = (station ?? '').trim() || 'Kiosk 1';
  /*
   * One station document per *browser*, not per station: the scanner registers
   * the device it is running on, and a station name is what the person at the
   * desk typed. So a desk that has been opened on nine browsers listed "Console
   * desk 1" nine times, which reads as nine desks. Counted by name instead, and
   * the count is the useful number anyway — it is how many devices are pointed
   * at that desk.
   */
  const byName = new Map<string, number>();
  for (const label of stations.values()) byName.set(label, (byName.get(label) ?? 0) + 1);
  const known = [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <>
      <PageHeader
        title="Kiosk Check-in"
        info={
          <>
            <strong>An unattended check-in station</strong>
            <p>
              Lock the device to this page with Guided Access or a kiosk browser. Badge printing on
              scan is not available yet.
            </p>
          </>
        }
        tags={<Tag color="blue">{stationName}</Tag>}
        links={[
          <Link key="c" href={ROUTES.checkIn}>
            Attendee Check-in
          </Link>,
          <Link key="r" href="/attendees/check-in-and-checkout/session-self-check-in">
            Room doors
          </Link>,
          <Link key="b" href="/attendees/name-badges">
            Name Badges
          </Link>,
        ]}
      />

      <Panel>
        <h2 className="section-header">Set the kiosk up, then leave it</h2>
        {/*
          A plain GET form: naming a station and choosing a list produce a URL,
          which is the thing you actually want to hand to whoever is carrying
          the iPad to the far end of the foyer.
        */}
        <form method="get" className="toolbar">
          <label htmlFor="station" className="whova-form-label" style={{ marginBottom: 0 }}>
            Station name
          </label>
          <input
            id="station"
            name="station"
            className="whova-text-input whova-input-sm"
            defaultValue={stationName}
            autoComplete="off"
          />
          <label htmlFor="list" className="whova-form-label" style={{ marginBottom: 0 }}>
            Counting into
          </label>
          <select id="list" name="list" className="whova-text-input whova-input-lg" defaultValue={selected?.id}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.kind})
              </option>
            ))}
          </select>
          <button type="submit" className="whova-btn-main small">
            Apply
          </button>
        </form>
        <p className="body-2">
          Bookmark the address on the device after you press Apply. It keeps the station name and
          the list.
        </p>
      </Panel>

      <Panel>
        <h2 className="section-header">{selected ? selected.name : 'No check-in list'}</h2>
        {selected ? (
          <Scanner
            listId={selected.id}
            listName={selected.name}
            kiosk
            stationOverride={stationName}
          />
        ) : (
          <p className="body-2">
            No check-in list exists yet. Open one on{' '}
            <Link href={ROUTES.checkIn}>Attendee Check-in</Link>.
          </p>
        )}
      </Panel>

      <Panel>
        <h2 className="section-header">Stations that have scanned ({known.length})</h2>
        <Table
          cols={[
            { key: 'l', label: 'Station', className: 'cell-fill' },
            { key: 'd', label: 'Devices', className: 'cell-xsm' },
          ]}
          empty="No device has opened the scanner yet"
          rows={known.map(([label, count]) => [
            <strong key="l">{label}</strong>,
            <span key="d">{count}</span>,
          ])}
          stackSm={false}
        />
      </Panel>
    </>
  );
}
