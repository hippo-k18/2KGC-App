import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { attendeeAttendance, formatHours } from '@/lib/attendance';
import { listAttendees } from '@/lib/data';
import { listBoardForModeration } from '@/lib/moderation';
import { ROUTES } from '@/lib/nav';
import {
  NotInputted,
  PER_PAGE,
  PageHeader,
  Pagination,
  Panel,
  StatTiles,
  Table,
  Tabs,
  Tag,
  listParams,
  paginate,
} from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Attendee Activity.
 *
 * Whova's version is built on session-view events emitted by a player: which
 * stream someone watched, for how long, what they clicked. None of that exists
 * here and none of it should be invented — an event log would mean a new
 * high-write collection and a tracker inside an app used by named individuals
 * holding a badge, which is a privacy decision rather than a feature.
 *
 * ── What this screen is instead ─────────────────────────────────────────────
 *
 * The same question answered from state somebody wrote on purpose. Three real
 * reads, joined per attendee:
 *
 *   `attendeeAttendance()` — which sessions a badge was scanned into, and the
 *   scheduled length of them. ⚠️ **Scheduled, not sat through**: it is the
 *   length of the session someone was counted into at the door, and nobody is
 *   scanned on the way out. Said in the `info` tip because it changes how the
 *   hours column should be read.
 *
 *   `listBoardForModeration()` — posts and replies, joined on the author's uid.
 *
 *   `listAttendees()` — the roll, so somebody who has done *nothing* still has
 *   a row. That is the whole point of the Quiet tab: an organizer's real
 *   question a day in is who has gone missing, and a table built only from
 *   activity cannot answer it.
 *
 * ── Why no per-attendee drill-down ──────────────────────────────────────────
 *
 * The sessions each person was counted into are already listed on the
 * certificates and attendance screens, which own that view. A second one here
 * would be a second place for the same numbers to be read from.
 */
export default async function AttendeeActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const { page, baseParams } = listParams(sp);
  const view = typeof sp.view === 'string' ? sp.view : 'all';

  const [attendees, attendance, posts] = await Promise.all([
    listAttendees(),
    attendeeAttendance(),
    listBoardForModeration(),
  ]);

  /** registrationId → sessions counted in, and the scheduled minutes of them. */
  const attended = new Map(attendance.rows.map((r) => [r.registration.id, r]));

  /**
   * uid → posts and replies written.
   *
   * Replies are counted separately from posts rather than summed, because they
   * are different signals: a reply is somebody answering another attendee,
   * which is the behaviour a community board exists to produce.
   */
  const wrote = new Map<string, { posts: number; replies: number }>();
  const bump = (uid: string, key: 'posts' | 'replies') => {
    const entry = wrote.get(uid) ?? { posts: 0, replies: 0 };
    entry[key] += 1;
    wrote.set(uid, entry);
  };
  for (const p of posts) {
    bump(p.authorId, 'posts');
    for (const r of p.replies) bump(r.authorId, 'replies');
  }

  const rows = attendees.map((a) => {
    const att = a.registrationId ? attended.get(a.registrationId) : undefined;
    const w = a.uid ? wrote.get(a.uid) : undefined;
    return {
      attendee: a,
      sessions: att?.sessions.length ?? 0,
      minutes: att?.minutes ?? 0,
      posts: w?.posts ?? 0,
      replies: w?.replies ?? 0,
      /** Any trace at all: they opened the app, were scanned, or wrote something. */
      active: Boolean(a.signedIn) || (att?.sessions.length ?? 0) > 0 || Boolean(w),
    };
  });

  const active = rows.filter((r) => r.active);
  const quiet = rows.filter((r) => !r.active);

  const shown = (view === 'quiet' ? quiet : view === 'active' ? active : rows).sort(
    (a, b) =>
      b.sessions - a.sessions ||
      b.posts + b.replies - (a.posts + a.replies) ||
      a.attendee.name.localeCompare(b.attendee.name),
  );

  return (
    <>
      <PageHeader
        title="Attendee Activity"
        info={
          <>
            <strong>How hours are counted</strong>
            <p>
              Badges are scanned on the way in only, so Hours is the scheduled length of the
              sessions an attendee was scanned into.
            </p>
          </>
        }
        links={[
          <Link key="a" href={ROUTES.analyticsExports}>
            Analytics &amp; Exports
          </Link>,
          <Link key="at" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="c" href={ROUTES.checkIn}>
            Check-in
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Attendees', value: rows.length, sub: 'registered' },
          { label: 'Active', value: active.length, sub: 'app, check-in or community' },
          { label: 'Inactive', value: quiet.length, sub: 'no activity yet' },
          {
            label: 'Sessions counted',
            value: attendance.tracked,
            sub: `of ${attendance.live} on the programme`,
          },
        ]}
      />

      <Tabs
        tabs={[
          { label: `Everyone (${rows.length})`, href: '?', active: view === 'all' },
          { label: `Active (${active.length})`, href: '?view=active', active: view === 'active' },
          { label: `Inactive (${quiet.length})`, href: '?view=quiet', active: view === 'quiet' },
        ]}
      />

      <Panel>
        {shown.length === 0 ? (
          <NotInputted what="attendees" />
        ) : (
          <>
            <Table
              cols={[
                { key: 'n', label: 'Attendee', className: 'cell-fill' },
                { key: 't', label: 'Ticket', className: 'cell-mdsm' },
                { key: 'a', label: 'App', className: 'cell-sm' },
                { key: 's', label: 'Sessions', className: 'cell-sm' },
                { key: 'h', label: 'Hours', className: 'cell-sm' },
                { key: 'p', label: 'Wrote', className: 'cell-mdsm' },
              ]}
              rows={paginate(shown, page, PER_PAGE).map((r) => [
                <span key="n">
                  {r.attendee.name}
                  {r.attendee.company ? (
                    <span className="muted"> · {r.attendee.company}</span>
                  ) : null}
                </span>,
                r.attendee.ticketType ?? '',
                r.attendee.signedIn ? (
                  <Tag key="a" color="green" small>
                    yes
                  </Tag>
                ) : (
                  <span className="muted">no</span>
                ),
                r.sessions,
                r.minutes > 0 ? formatHours(r.minutes) : 0,
                <span key="p" style={{ whiteSpace: 'nowrap' }}>
                  {[
                    r.posts > 0 ? `${r.posts} ${r.posts === 1 ? 'post' : 'posts'}` : '',
                    r.replies > 0 ? `${r.replies} ${r.replies === 1 ? 'reply' : 'replies'}` : '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>,
              ])}
            />
            <Pagination
              total={shown.length}
              page={page}
              perPage={PER_PAGE}
              baseParams={baseParams}
            />
          </>
        )}
      </Panel>
    </>
  );
}
