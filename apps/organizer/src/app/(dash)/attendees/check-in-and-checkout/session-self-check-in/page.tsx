import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { formatHours, sessionAttendance } from '@/lib/attendance';
import { ROUTES } from '@/lib/nav';
import { NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';
import { RoomDoorForm } from './room-door-form';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Check-in & Checkout › Session Self Check-in.
 *
 * Whova's screen is an attendee scanning a code at a room door with nobody
 * present. What this builds is the half that can honestly exist here: a **room
 * door station** — the kiosk scanner, pointed at one session's check-in list,
 * left outside the room.
 *
 * ── The half that is refused, and why it is not a backlog item ──────────────
 *
 * `firestore.rules` denies every client write under `checkInLists`, and that
 * refusal is the point rather than an omission: attendance must not be
 * self-asserted. It is sharper here than at the front door, because a room-door
 * scan is what an hours claim on a certificate is computed from, and evidence
 * should not be self-issued. A station the organizer sets up and walks away
 * from keeps the write on the organizer's own credential; an attendee's phone
 * writing directly would not, and no amount of UI makes those the same record.
 *
 * ── Arrivals only, still ────────────────────────────────────────────────────
 *
 * A room door counts people in. Nothing records who left, so the hours in the
 * table below are the session's *scheduled* length rather than time in the
 * seat. That caveat travels with every hours figure in this dashboard and is
 * stated wherever one is printed.
 */
export default async function SessionSelfCheckInPage() {
  await requireOrganizer();

  const attendance = await sessionAttendance();

  /*
    Cancelled sessions are already excluded by `sessionAttendance()`. What is
    left is ordered by start time rather than by headcount, because this screen
    is read forwards from now — the useful row at 13:55 is the one about to
    start, not the best-attended one this morning.
  */
  const rows = [...attendance.rows].sort((a, b) =>
    a.session.startsAtLocal.localeCompare(b.session.startsAtLocal),
  );
  const tracked = rows.filter((r) => r.tracked);

  const options = rows.map((r) => ({
    value: r.session.id,
    label: `${r.session.day} ${r.session.startsAtLocal.slice(11, 16)} · ${r.session.title}${
      r.session.roomName ? ` · ${r.session.roomName}` : ''
    }`,
  }));

  /*
    Default to the session in the room now, then the next one to start. Wall
    clocks compare as strings because `startsAtLocal` and `nowLocal` are both
    `YYYY-MM-DDTHH:mm` in the *event's* timezone — an organizer running KGC from
    a hotel elsewhere should still be offered the session the room is in.
  */
  const nowLocal = new Date()
    .toLocaleString('sv-SE', { timeZone: EVENT.timeZone })
    .replace(' ', 'T')
    .slice(0, 16);
  const running = rows.find(
    (r) => r.session.startsAtLocal <= nowLocal && nowLocal < r.session.endsAtLocal,
  );
  const next = rows.find((r) => r.session.startsAtLocal > nowLocal);
  const suggested = running ?? next ?? rows[0];

  return (
    <>
      <PageHeader
        title="Session Self Check-in"
        info={
          <>
            <strong>A room door is a station, not self-service</strong>
            <p>
              Attendees cannot check themselves in: the rules deny every client write under{' '}
              <code>checkInLists</code>, so a room door records what the organizer&rsquo;s station
              saw. It counts arrivals only. Nothing records a departure.
            </p>
          </>
        }
        tags={
          <Tag color="blue">
            {tracked.length} of {attendance.live} rooms counted
          </Tag>
        }
        links={[
          <Link key="c" href={ROUTES.checkIn}>
            Attendee Check-in
          </Link>,
          <Link key="k" href="/attendees/check-in-and-checkout/kiosk-check-in">
            Kiosk Check-in
          </Link>,
          <Link key="a" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          {
            label: 'Rooms with a door',
            value: tracked.length,
            sub: `of ${attendance.live} live sessions`,
          },
          {
            label: 'Counted into a room',
            value: attendance.totalCountedIn,
            sub: attendance.totalCountedIn ? 'arrivals, across every door' : 'not inputted yet',
          },
          {
            label: 'Rooms never scanned',
            value: attendance.live - tracked.length,
            sub: 'no attendance evidence for these',
          },
        ]}
      />

      <Panel>
        <h2 className="section-header">Open a room door</h2>
        <p className="body-2">
          Opens the kiosk scanner pointed at one session&rsquo;s check-in list, on this device.
          Same badge, same idempotent write, a different list, so the same person can be counted
          at the front door and in the room, which is the point.
        </p>
        <RoomDoorForm
          options={options}
          defaultValue={suggested?.session.id}
          defaultStation={suggested?.session.roomName ?? suggested?.session.title}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">Sessions ({rows.length})</h2>
        {rows.length === 0 ? (
          <NotInputted
            what="sessions"
            action={
              <Link className="btn btn-primary" href={ROUTES.sessionManager}>
                Build the programme
              </Link>
            }
          />
        ) : (
          <Table
            cols={[
              { key: 't', label: 'Session', className: 'cell-fill' },
              { key: 'w', label: 'When', className: 'cell-sm' },
              { key: 'r', label: 'Room', className: 'cell-mdsm' },
              { key: 'h', label: 'Scheduled', className: 'cell-sm' },
              { key: 'c', label: 'Counted in', className: 'cell-sm' },
            ]}
            rows={rows.map((r) => [
              <span key="t">
                <strong>{r.session.title}</strong>
                {r.session.primaryTrackName ? (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.session.primaryTrackName}
                  </div>
                ) : null}
              </span>,
              <span key="w" style={{ fontSize: 12 }}>
                {r.session.day}
                <div className="muted">{r.session.startsAtLocal.slice(11, 16)}</div>
              </span>,
              r.session.roomName ?? <span className="muted">—</span>,
              formatHours(r.minutes),
              r.tracked ? (
                <strong key="c">{r.countedIn}</strong>
              ) : (
                /*
                  A room nobody scanned is not a room nobody came to. Printing 0
                  for it is the exact shape of mistake this repo keeps finding —
                  a number that looks like a measurement and is an absence of
                  one — so the two states are visibly different.
                */
                <span key="c" className="muted" style={{ fontSize: 12 }}>
                  no door opened
                </span>
              ),
            ])}
          />
        )}
      </Panel>
    </>
  );
}
