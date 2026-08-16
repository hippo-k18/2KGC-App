import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import {
  DEFAULT_LIST_ID,
  listCheckInLists,
  listRegistrations,
  listStations,
  recentCheckIns,
  recentScanEvents,
} from '@/lib/checkin';
import { CreateListForm } from './list-form';
import { Scanner } from './scanner';

export const dynamic = 'force-dynamic';

/**
 * Attendees > Attendee Check-in > Check-in — §14.
 *
 * The end of the loop the website starts: the site sells a ticket and writes
 * `registrations/{opaqueId}` with a `qrSecret` and a `claimCode`; the app claims
 * it by email and renders the `qrSecret` as a badge QR; this screen scans that
 * QR and writes `checkInLists/{listId}/checkIns/{registrationId}`.
 *
 * Whova's version of this screen also does day scope and session scope. Ours
 * does event scope, because a day or a session is just another
 * `checkInLists` document and the scanner does not care which one is selected —
 * what is actually missing is the UI that creates one per day and per session
 * and picks the right one automatically, not the engine.
 */
export default async function CheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  await requireOrganizer();

  const { list: listParam } = await searchParams;
  const lists = await listCheckInLists();

  /**
   * The default is the seeded door, by id — never "whatever sorts first".
   *
   * An earlier version took `lists[0]`, and creating a second list called
   * "Day 2 door" moved it to the front alphabetically: the page then loaded
   * showing that list's zero check-ins against fifty registrations. At 08:55 on
   * day one that reads as "the tool has lost everyone", and the recovery is to
   * notice a filter chip. The door is pinned instead.
   */
  const selected =
    lists.find((l) => l.id === listParam) ??
    lists.find((l) => l.id === DEFAULT_LIST_ID) ??
    lists.find((l) => l.kind === 'event') ??
    lists[0];

  const [registrations, stations] = await Promise.all([listRegistrations(), listStations()]);
  const rows = registrations.map((r) => r.row);

  const [{ rows: checkIns, total: checkedIn }, scans] = await Promise.all([
    recentCheckIns(selected.id, rows, stations),
    recentScanEvents(selected.id),
  ]);

  const active = rows.filter((r) => r.status === 'active').length;
  const pct = active ? Math.round((checkedIn / active) * 100) : 0;

  return (
    <>
      <p className="crumbs">
        <Link href="/attendees">Attendees</Link> {' › '}
        <Link href="/attendees/attendee-check-in">Attendee Check-in</Link> {' › '}
      </p>
      <h1>Check-in (Event / Day / Session)</h1>
      <p className="muted">
        Event scope, against <code>{selected.name}</code>. Scan a badge QR or type the code — a{' '}
        <code>qrSecret</code> or a six-character <code>claimCode</code>, both accepted.
      </p>

      <div className="filters">
        {lists.map((l) => (
          <Link key={l.id} href={`?list=${l.id}`} aria-current={l.id === selected.id}>
            {l.name} <span className="muted">({l.kind})</span>
          </Link>
        ))}
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="n">{checkedIn}</div>
          <div className="muted">checked in</div>
        </div>
        <div className="tile">
          <div className="n">{active}</div>
          <div className="muted">active registrations</div>
        </div>
        <div className="tile">
          <div className="n">{pct}%</div>
          <div className="muted">of the door</div>
        </div>
        <div className="tile">
          <div className="n">{rows.length - active}</div>
          <div className="muted">cancelled / transferred</div>
        </div>
      </div>

      <Scanner listId={selected.id} listName={selected.name} />

      <h2>Recent check-ins ({checkedIn})</h2>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Name</th>
            <th>Ticket</th>
            <th>Station</th>
            <th>Registration</th>
          </tr>
        </thead>
        <tbody>
          {checkIns.map((c) => (
            <tr key={c.registrationId}>
              <td style={{ whiteSpace: 'nowrap' }}>
                {c.checkedInAt ? new Date(c.checkedInAt).toLocaleTimeString() : '—'}
              </td>
              <td>
                <strong>{c.name}</strong>
                <div className="muted">{c.email}</div>
              </td>
              <td>{c.ticketType ?? <span className="muted">—</span>}</td>
              <td>{c.stationLabel}</td>
              <td>
                <code>{c.registrationId}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {checkIns.length === 0 ? (
        <p className="muted">Nobody has been checked in on this list yet.</p>
      ) : null}

      <h2>Scan log</h2>
      <p className="muted" style={{ maxWidth: 780 }}>
        <code>scanEvents/&#123;deviceId&#125;_&#123;clientScanId&#125;</code> — every scan,
        including the ones that wrote nothing. The composite id is what makes an offline queue safe
        to replay: a station that loses the network keeps scanning locally and re-sends on
        reconnect, and the duplicates land on the same ids rather than double-counting. The code
        column is truncated on purpose — a <code>qrSecret</code> that is readable over someone&apos;s
        shoulder is not a secret.
      </p>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Result</th>
            <th>Code</th>
            <th>Station</th>
            <th>Scan id</th>
          </tr>
        </thead>
        <tbody>
          {scans.map((s) => (
            <tr key={s.id}>
              <td style={{ whiteSpace: 'nowrap' }}>
                {s.scannedAt ? new Date(s.scannedAt).toLocaleTimeString() : '—'}
              </td>
              <td className={s.result === 'ok' ? 'ok' : s.result === 'duplicate' ? '' : 'error'}>
                {s.result}
              </td>
              <td>
                <code>{s.code}</code>
              </td>
              <td>{stations.get(s.deviceId) ?? s.deviceId}</td>
              <td>
                <code>{s.id}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {scans.length === 0 ? <p className="muted">No scans on this list yet.</p> : null}

      <h2>Check-in lists</h2>
      <p className="muted" style={{ maxWidth: 780 }}>
        A list is a door. <code>kind: &apos;event&apos;</code> is the main entrance and is seeded
        automatically the first time this page loads, at the fixed id{' '}
        <code>checkInLists/event-door</code> — fixed rather than generated so two tabs racing this
        produce one list, not two.
      </p>
      <CreateListForm />

      <h2>Not built here</h2>
      <ul className="muted" style={{ maxWidth: 780 }}>
        <li>
          <strong>Day and session scope</strong> (§14). The engine is scope-agnostic — a day is a
          list and a session is a list — but nothing creates them per day or per session, and
          nothing picks the right one from the clock. Half a day for days; session scope is §34&apos;s
          3–4 days because it also wants capacity and certificate eligibility hanging off it.
        </li>
        <li>
          <strong>Search by name.</strong> Whova lets staff find someone who has lost their badge
          entirely. The data is already on this page — <code>registrations</code> is read in full
          for the count — so this is a filter box, not a feature. It is left out here only because
          scanning is the path that must be right first.
        </li>
        <li>
          <strong>A device-side scanner.</strong> This console holds the Admin SDK and bypasses
          rules; a phone in a volunteer&apos;s hand does not.{' '}
          <code>firestore.rules</code> has <strong>no match block at all</strong> for{' '}
          <code>checkInLists</code>, <code>checkIns</code>, <code>scanEvents</code> or{' '}
          <code>checkInStations</code>, and the file is default-closed — so an on-device scanner
          writes nothing until those rules exist and a <code>checkin</code> role (already in{' '}
          <code>Role</code> in <code>models.ts</code>) is minted into the custom claim.
        </li>
        <li>
          <strong>The offline queue itself.</strong> The <em>id scheme</em> that makes replay safe
          is implemented and proven above; the queue that would hold scans while the network is
          down is not. In this console that is the correct order — a laptop on the venue wifi with
          no queue is honest, and a queue that has never been replayed under load is worse than
          none.
        </li>
        <li>
          <strong>Checkout, kiosk mode and on-demand badge printing</strong> — the three siblings
          of this node in the nav. <code>badgePrintJobs</code> and <code>badgeTemplates</code> are
          modelled; §34 calls the badge renderer the best value-per-day on the list for a
          1,000-person door.
        </li>
      </ul>
    </>
  );
}
