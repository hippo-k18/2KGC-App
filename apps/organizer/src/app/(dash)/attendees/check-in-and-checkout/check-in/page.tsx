import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import {
  DEFAULT_LIST_ID,
  allCheckIns,
  listCheckInLists,
  listRegistrations,
  listStations,
  recentCheckIns,
  recentScanEvents,
} from '@/lib/checkin';
import { doorDashboard, type DoorBar } from '@/lib/door-dashboard-core';
import { capacityIndex } from '@/lib/cohorts';
import { listSessions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { clockOfInstant, dayOfInstant } from '@/lib/time';
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
  // Lists made before the rename carry a long dash in their name.
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

  /*
   * `everyCheckIn` is a second pass over the same subcollection, and it is the
   * honest cost of the two charts below. `recentCheckIns` answers its two
   * questions — how many, and who came through last — with a `count()` and a
   * twenty-document query, neither of which reads the rest. Splitting people by
   * ticket and by hour needs every document there is. The subcollection tops
   * out at one entry per registration, which is why `allCheckIns` carries no
   * limit in the first place.
   */
  const [{ rows: checkIns, total: checkedIn }, scans, everyCheckIn] = await Promise.all([
    recentCheckIns(selected.id, rows, stations),
    recentScanEvents(selected.id),
    allCheckIns(selected.id, rows, stations),
  ]);

  const door = doorDashboard(everyCheckIn, EVENT.timeZone);

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
          <div
            style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 24, padding: '16px 14px' }}
          >
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
                          <strong>, {checkedIn - scopeCapacity} over the cap</strong>
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
            <div className="scope-split" style={{ flex: '1 1 260px', padding: 14 }}>
              <strong>Check-in for the session</strong>
              <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                Count attendees into one session.
              </div>
              <SessionScopeForm options={sessionOptions} defaultValue={suggested?.id} />
            </div>
          </div>
        </div>

        {/*
          Every scope an organizer has opened, as chips. Session lists accumulate
          One per room-hour… so they are collapsed behind a dropdown rather
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
            main door, {scopeSession.day} {scopeSession.startsAtLocal.slice(11, 16)} to{' '}
            {scopeSession.endsAtLocal.slice(11, 16)}
            {scopeSession.roomName ? ` in ${scopeSession.roomName}` : ''}. Scans here do not count
            toward the main door. Switch back with the <em>KGC 2027: Main Door</em> chip above.
          </Banner>
        ) : rows.length - active > 0 ? (
          <Banner kind="warning">
            {rows.length - active} registrations are cancelled or transferred and are not counted
            above.
          </Banner>
        ) : null}

        <Scanner listId={selected.id} listName={selected.name} />
      </Panel>

      <Panel>
        <h2 className="section-header">Check in by name</h2>
        <p className="body-2">
          For an attendee without a badge code. Find the person and press Check in.
        </p>
        <DeskTable listId={selected.id} rows={deskRows} />
      </Panel>

      {/*
        The live door dashboard. Two charts, because the progress bar above
        answers "how far through the queue are we" and cannot answer either of
        these: whether the queue is moving, and which tickets are still
        outside. Both are read off the check-ins on this list, so switching to a
        session door re-draws them for that room.
      */}
      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Arrivals
        </h2>
        {door.total === 0 ? (
          <p className="body-2">
            Nobody has checked in on this list yet. The charts appear with the first arrival.
          </p>
        ) : (
          <>
            <div className="form-row" style={{ alignItems: 'flex-start', display: 'flex', gap: 24 }}>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>By ticket type</h3>
                <BarChart
                  firstLabel="Ticket"
                  barLabel="Checked in"
                  bars={door.byTicket}
                  empty="No tickets recorded"
                />
              </div>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>By hour</h3>
                <BarChart
                  firstLabel="Hour"
                  barLabel="Arrivals"
                  bars={door.byHour}
                  empty="No arrival times recorded"
                />
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
              {door.busiestHour
                ? `Busiest hour ${door.busiestHour.label} with ${door.busiestHour.count} ${door.busiestHour.count === 1 ? 'arrival' : 'arrivals'}. `
                : ''}
              {door.lastAt ? `Last arrival ${venueClock(door.lastAt)}. ` : ''}
              {door.undated > 0
                ? `${door.undated} ${door.undated === 1 ? 'check-in has' : 'check-ins have'} no time on them, so they are counted by ticket only. `
                : ''}
              {door.skippedGaps > 0
                ? 'Long quiet stretches are left out, so two bars side by side are not always two hours in a row. '
                : ''}
              Hours are {VENUE_CITY} time.
            </p>
          </>
        )}
      </Panel>

      <Panel>
        <h2 className="section-header">Recent check-ins ({checkedIn})</h2>
        <Table
          cols={[
            { key: 'w', label: 'When', className: 'cell-mdsm' },
            { key: 'n', label: 'Attendee', className: 'cell-md' },
            { key: 't', label: 'Ticket', className: 'cell-sm' },
            /*
              No registration id column. It printed `reg_f36950d41bacf1d0…`
              beside every arrival, which is how the badge and this dashboard
              address a ticket and is nothing a person at the desk reads. The
              attendee's name and address identify the row.
            */
            { key: 's', label: 'Station', className: 'cell-fill' },
          ]}
          empty="Nobody has checked in yet"
          rows={checkIns.map((c) => [
            <span key="w" style={{ whiteSpace: 'nowrap' }}>
              {c.checkedInAt
                ? `${dayOfInstant(c.checkedInAt)} ${clockOfInstant(c.checkedInAt)}`
                : '—'}
            </span>,
            <span key="n">
              <strong>{c.name}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {c.email}
              </div>
            </span>,
            c.ticketType ?? <span className="muted">—</span>,
            c.stationLabel || <span className="muted">—</span>,
          ])}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">Scan log ({scans.length})</h2>
        <p className="body-2">
          Every scan, including duplicates and rejected codes.
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
              {s.scannedAt
                ? `${dayOfInstant(s.scannedAt)} ${clockOfInstant(s.scannedAt)}`
                : '—'}
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
            <strong>Self check-in, as Whova means it.</strong> Still a deliberate omission:{' '}
            <code>firestore.rules</code> denies every client write under <code>checkInLists</code>{' '}
            precisely so that attendees cannot check themselves in, and opening that is a decision
            rather than a feature. What now exists is the unattended half that does not need it —{' '}
            <Link href="/attendees/check-in-and-checkout/kiosk-check-in">Kiosk Check-in</Link> runs
            this same scanner with the operator&apos;s half removed, on the organizer&apos;s own
            credential.
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

/**
 * "America/New_York" → "New York". The zone named the way somebody says it.
 *
 * The charts below are bucketed in the venue's zone rather than the reader's,
 * and an organizer watching the door from another country has to be told which
 * clock the hours are on. The zone id is the accurate way to say it and the
 * wrong way to write it on a screen.
 */
const VENUE_CITY = (EVENT.timeZone.split('/').pop() ?? EVENT.timeZone).replace(/_/g, ' ');

/** One instant, on the venue's clock, for a line of prose beside the charts. */
function venueClock(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: EVENT.timeZone,
  }).format(new Date(t));
}

/**
 * A bar per row, and no chart library.
 *
 * Tools › Report draws the scan-throughput chart exactly this way, and the two
 * screens should not carry two ideas of what a chart looks like. Widths are a
 * share of the busiest bar, so the axis is the peak and needs no label; the
 * count sits outside the bar because a bar with no number on it is a shape.
 *
 * `aria-hidden` on the bar itself: it is the number beside it, drawn. A screen
 * reader announcing both reads every row twice.
 */
function BarChart({
  bars,
  firstLabel,
  barLabel,
  empty,
}: {
  bars: DoorBar[];
  firstLabel: string;
  barLabel: string;
  empty: string;
}) {
  return (
    <Table
      cols={[
        { key: 'l', label: firstLabel, className: 'cell-mdsm' },
        { key: 'b', label: barLabel, className: 'cell-fill' },
        { key: 'n', label: '', className: 'cell-xs cell-end-align' },
      ]}
      empty={empty}
      rows={bars.map((b) => [
        <span key="l" style={{ whiteSpace: 'nowrap' }}>
          {b.label}
        </span>,
        <span
          key="b"
          aria-hidden="true"
          style={{
            background: 'var(--accent, #2180b2)',
            borderRadius: 2,
            display: 'block',
            height: 12,
            // A zero bar is drawn as nothing at all. A one-pixel sliver for an
            // hour nobody arrived in reads as an arrival.
            width: `${b.pct}%`,
          }}
        />,
        <strong key="n">{b.count}</strong>,
      ])}
    />
  );
}
