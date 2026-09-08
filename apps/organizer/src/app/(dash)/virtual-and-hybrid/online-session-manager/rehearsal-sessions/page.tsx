import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSessions, type SessionRow } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { clockOf } from '@/lib/time';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Online Session Manager › Rehearsal Sessions.
 *
 * Whova books a practice slot in a private copy of the streaming room. There is
 * no streaming room here, so that screen has nothing to schedule — but the
 * failure it exists to prevent is entirely real and has nothing to do with
 * streaming: a speaker who has never seen the projector starts eight minutes
 * late, and at a multi-track conference that eight minutes lands on everybody.
 *
 * So this is the in-person version, computed rather than authored: the window
 * before each session in the room it happens in, and whether that window is
 * actually free.
 *
 * ── Why it is derived and not a bookable thing ──────────────────────────────
 *
 * A booking would need a new collection, a form, and somebody to keep it in
 * sync with a programme that moves every week until the fortnight before.
 * Every fact needed for the answer is already on `SessionDoc` — the room, the
 * day, the wall clock and the speaker names — and derived means it cannot go
 * stale. What it deliberately does not do is record *whether* a check happened:
 * a boolean nothing sets would read as a working tracker, which is the defect
 * class AGENTS.md names as this codebase's recurring one. Chasing the speakers
 * is Message Speakers, which really sends, and ticking them off is Projects &
 * Checklists, which really stores tasks. Both are linked below.
 */

/** How long before a session somebody wants the room, in minutes. */
const AV_WINDOW_MINUTES = 15;

/** Wall clock `…THH:MM` to minutes since midnight, for arithmetic within one day. */
function minutesOf(wall: string): number {
  const [h, m] = wall.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
}

export default async function RehearsalSessionsPage() {
  await requireOrganizer();
  const sessions = await listSessions();

  /**
   * Only sessions that are actually going to happen, have a room and have
   * somebody to rehearse. A session with no speaker named is a break or a
   * plenary the organizers run themselves, and putting it on an AV-check list
   * gives the person working through that list rows to ignore.
   */
  const needsCheck = sessions.filter(
    (s) =>
      s.status !== 'cancelled' &&
      s.roomName &&
      s.speakerNames.length > 0 &&
      s.day &&
      s.startsAtLocal,
  );

  /**
   * The window is blocked when another session is still running in that room
   * when it opens.
   *
   * Back-to-back programming is the normal case at a multi-track conference and
   * it is exactly what makes an AV check impossible: the previous talk is
   * over-running into the fifteen minutes the next speaker needed. Naming those
   * rows is the whole value of the screen — they are the ones that have to be
   * rehearsed at a different time entirely, usually the previous evening.
   */
  const blocker = (s: SessionRow): SessionRow | undefined => {
    const opens = minutesOf(s.startsAtLocal) - AV_WINDOW_MINUTES;
    return sessions.find(
      (o) =>
        o.id !== s.id &&
        o.status !== 'cancelled' &&
        o.roomId &&
        o.roomId === s.roomId &&
        o.day === s.day &&
        minutesOf(o.startsAtLocal) < minutesOf(s.startsAtLocal) &&
        minutesOf(o.endsAtLocal) > opens,
    );
  };

  const rows = needsCheck.map((s) => ({ session: s, blockedBy: blocker(s) }));
  const blocked = rows.filter((r) => r.blockedBy);
  const speakers = new Set(needsCheck.flatMap((s) => s.speakerNames));

  return (
    <>
      <PageHeader
        title="Rehearsal Sessions"
        info={
          <>
            <strong>The in-person version</strong>
            <p>
              There is no virtual stage to book a slot on, so this is the AV check in the real room:
              the {AV_WINDOW_MINUTES} minutes before each talk, and whether the previous session is
              still in there. Nothing here records that a check happened. Projects &amp; Checklists
              does that.
            </p>
          </>
        }
        tags={
          blocked.length > 0 ? (
            <Tag color="orange" fill="solid">
              {blocked.length} with no window
            </Tag>
          ) : undefined
        }
        actions={
          <Link href={ROUTES.messageSpeakers} className="whova-btn-main">
            Message Speakers
          </Link>
        }
        links={[
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="p" href="/content/project-management/projects-and-checklists">
            Projects &amp; Checklists
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Talks needing a check', value: rows.length, sub: 'has a room and a speaker' },
          { label: 'Speakers', value: speakers.size, sub: 'people to get into a room' },
          {
            label: 'No window',
            value: blocked.length,
            sub: blocked.length ? 'room busy beforehand' : 'every room is free in time',
          },
          { label: 'Window', value: `${AV_WINDOW_MINUTES} min`, sub: 'before each talk' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>AV check schedule</h2>
        {rows.length === 0 ? (
          <NotInputted
            what="sessions with a room and a speaker"
            action={
              <Link href={ROUTES.sessionManager} className="whova-btn-main">
                Open Session Manager
              </Link>
            }
          />
        ) : (
          <Table
            cols={[
              { key: 'd', label: 'Day', className: 'cell-sm' },
              { key: 'w', label: 'Check at', className: 'cell-sm' },
              { key: 'r', label: 'Room', className: 'cell-mdsm' },
              { key: 't', label: 'Talk', className: 'cell-fill' },
              { key: 'p', label: 'Speaker', className: 'cell-md' },
            ]}
            rows={rows.map((r) => {
              const opens = minutesOf(r.session.startsAtLocal) - AV_WINDOW_MINUTES;
              const at = `${String(Math.floor(opens / 60)).padStart(2, '0')}:${String(opens % 60).padStart(2, '0')}`;
              return [
                r.session.day,
                r.blockedBy ? (
                  <span key="w" style={{ whiteSpace: 'nowrap' }}>
                    <Tag color="orange" small>
                      busy
                    </Tag>{' '}
                    <span className="muted">
                      until {clockOf(r.blockedBy.endsAtLocal)}
                    </span>
                  </span>
                ) : (
                  <strong key="w" style={{ whiteSpace: 'nowrap' }}>
                    {at}
                  </strong>
                ),
                r.session.roomName,
                <span key="t">
                  <Link href={`${ROUTES.sessionManager}/${r.session.id}`}>{r.session.title}</Link>{' '}
                  <span className="muted">{clockOf(r.session.startsAtLocal)}</span>
                </span>,
                r.session.speakerNames.join(', '),
              ];
            })}
          />
        )}
      </Panel>

      {blocked.length > 0 && (
        <Panel style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>The ones with nowhere to rehearse</h2>
          <p className="body-2">
            Another session is still running in the room when the {AV_WINDOW_MINUTES}-minute window
            opens, so these speakers cannot check their slides beforehand on the day. The usual fix
            is the evening before, or the first free slot in the same room —{' '}
            <Link href={ROUTES.conflictCheck}>Conflict Check</Link> shows what else is in it.
          </p>
          <Table
            cols={[
              { key: 't', label: 'Talk', className: 'cell-fill' },
              { key: 'b', label: 'Room is busy with', className: 'cell-fill' },
            ]}
            rows={blocked.map((r) => [
              <span key="t">
                {r.session.day} {clockOf(r.session.startsAtLocal)} · {r.session.title}
              </span>,
              <Link key="b" href={`${ROUTES.sessionManager}/${r.blockedBy!.id}`}>
                {r.blockedBy!.title}
              </Link>,
            ])}
          />
        </Panel>
      )}

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No rehearsal booking, because there is no virtual room to book.</strong>{' '}
            Building the scheduler before the stream would be furniture in an empty lot.
          </li>
          <li>
            <strong>No rehearsed / not-rehearsed status per speaker.</strong> Nothing on{' '}
            <code>SpeakerDoc</code> records readiness, and adding a boolean nothing sets would read
            as a working tracker. Use a task in Projects &amp; Checklists.
          </li>
          <li>
            <strong>No calendar invitations.</strong> The email sender is real, but it sends
            transactional HTML — there is no <code>.ics</code> generation anywhere in this repo.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
