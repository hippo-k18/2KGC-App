import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import {
  DEFAULT_LIST_ID,
  listCheckInLists,
  listRegistrations,
  listStations,
  recentCheckIns,
  recentScanEvents,
} from '@/lib/checkin';
import { capacityIndex } from '@/lib/cohorts';
import { listSessions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { Banner, GapPanel, PageHeader, Panel, ProgressBar, Table, Tag } from '../../../ui';
import { Dropdown } from '../../../menu';
import { DeskTable, type DeskRow } from './desk-table';
import { CreateListForm } from './list-form';
import { DayScopeForm, SessionScopeForm } from './scope-form';
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
 * shapes are reproduced, and all three Start buttons now work: a scope is
 * another `checkInLists` document with a derived id, and the scanner, the desk
 * table, the undo and the exports all take a `listId` and ask nothing about
 * what it means. The engine was never the missing part.
 *
 * ── A session denominator is not the event denominator ──────────────────────
 *
 * The one thing that genuinely changes with scope is the number under the bar.
 * On the door it is registrations; in a room it is that room's cap, and where
 * no cap is set there is no percentage worth printing. Reusing the event's
 * denominator would put "12 of 53 checked in" over a workshop capped at 20 —
 * a figure that reads as a measurement and measures nothing.
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
   * The note Attendees › Admin Settings writes for whoever is on the desk.
   *
   * Read here rather than only on the screen that writes it, because a note
   * addressed to the desk and readable only from the settings form is a note
   * the desk never sees — which is what "saved and nothing happens" looks like
   * when the intended reader is a colleague rather than a phone.
   */
  const access = await readSettings(SETTINGS_KEYS.access);

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

  const [registrations, stations, sessions, caps] = await Promise.all([
    listRegistrations(),
    listStations(),
    listSessions(),
    capacityIndex(),
  ]);
  const rows = registrations.map((r) => r.row);

  const [{ rows: checkIns, total: checkedIn }, scans] = await Promise.all([
    recentCheckIns(selected.id, rows, stations),
    recentScanEvents(selected.id),
  ]);

  /**
   * The scope pickers behind the Day and Session Start buttons.
   *
   * Cancelled sessions are dropped: a door for something that is not happening
   * is a list nobody will ever scan into, and it would sit in the picker
   * forever. The label carries the time and the room because at 14:00 on day
   * two there are four sessions running and neither the title nor the time
   * alone distinguishes them.
   */
  const liveSessions = sessions.filter((s) => s.status !== 'cancelled');
  const sessionOptions = liveSessions.map((s) => ({
    value: s.id,
    label: `${s.day} ${s.startsAtLocal.slice(11, 16)} · ${s.title}${s.roomName ? ` · ${s.roomName}` : ''}`,
  }));
  const dayOptions = [...new Set(liveSessions.map((s) => s.day))]
    .sort()
    .map((d) => ({ value: d, label: d }));

  /**
   * What the pickers default to: the session happening now, then the next one
   * to start today, then the first in the programme.
   *
   * Comparing wall clocks as strings works because `startsAtLocal` is
   * `YYYY-MM-DDTHH:mm` in the event's own timezone and so is `nowLocal` — and
   * it is the *event's* clock that matters, not the laptop's. An organizer
   * running KGC from a hotel in another timezone should still be offered the
   * session the room is in.
   */
  const nowLocal = new Date()
    .toLocaleString('sv-SE', { timeZone: EVENT.timeZone })
    .replace(' ', 'T')
    .slice(0, 16);
  const running = liveSessions.find((s) => s.startsAtLocal <= nowLocal && nowLocal < s.endsAtLocal);
  const next = liveSessions.find((s) => s.startsAtLocal > nowLocal);
  const suggested = running ?? next ?? liveSessions[0];

  /**
   * A session list counts people into a room, so its denominator is the room's
   * cap — not the event's registration count.
   *
   * Showing "12 of 53 checked in" for a workshop capped at 20 is the kind of
   * number that reads as a measurement and is not one. Where there is no cap
   * there is no honest percentage either, so the bar is not rendered at all.
   */
  const scopeSession = selected.sessionId
    ? liveSessions.find((s) => s.id === selected.sessionId)
    : undefined;
  const scopeCapacity = scopeSession ? caps.sessionCapacity.get(scopeSession.id) : undefined;

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
            /*
              Both of these were `disabled: true` while the export registry
              already served the CSV — a wiring gap, not a feature gap. The
              checked-in list is scoped to the door list, which is the one the
              scanner writes to.
            */
            items={[
              { label: 'Export checked-in list (CSV)', href: '/export/checked-in' },
              { label: 'Export full attendee list (CSV)', href: '/export/attendees' },
              { label: 'Export session attendance (CSV)', href: '/export/session-attendance' },
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

      {access.staffNote ? (
        <Banner kind="info">
          <strong>Note for the desk:</strong> {access.staffNote}
        </Banner>
      ) : null}

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
              {scopeSession ? (
                <>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    Counted into {scopeSession.title}
                  </div>
                  {scopeCapacity ? (
                    <>
                      <ProgressBar pct={Math.min(100, Math.round((checkedIn / scopeCapacity) * 100))} />
                      <div style={{ fontSize: 13, marginTop: 4 }}>
                        {checkedIn} of {scopeCapacity} capped seats
                        {checkedIn > scopeCapacity ? (
                          <strong> — {checkedIn - scopeCapacity} over the cap</strong>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 13 }}>
                      <strong style={{ fontSize: 24 }}>{checkedIn}</strong> counted in
                      <div className="muted" style={{ fontSize: 12 }}>
                        This session has no capacity set, so there is no percentage to show.
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    Currently checked-in
                  </div>
                  <ProgressBar pct={pct} />
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    {checkedIn} out of {active} in-person attendees checked in ({pct}%)
                  </div>
                </>
              )}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--hairline)', display: 'flex', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px', padding: 14 }}>
              <strong>Check-in for the day</strong>
              <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                Check in attendees for a specific day of your event.
              </div>
              <DayScopeForm options={dayOptions} defaultValue={suggested?.day} />
            </div>
            <div
              style={{
                borderLeft: '1px solid var(--hairline)',
                flex: '1 1 260px',
                padding: 14,
              }}
            >
              <strong>Check-in for the session</strong>
              <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                Counts people into one room. Same scanner, same badge — a different list.
              </div>
              <SessionScopeForm options={sessionOptions} defaultValue={suggested?.id} />
            </div>
          </div>
        </div>

        {/*
          Every scope an organizer has opened, as chips. Session lists accumulate
          — one per room-hour — so they are collapsed behind a dropdown rather
          than wrapped across four lines of the screen somebody is reading at the
          door. The event lists stay visible because those are the ones the desk
          switches between all day.
        */}
        <div className="toolbar">
          {lists
            .filter((l) => l.kind !== 'session' || l.id === selected.id)
            .map((l) => (
              <Link
                key={l.id}
                className={`whova-tag${l.id === selected.id ? ' solid' : ''}`}
                href={`?list=${l.id}`}
                style={{ textDecoration: 'none' }}
              >
                {l.name} ({l.kind})
              </Link>
            ))}
          {lists.filter((l) => l.kind === 'session').length > 0 ? (
            <Dropdown
              label={`Session doors (${lists.filter((l) => l.kind === 'session').length})`}
              className="whova-btn-main small secondary"
              items={lists
                .filter((l) => l.kind === 'session')
                .map((l) => ({ label: l.name, href: `?list=${l.id}` }))}
            />
          ) : null}
        </div>

        {scopeSession ? (
          <Banner kind="info">
            <strong>You are scanning into {scopeSession.title}</strong>, not the
            main door — {scopeSession.day} {scopeSession.startsAtLocal.slice(11, 16)}–
            {scopeSession.endsAtLocal.slice(11, 16)}
            {scopeSession.roomName ? ` in ${scopeSession.roomName}` : ''}. A badge scanned here is
            counted into this room and <em>not</em> into the event door list; the same person can be
            scanned at both, which is the point. Switch back with the{' '}
            <em>KGC 2027 — Main Door</em> chip above.
          </Banner>
        ) : rows.length - active > 0 ? (
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
            <strong>Session scope counts arrivals, never departures.</strong> Day and session doors
            are built — the Start buttons above create a <code>checkInLists</code> document per
            scope and the scanner writes into it — but a scan credits the whole scheduled length of
            the session whether the person stayed for it or left after ten minutes. That is the
            difference between the attendance report on{' '}
            <Link href={ROUTES.analyticsExports}>Analytics &amp; Exports</Link>, which is honest,
            and a CPE certificate naming hours, which this data cannot support. Fixing it needs
            Checkout, below.
          </li>
          <li>
            <strong>Nothing selects the scope automatically.</strong> A session list records{' '}
            <code>opensAt</code> and <code>closesAt</code> and the picker defaults to whatever is
            running now, but the desk still presses Start. Switching by clock without being asked is
            the wrong default while one machine may be running two doors.
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
