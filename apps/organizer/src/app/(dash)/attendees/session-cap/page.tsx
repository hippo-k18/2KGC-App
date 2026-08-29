import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { capacityIndex } from '@/lib/cohorts';
import { listSessions, type SessionRow } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PER_PAGE, PageHeader, Pagination, Panel, SearchInput, StatTiles, Table, Tag, listParams, paginate, sortRows } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Session Cap.
 *
 * Whova caps a session, counts registrations against the cap, closes the
 * session when it fills and hands the door a list of who may come in. We have
 * the first of those four: `SessionDoc.capacity` is a number an organizer can
 * write, and `RoomDoc.capacity` is what the room seats. This screen compares
 * them.
 *
 * ── The cap is a note, not a limit, and the screen says so at the top ───────
 *
 * `models.ts` describes `capacity` as "enforced in a transaction, not by
 * rules". **There is no such transaction.** Nothing in `app/`, `apps/web/`,
 * `apps/organizer/` or `functions/` reads `SessionDoc.capacity` except
 * `conflicts-core.ts`, which raises a warning and changes nothing. The nearest
 * thing to a registration is `users/{uid}/savedSessions/{sessionId}` — a
 * private bookmark, allowed by `firestore.rules` with no count and no ceiling,
 * on a subcollection an organizer cannot even enumerate without a collection
 * group query. So there is no "seats taken" column here, because there is no
 * honest number to put in it. Whova's screen has one; showing an invented one
 * would be the fourteen-times-repeated defect this project keeps finding.
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
  const { page, sort, baseParams } = listParams(sp);

  const [sessions, caps] = await Promise.all([listSessions(), capacityIndex()]);

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
        links={[
          <Link key="sm" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="cc" href={ROUTES.conflictCheck}>
            Conflict Check
          </Link>,
        ]}
      />

      <Panel>
        <Banner kind="warning">
          <strong>A cap here is a note, not a limit.</strong> Nothing enforces{' '}
          <code>SessionDoc.capacity</code>: adding a session to your schedule in the app writes a
          private bookmark under <code>users/&#123;uid&#125;/savedSessions</code>, which the rules
          allow without counting anything, and no code anywhere compares that to the cap. So this
          screen shows what you have written down against what the room holds. It cannot show seats
          taken, because there is no number in this system that means that.
        </Banner>

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
              sub: over.length ? 'more tickets than chairs' : 'none — every cap fits its room',
            },
            {
              label: 'Cannot be checked',
              value: unknownRoom.length,
              sub: 'no room, or the room has no capacity recorded',
            },
            {
              label: 'Seats capped in total',
              value: seatsCapped,
              sub: 'the sum of the caps, not a headcount',
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
            { key: 'r', label: 'Room', className: 'cell-mdsm cell-truncate', sortKey: 'room' },
            { key: 'c', label: 'Cap', className: 'cell-xs', sortKey: 'cap' },
            { key: 's', label: 'Room seats', className: 'cell-xs', sortKey: 'seats' },
            { key: 'v', label: 'Fit', className: 'cell-sm', sortKey: 'verdict' },
          ]}
          sort={sort}
          empty={
            capped.length === 0
              ? 'No session in the programme has a capacity set. An absent cap means uncapped.'
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
                {r.session.startsAtLocal.slice(11, 16)}–{r.session.endsAtLocal.slice(11, 16)}
              </div>
            </span>,
            r.roomName ?? <span className="muted">unassigned</span>,
            <strong key="c">{r.capacity}</strong>,
            r.roomCapacity === undefined ? (
              <span key="s" className="muted">
                —
              </span>
            ) : (
              String(r.roomCapacity)
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
                  {r.headroom} spare
                </div>
              )}
            </span>,
          ])}
        />
        <Pagination total={ordered.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>

      <Panel>
        <h2 className="section-header">What is uncapped, and whether that is deliberate</h2>
        <p className="body-2">
          {uncapped.length} of the {live.length} live sessions have no capacity set. An absent{' '}
          <code>capacity</code> means uncapped, which is the honest default —{' '}
          <code>models.ts</code> is explicit that a conference which has not decided its cap should
          not have the model invent one. For a keynote in the main hall that is correct.
          {uncappedWorkshops.length > 0 ? (
            <>
              {' '}
              <strong>{uncappedWorkshops.length}</strong> of them are workshops, and a workshop
              without a cap is more often an omission than a decision — it is the format with
              equipment, tables and a facilitator who needs to know the number.
            </>
          ) : (
            ' Every workshop in the programme has one.'
          )}{' '}
          Caps are set per session in{' '}
          <Link href={ROUTES.sessionManager}>Session Manager</Link>, not here.
        </p>
        <p className="body-2">
          The &ldquo;room seats unknown&rdquo; verdict is about <code>RoomDoc.capacity</code> being
          optional and frequently unset. It means this screen could not check, not that the room is
          large enough — the two read the same on a dashboard and are opposite in a corridor, so
          they are separate verdicts rather than one green tick.
        </p>
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Registration against a cap.</strong> The feature Whova&apos;s screen exists for.
            Needs a real per-session registration — a document the organizer can count, written in a
            transaction that rejects the write when the count reaches the cap. Saving a session
            today is a bookmark in the attendee&apos;s own subcollection: it is not a claim on a
            seat, nobody but them can read it, and two people saving simultaneously cannot conflict
            because there is nothing to conflict over.
          </li>
          <li>
            <strong>Seats taken, and closing a full session.</strong> Both are downstream of the
            above. Firestore has no way to reserve across a redirect, so the same caution that
            applies to <code>quantitySold</code> on a ticket tier applies here: a counter is a count,
            not a lock.
          </li>
          <li>
            <strong>A waitlist.</strong> Whova promotes from one when a seat frees. There is no
            waitlist document, and a waitlist without a notification to send is a list nobody is
            told they are on.
          </li>
          <li>
            <strong>Session check-in against the cap.</strong> <code>checkInLists</code> is modelled
            per event rather than per session, and every write under it is Admin-SDK only. Counting
            people into a room is a different loop from checking them into the conference.
          </li>
          <li>
            <strong>Editing a cap.</strong> This screen reads. The write belongs next to the rest of
            the session fields in Session Manager, where the room is chosen — a cap set away from
            the room it has to fit is how a session ends up 40 over.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
