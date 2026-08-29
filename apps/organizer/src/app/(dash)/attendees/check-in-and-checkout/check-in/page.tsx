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
import { Banner, GapPanel, PageHeader, Panel, ProgressBar, Table, Tag } from '../../../ui';
import { Dropdown } from '../../../menu';
import { DeskTable, type DeskRow } from './desk-table';
import { CreateListForm } from './list-form';
import { Scanner } from './scanner';

export const dynamic = 'force-dynamic';

/**
 * Attendees > Check-in & Checkout > Check-in.
 *
 * The end of the loop the website starts: the site sells a ticket and writes
 * `registrations/{opaqueId}` with a `qrSecret` and a `claimCode`; the app claims
 * it by email and renders the `qrSecret` as a badge QR; this screen scans that
 * QR and writes `checkInLists/{listId}/checkIns/{registrationId}`.
 *
 * Whova's landing here is three cards in one panel — Event / Day / Session,
 * each with its own Start button — and the running screen is a wide progress
 * bar over a table whose Status column holds an inline "Check in" button. Both
 * shapes are reproduced. What Whova has and we do not is the *scoping*: a day
 * or a session is only another `checkInLists` document and the scanner does not
 * care which one is selected, so what is missing is the UI that creates one per
 * day and per session and picks the right one automatically, not the engine.
 *
 * The progress bar is deliberately the largest thing on the page. At 08:55 on
 * day one the question is "how far through the queue are we", and it should be
 * readable from behind the desk.
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

  const checkedInById = new Map(checkIns.map((c) => [c.registrationId, c.checkedInAt]));
  const deskRows: DeskRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    ticketType: r.ticketType,
    status: r.status,
    checkedIn: checkedInById.has(r.id),
    checkedInAt: checkedInById.get(r.id) ?? null,
  }));

  const active = rows.filter((r) => r.status === 'active').length;
  const pct = active ? Math.round((checkedIn / active) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Attendee Check-in"
        actions={
          <Dropdown
            label="Export Check-in Lists"
            className="whova-btn-main small secondary"
            align="end"
            items={[
              { label: 'Export checked-in list (CSV)', disabled: true },
              { label: 'Export full attendee list (CSV)', disabled: true },
            ]}
          />
        }
        links={[
          <Link key="a" href="/attendees/check-in-and-checkout">
            Check-in &amp; Checkout
          </Link>,
          <span key="l" className="muted">
            {selected.name}
          </span>,
        ]}
      />

      <Panel>
        <div style={{ border: '1px solid var(--hairline)', borderRadius: 4, marginBottom: 20 }}>
          <div
            style={{
              background: 'var(--surface-alt)',
              borderBottom: '1px solid var(--hairline)',
              fontWeight: 600,
              padding: '8px 14px',
            }}
          >
            Event check-in
          </div>
          <div style={{ alignItems: 'center', display: 'flex', gap: 24, padding: '16px 14px' }}>
            <div style={{ flex: '1 1 240px' }}>
              <strong>Check-in for the event</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                Get a general headcount and keep track of who is attending your event.
              </div>
            </div>
            <div style={{ flex: '2 1 320px' }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                Currently checked-in
              </div>
              <ProgressBar pct={pct} />
              <div style={{ fontSize: 13, marginTop: 4 }}>
                {checkedIn} out of {active} in-person attendees checked in ({pct}%)
              </div>
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--hairline)', display: 'flex' }}>
            {[
              ['Check-in for the day', 'Check in attendees for a specific day of your event.'],
              ['Check-in for the session', 'Check in attendees for a specific session at your event.'],
            ].map(([t, d], i) => (
              <div
                key={t}
                style={{
                  borderLeft: i === 1 ? '1px solid var(--hairline)' : undefined,
                  flex: 1,
                  padding: '14px',
                }}
              >
                <strong>{t}</strong>
                <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                  {d}
                </div>
                <button type="button" className="btn btn-primary btn-sm" disabled title="Not built — see below">
                  Start
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="toolbar">
          {lists.map((l) => (
            <Link
              key={l.id}
              className={`whova-tag${l.id === selected.id ? ' solid' : ''}`}
              href={`?list=${l.id}`}
              style={{ textDecoration: 'none' }}
            >
              {l.name} ({l.kind})
            </Link>
          ))}
        </div>

        {rows.length - active > 0 ? (
          <Banner kind="warning">
            {rows.length - active} registrations are cancelled or transferred and are excluded from
            the denominator above.
          </Banner>
        ) : null}

        <Scanner listId={selected.id} listName={selected.name} />
      </Panel>

      <Panel>
        <h2 className="section-header">Check in by name</h2>
        <p className="body-2">
          The scanner needs a code off the attendee&apos;s phone. This does not — find the person
          and press the button. A queue of a thousand reliably contains a flat battery, and this is
          the row Whova puts an inline <strong>Check in</strong> button on for that reason. Same
          idempotent write as a scan, so a double click cannot double count.
        </p>
        <DeskTable listId={selected.id} rows={deskRows} />
      </Panel>

      <Panel>
        <h2 className="section-header">Recent check-ins ({checkedIn})</h2>
        <Table
          cols={[
            { key: 'w', label: 'When', className: 'cell-mdsm' },
            { key: 'n', label: 'Attendee', className: 'cell-md' },
            { key: 't', label: 'Ticket', className: 'cell-sm' },
            { key: 's', label: 'Station', className: 'cell-mdsm' },
            { key: 'r', label: 'Registration', className: 'cell-fill' },
          ]}
          empty="Nobody has checked in yet"
          rows={checkIns.map((c) => [
            <span key="w" style={{ whiteSpace: 'nowrap' }}>
              {c.checkedInAt ? c.checkedInAt.slice(0, 16).replace('T', ' ') : '—'}
            </span>,
            <span key="n">
              <strong>{c.name}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {c.email}
              </div>
            </span>,
            c.ticketType ?? <span className="muted">—</span>,
            c.stationLabel || <span className="muted">—</span>,
            <code key="r" style={{ fontSize: 12 }}>
              {c.registrationId}
            </code>,
          ])}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">Scan log ({scans.length})</h2>
        <p className="body-2">
          Every scan, including the rejected ones. A duplicate is not an error state to recover
          from — the write is a <code>create</code> keyed by registration, so the second one fails
          with <code>already-exists</code> and <em>that failure is the mechanism</em>. The row below
          telling you someone was already checked in at 09:12 at Front desk 1 is also the only way
          a photographed badge gets noticed.
        </p>
        <Table
          cols={[
            { key: 'w', label: 'When', className: 'cell-mdsm' },
            { key: 'r', label: 'Result', className: 'cell-sm' },
            { key: 'd', label: 'Device', className: 'cell-mdsm' },
            { key: 'c', label: 'Code', className: 'cell-fill' },
          ]}
          empty="No scans yet"
          rows={scans.map((s) => [
            <span key="w" style={{ whiteSpace: 'nowrap' }}>
              {s.scannedAt ? s.scannedAt.slice(0, 16).replace('T', ' ') : '—'}
            </span>,
            <Tag key="r" color={s.result === 'ok' ? 'green' : s.result === 'duplicate' ? 'orange' : 'red'}>
              {s.result}
            </Tag>,
            s.deviceId,
            <code key="c" style={{ fontSize: 12 }}>
              {s.code}
            </code>,
          ])}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">Lists</h2>
        <CreateListForm />
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Day and session scope.</strong> The engine handles it — each scope is another{' '}
            <code>checkInLists</code> document — so what is missing is the UI that creates one per
            day and per session and selects the right one by clock. A day or two.
          </li>
          <li>
            <strong>Self check-in and the kiosk.</strong> Self check-in is a deliberate omission:{' '}
            <code>firestore.rules</code> denies every client write under <code>checkInLists</code>{' '}
            precisely so that attendees cannot check themselves in, and opening that is a decision
            rather than a feature.
          </li>
          <li>
            <strong>Badge printing on scan.</strong> <code>badgeTemplates</code> and{' '}
            <code>badgePrintJobs</code> are modelled and nothing writes them. The scan that would
            trigger a print is the one above.
          </li>
          <li>
            <strong>Checkout.</strong> Whova has it, dashboard-only, never in the mobile app. Same
            writes with an <code>out</code> flag.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
