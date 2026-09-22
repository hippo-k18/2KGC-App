import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { sessionAttendance } from '@/lib/attendance';
import { capacityIndex } from '@/lib/cohorts';
import { listSessions, type SessionRow } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { seatCounts, sessionSeats, type SeatHolder } from '@/lib/session-seats';
import { joinNames, seatFill } from '@/lib/session-seats-core';
import { ConfirmButton } from '../../form';
import { Banner, Email, GapPanel, PER_PAGE, PageHeader, Pagination, Panel, SearchInput, StatTiles, Table, Tag, listParams, paginate, sortRows } from '../../ui';
import { removeSeatAction } from './actions';
import { CapForm } from './cap-form';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Session Cap.
 *
 * Whova caps a session, counts registrations against the cap, closes the
 * session when it fills and promotes from a waitlist. So does this. The app
 * takes a seat in a transaction when an attendee adds a capped session to their
 * agenda, `firestore.rules` re-check the count so the app cannot be bypassed,
 * and a full session offers a waitlist that is promoted in order.
 *
 * Seats and Waitlist come from `sessionSeats/{sessionId}`, the counter those
 * transactions move. A session nobody has joined has no counter and reads 0,
 * which is a true zero: there is no other way onto a capped session.
 *
 * "Counted" is a different question with a different answer: people scanned at
 * that session's door, after the fact. It is `null`, rendered "not counted",
 * for any session whose door was never opened.
 *
 * ── What an organizer does here ─────────────────────────────────────────────
 *
 * Manage opens one session on this same screen (`?session=`): the people
 * seated, the waitlist in order, a Remove beside each and the cap. Removing
 * somebody hands their seat to the first person waiting; raising the cap seats
 * as many as now fit. Both go through `lib/session-seats.ts`, which uses the
 * same planning functions as the app.
 *
 * ── Reads ───────────────────────────────────────────────────────────────────
 *
 * `listSessions()` for the programme and `capacityIndex()` for the two numbers
 * neither `SessionRow` nor `RoomOption` carries. Both do a single
 * `where('eventId', '==', EVENT_ID)` and sort in memory — that filter is served
 * by Firestore's automatic single-field index, whereas adding an `orderBy`
 * would need a composite index this repo does not declare, and the emulator
 * does not enforce index configuration, so the failure would only appear in
 * production as `failed-precondition`.
 *
 * `conflicts-core.ts` already compares these two numbers as one of its five
 * checks, and this deliberately does not call it: `detectConflicts` returns
 * only the sessions that fail, and the question here — "how tight is every cap
 * we have set" — needs the ones that pass as well.
 */

type Verdict = 'over-room' | 'no-room-capacity' | 'no-room' | 'fits';

interface CappedRow {
  session: SessionRow;
  capacity: number;
  roomName?: string;
  roomCapacity?: number;
  verdict: Verdict;
  /** Seats the room has beyond the cap. Only meaningful when both numbers exist. */
  headroom?: number;
  /**
   * People scanned into this session's door, or `null` when no door was opened.
   *
   * `null` rather than `0` throughout, because the two render identically as a
   * number and mean opposite things — "nobody came" against "nobody counted" —
   * and this screen's whole argument is that it will not print a figure it
   * cannot stand behind.
   */
  countedIn: number | null;
  /** Seats held through the app. 0 when nobody has joined. */
  taken: number;
  waiting: number;
}

const VERDICT: Record<Verdict, { label: string; color: 'red' | 'orange' | 'green'; rank: number }> =
  {
    'over-room': { label: 'over room', color: 'red', rank: 0 },
    'no-room': { label: 'no room', color: 'red', rank: 1 },
    'no-room-capacity': { label: 'room seats unknown', color: 'orange', rank: 2 },
    fits: { label: 'fits', color: 'green', rank: 3 },
  };

export default async function SessionCapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();

  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const day = typeof sp.day === 'string' ? sp.day : undefined;
  const managedId = typeof sp.session === 'string' ? sp.session : undefined;
  const { page, sort, baseParams } = listParams(sp);

  const [sessions, caps, attendance, counts] = await Promise.all([
    listSessions(),
    capacityIndex(),
    sessionAttendance(),
    seatCounts(),
  ]);
  const countedIn = new Map(
    attendance.rows.filter((r) => r.tracked).map((r) => [r.session.id, r.countedIn]),
  );

  // Cancelled sessions are dropped, not flagged. A cap on something that is not
  // happening is not a problem to fix, and leaving them in makes the count of
  // capped sessions disagree with the programme.
  const live = sessions.filter((s) => s.status !== 'cancelled');

  const capped: CappedRow[] = live
    .filter((s) => caps.sessionCapacity.has(s.id))
    .map((s) => {
      const capacity = caps.sessionCapacity.get(s.id)!;
      const room = s.roomId ? caps.roomCapacity.get(s.roomId) : undefined;
      // `roomName` on the session is a denormalised display cache the model says
      // is never decided from, so the room document wins where there is one.
      const roomName = room?.name ?? s.roomName;
      const roomCapacity = room?.capacity;

      const verdict: Verdict = !s.roomId
        ? 'no-room'
        : roomCapacity === undefined
          ? 'no-room-capacity'
          : capacity > roomCapacity
            ? 'over-room'
            : 'fits';

      return {
        session: s,
        capacity,
        roomName,
        roomCapacity,
        verdict,
        headroom: roomCapacity === undefined ? undefined : roomCapacity - capacity,
        countedIn: countedIn.has(s.id) ? countedIn.get(s.id)! : null,
        taken: counts.get(s.id)?.taken ?? 0,
        waiting: counts.get(s.id)?.waitlist.length ?? 0,
      };
    });

  const days = [...new Set(capped.map((r) => r.session.day))].sort();
  const needle = (q ?? '').trim().toLowerCase();
  const matched = capped.filter((r) => {
    if (day && r.session.day !== day) return false;
    if (!needle) return true;
    return [r.session.title, r.roomName, r.session.primaryTrackName, ...r.session.speakerNames]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

  const rows = sortRows(matched, sort.by, sort.dir, {
    title: (r) => r.session.title,
    when: (r) => `${r.session.day} ${r.session.startsAtLocal}`,
    room: (r) => r.roomName ?? '',
    cap: (r) => r.capacity,
    seats: (r) => r.roomCapacity ?? -1,
    counted: (r) => r.countedIn ?? -1,
    taken: (r) => r.taken,
    waiting: (r) => r.waiting,
    verdict: (r) => VERDICT[r.verdict].rank,
  });
  // Problems first by default, so the screen is useful before anyone touches a
  // column header.
  const ordered = sort.by
    ? rows
    : [...rows].sort(
        (a, b) =>
          VERDICT[a.verdict].rank - VERDICT[b.verdict].rank ||
          a.session.startsAtLocal.localeCompare(b.session.startsAtLocal),
      );
  const pageRows = paginate(ordered, page, PER_PAGE);

  const over = capped.filter((r) => r.verdict === 'over-room');
  const unknownRoom = capped.filter((r) => r.verdict !== 'fits' && r.verdict !== 'over-room');
  const uncapped = live.filter((s) => !caps.sessionCapacity.has(s.id));
  const uncappedWorkshops = uncapped.filter((s) => s.format === 'workshop');
  const seatsCapped = capped.reduce((n, r) => n + r.capacity, 0);
  const seatsTaken = capped.reduce((n, r) => n + r.taken, 0);
  const full = capped.filter((r) => r.taken >= r.capacity);
  const waitingTotal = capped.reduce((n, r) => n + r.waiting, 0);

  // Restricted to certain tickets but not capped: these hold seats too, so an
  // organizer needs a way to see and remove people.
  const restrictedOnly = live.filter(
    (s) => caps.sessionTicketTypes.has(s.id) && !caps.sessionCapacity.has(s.id),
  );

  const managed = managedId ? live.find((s) => s.id === managedId) : undefined;
  const people = managed ? await sessionSeats(managed.id) : undefined;
  const managedCap = managed ? caps.sessionCapacity.get(managed.id) : undefined;
  const managedTickets = managed ? caps.sessionTicketTypes.get(managed.id) : undefined;
  const removed = typeof sp.removed === 'string' ? sp.removed : undefined;
  const promoted = typeof sp.promoted === 'string' ? Number(sp.promoted) : 0;
  const failure = typeof sp.error === 'string' ? sp.error : undefined;

  const manageHref = (id: string) => {
    const p = new URLSearchParams(baseParams);
    p.set('session', id);
    return `?${p.toString()}`;
  };

  const peopleRows = (list: SeatHolder[]) =>
    list.map((h) => [
      ...(h.status === 'waitlisted' ? [<strong key="p">{h.position ?? ''}</strong>] : []),
      <span key="n">
        <strong>{h.name}</strong>
        {h.email && h.email !== h.name ? (
          <div className="muted" style={{ fontSize: 12 }}>
            <Email address={h.email} />
          </div>
        ) : null}
      </span>,
      h.ticketType ?? <span className="muted">none recorded</span>,
      h.since ? h.since.slice(0, 10) : '',
      <ConfirmButton
        key="x"
        action={removeSeatAction}
        label="Remove"
        confirmLabel={`Remove ${h.name}`}
        hidden={{ sessionId: managed!.id, uid: h.uid, name: h.name }}
      >
        {h.status === 'seated'
          ? 'Takes this session off their agenda. The seat goes to the first person on the waitlist.'
          : 'Takes them off the waitlist. Everybody behind them moves up.'}
      </ConfirmButton>,
    ]);

  const href = (next: { q?: string; day?: string }) => {
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.day) p.set('day', next.day);
    const s = p.toString();
    return s ? `?${s}` : '/attendees/session-cap';
  };

  return (
    <>
      <PageHeader
        title="Session Cap"
        info={
          <>
            <strong>A cap is a limit</strong>
            <p>
              Adding a capped session in the app takes a seat. A full session offers a waitlist,
              and a freed seat goes to the first person waiting. Counted is the number of people
              scanned at the session door.
            </p>
          </>
        }
        links={[
          <Link key="sm" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="cc" href={ROUTES.conflictCheck}>
            Conflict Check
          </Link>,
        ]}
      />

      {managedId && !managed ? <Banner kind="warning">That session is not in the programme.</Banner> : null}

      {managed && people ? (
        <Panel>
          <h2 className="section-header">{managed.title}</h2>
          <p className="body-2">
            {managed.day} · {managed.startsAtLocal.slice(11, 16)} to {managed.endsAtLocal.slice(11, 16)}
            {managed.roomName ? ` · ${managed.roomName}` : ''}
            {' · '}
            <Link href="/attendees/session-cap">Close</Link>
          </p>

          {failure ? <Banner kind="danger">{failure}</Banner> : null}
          {removed ? (
            <Banner kind="success">
              {removed} was removed.
              {promoted > 0 ? ' The first person on the waitlist now has the seat.' : ''}
            </Banner>
          ) : null}

          <StatTiles
            tiles={[
              {
                label: 'Seats taken',
                value: people.state.taken,
                sub: managedCap ? `of ${managedCap}` : 'no cap',
              },
              { label: 'On the waitlist', value: people.state.waitlist.length, sub: 'promoted in order' },
              {
                label: 'Tickets allowed',
                value: managedTickets ? managedTickets.length : 'All',
                sub: managedTickets ? joinNames(managedTickets) : 'every ticket type',
              },
            ]}
          />

          <CapForm key={managed.id} sessionId={managed.id} capacity={managedCap} />

          <h3 className="section-header" style={{ marginTop: 24 }}>
            Seated
          </h3>
          <Table
            stackSm
            cols={[
              { key: 'n', label: 'Name', className: 'cell-fill' },
              { key: 't', label: 'Ticket', className: 'cell-mdsm' },
              { key: 's', label: 'Since', className: 'cell-sm' },
              { key: 'x', label: '', className: 'cell-sm' },
            ]}
            empty="Nobody has taken a seat yet."
            rows={peopleRows(people.seated)}
          />

          <h3 className="section-header" style={{ marginTop: 24 }}>
            Waitlist
          </h3>
          <Table
            stackSm
            cols={[
              { key: 'p', label: 'No.', className: 'cell-xs' },
              { key: 'n', label: 'Name', className: 'cell-fill' },
              { key: 't', label: 'Ticket', className: 'cell-mdsm' },
              { key: 's', label: 'Joined', className: 'cell-sm' },
              { key: 'x', label: '', className: 'cell-sm' },
            ]}
            empty="Nobody is waiting."
            rows={peopleRows(people.waitlisted)}
          />

          <p className="body-2" style={{ marginBottom: 0 }}>
            Somebody moved into a seat from here gets a notification in the app and an email.
          </p>
        </Panel>
      ) : null}

      <Panel>
        <StatTiles
          tiles={[
            {
              label: 'Sessions with a cap',
              value: capped.length,
              sub: `of ${live.length} in the programme`,
            },
            {
              label: 'Capped above the room',
              value: over.length,
              sub: over.length ? 'more places than seats' : 'every cap fits its room',
            },
            {
              label: 'Cannot be checked',
              value: unknownRoom.length,
              sub: 'no room, or the room has no capacity recorded',
            },
            {
              label: 'Seats taken',
              value: seatsTaken,
              sub: `of ${seatsCapped} capped seats`,
            },
            {
              label: 'Full sessions',
              value: full.length,
              sub: waitingTotal ? `${waitingTotal} waiting across them` : 'nobody waiting',
            },
          ]}
        />

        <form method="get" className="toolbar">
          {day ? <input type="hidden" name="day" value={day} /> : null}
          <SearchInput
            defaultValue={q}
            width={420}
            placeholder="Enter session, room, track or speaker"
          />
          <button type="submit" className="btn btn-default">
            Search
          </button>
          {q || day ? (
            <Link className="btn btn-default" href="/attendees/session-cap">
              Clear
            </Link>
          ) : null}
        </form>

        {days.length > 1 ? (
          <div className="toolbar">
            <Link
              className={`whova-tag-main ${!day ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
              href={href({ q })}
              style={{ textDecoration: 'none' }}
            >
              All days ({capped.length})
            </Link>
            {days.map((d) => (
              <Link
                key={d}
                className={`whova-tag-main ${d === day ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
                href={href({ q, day: d })}
                style={{ textDecoration: 'none' }}
              >
                {d} ({capped.filter((r) => r.session.day === d).length})
              </Link>
            ))}
          </div>
        ) : null}

        <Table
          cols={[
            { key: 't', label: 'Session', className: 'cell-fill', sortKey: 'title' },
            { key: 'w', label: 'When', className: 'cell-sm', sortKey: 'when' },
            { key: 'r', label: 'Room', className: 'cell-sm', sortKey: 'room' },
            { key: 'tk', label: 'Seats taken', className: 'cell-sm', sortKey: 'taken' },
            { key: 'in', label: 'Counted', className: 'cell-sm', sortKey: 'counted' },
            { key: 'v', label: 'Fit', className: 'cell-sm', sortKey: 'verdict' },
            { key: 'm', label: '', className: 'cell-xs' },
          ]}
          sort={sort}
          stackSm
          empty={
            capped.length === 0
              ? 'No session has a cap yet.'
              : 'No capped session matches that'
          }
          rows={pageRows.map((r) => [
            <span key="t">
              <strong>{r.session.title}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {r.session.format}
                {r.session.primaryTrackName ? ` · ${r.session.primaryTrackName}` : ''}
                {r.session.status !== 'published' ? ` · ${r.session.status}` : ''}
              </div>
            </span>,
            <span key="w" style={{ fontSize: 12 }}>
              {r.session.day}
              <div className="muted">
                {r.session.startsAtLocal.slice(11, 16)} to {r.session.endsAtLocal.slice(11, 16)}
              </div>
            </span>,
            r.roomName ?? <span className="muted">unassigned</span>,
            <span key="tk">
              <strong>{r.taken}</strong> of {r.capacity}
              {r.waiting > 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {r.waiting} waiting
                </div>
              ) : null}
              {seatFill(r.taken, r.capacity) !== 'open' ? (
                <div>
                  <Tag color={seatFill(r.taken, r.capacity) === 'over' ? 'red' : 'orange'} fill="outline" small>
                    {seatFill(r.taken, r.capacity) === 'over' ? 'over cap' : 'full'}
                  </Tag>
                </div>
              ) : null}
            </span>,
            r.countedIn === null ? (
              <span key="in" className="muted" title="Check-in was not opened for this session">
                not counted
              </span>
            ) : (
              <span key="in">
                <strong>{r.countedIn}</strong>
                {r.countedIn > r.capacity ? (
                  <div>
                    <Tag color="red" fill="outline" small>
                      over cap
                    </Tag>
                  </div>
                ) : null}
              </span>
            ),
            <span key="v">
              <Tag color={VERDICT[r.verdict].color} fill="outline" small>
                {VERDICT[r.verdict].label}
              </Tag>
              {r.verdict === 'over-room' && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {r.capacity - (r.roomCapacity ?? 0)} over
                </div>
              )}
              {r.verdict === 'fits' && (
                <div className="muted" style={{ fontSize: 12 }}>
                  room seats {r.roomCapacity}
                </div>
              )}
            </span>,
            <Link key="m" href={manageHref(r.session.id)}>
              Manage
            </Link>,
          ])}
        />
        <Pagination total={ordered.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>

      <Panel>
        <h2 className="section-header">Sessions with no cap</h2>
        <p className="body-2">
          {uncapped.length} of the {live.length} live sessions have no cap
          {uncappedWorkshops.length > 0 ? (
            <>
              , including <strong>{uncappedWorkshops.length}</strong> workshops
            </>
          ) : null}
          . Set caps per session in <Link href={ROUTES.sessionManager}>Session Manager</Link>.
        </p>
        <p className="body-2" style={{ marginBottom: 0 }}>
          &ldquo;Room seats unknown&rdquo; means the room has no seat count, so the cap could not be
          checked.
        </p>
      </Panel>

      {restrictedOnly.length > 0 ? (
        <Panel>
          <h2 className="section-header">Limited by ticket, with no cap</h2>
          <Table
            stackSm
            cols={[
              { key: 't', label: 'Session', className: 'cell-fill' },
              { key: 'a', label: 'Tickets allowed', className: 'cell-md' },
              { key: 'tk', label: 'Taken', className: 'cell-xs' },
              { key: 'm', label: '', className: 'cell-xs' },
            ]}
            rows={restrictedOnly.map((s) => [
              <strong key="t">{s.title}</strong>,
              joinNames(caps.sessionTicketTypes.get(s.id) ?? []),
              String(counts.get(s.id)?.taken ?? 0),
              <Link key="m" href={manageHref(s.id)}>
                Manage
              </Link>,
            ])}
          />
          <p className="body-2" style={{ marginBottom: 0 }}>
            Choose which tickets a session is for in{' '}
            <Link href="/attendees/ticket-session-mapping">Ticket Session Mapping</Link>.
          </p>
        </Panel>
      ) : null}

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>A warning on the scanner.</strong> Per-session check-in is built and the Counted
            column comes from a real door list, but the scanner does not warn at the moment a room
            passes its cap, and it does not check the badge against the seat list.
          </li>
          <li>
            <strong>Adding somebody by hand.</strong> An organizer can remove a person and raise the
            cap, but cannot put a named attendee into a seat from here.
          </li>
          <li>
            <strong>A push when a seat opens.</strong> A promoted attendee gets an in-app notification
            and an email when the organizer frees the seat. When another attendee frees it, their
            app shows the seat at once but nothing is sent, because no server runs on that path.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
