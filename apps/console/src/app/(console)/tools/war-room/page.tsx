import Link from 'next/link';
import { COLLECTIONS, EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { countWhereEvent, listSessions, recentAudit } from '@/lib/data';
import { recentErrors } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';
import { targetDescription } from '@/lib/firestore';
import { clockOf, todayInEventZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

/**
 * War room v0 — a stub with the right shape (DECISIONS.md #12). Rough on
 * purpose: four numbers, the audit trail and the error ring. Phase 1 turns this
 * into the real thing.
 */
export default async function WarRoomPage() {
  await requireOrganizer();

  const today = todayInEventZone();
  const [attendees, announcements, sessions, audit] = await Promise.all([
    countWhereEvent(COLLECTIONS.users),
    countWhereEvent(COLLECTIONS.announcements),
    listSessions(),
    recentAudit(),
  ]);

  const todaysSessions = sessions.filter((s) => s.day === today);
  const errors = recentErrors();

  return (
    <>
      <p className="crumbs">
        <Link href="/tools">Tools</Link> {' › '}
      </p>
      <h1>
        War room <span className="tag ours">ours</span>
      </h1>
      <div className="banner">
        <strong>This screen is ours, not Whova&apos;s.</strong> Nothing in §1 corresponds to it.
        Whova&apos;s live view is scattered across seven surfaces with no unified analytics home
        (§23), and its post-event report is not self-serve at all — you complete a survey, an
        account manager is notified, and a 50–70 page PDF arrives in 10–14 days (§23.4). This is
        the opposite of that: one page, current, for the two days when something is going wrong and
        someone is standing in front of you.
      </div>
      <p className="muted">
        {EVENT.name} · {targetDescription()} · &ldquo;today&rdquo; is {today} in {EVENT.timeZone},
        not in this laptop&apos;s zone. Refresh to update; nothing here polls.
      </p>

      <div className="tiles">
        <div className="tile">
          <div className="n">{attendees}</div>
          attendees
        </div>
        <div className="tile">
          <div className="n">{todaysSessions.length}</div>
          sessions today
        </div>
        <div className="tile">
          <div className="n">{announcements}</div>
          announcements sent
        </div>
        <div className="tile">
          <div className="n">{sessions.length}</div>
          sessions total
        </div>
        <div className="tile">
          <div className={errors.length ? 'n error' : 'n'}>{errors.length}</div>
          recent errors
        </div>
      </div>

      <h2>Sessions today ({today})</h2>
      {todaysSessions.length === 0 ? (
        <p className="muted">
          Nothing scheduled today — the event runs {sessions[0]?.day} to{' '}
          {sessions[sessions.length - 1]?.day}.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Title</th>
              <th>Room</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {todaysSessions.map((s) => (
              <tr key={s.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {clockOf(s.startsAtLocal)}–{clockOf(s.endsAtLocal)}
                </td>
                <td>
                  <Link href={`${ROUTES.sessionManager}/${s.id}`}>{s.title}</Link>
                </td>
                <td>{s.roomName ?? '—'}</td>
                <td>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Recent changes (auditLog)</h2>
      {audit.length === 0 ? (
        <p className="muted">No writes yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Target</th>
              <th>Fields</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{a.at ?? '—'}</td>
                <td>{a.actor}</td>
                <td>{a.action}</td>
                <td>
                  <code>{a.targetPath}</code>
                </td>
                <td>{a.changed.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Recent errors</h2>
      <p className="muted">
        In-process ring buffer, cleared on restart. Sentry is DECISIONS.md #12 and Phase 1.
      </p>
      {errors.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Where</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((e, i) => (
              <tr key={`${e.at}-${i}`}>
                <td style={{ whiteSpace: 'nowrap' }}>{e.at}</td>
                <td>{e.context}</td>
                <td className="error">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
