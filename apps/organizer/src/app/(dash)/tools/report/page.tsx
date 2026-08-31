import Link from 'next/link';
import { COLLECTIONS, EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { sessionAttendance } from '@/lib/attendance';
import { countWhereEvent, listSessions, recentAudit } from '@/lib/data';
import { recentErrors } from '@/lib/errors';
import { targetDescription } from '@/lib/firestore';
import { ROUTES } from '@/lib/nav';
import { clockOf, todayInEventZone } from '@/lib/time';
import { Banner, PageHeader, Panel, StatTiles, StatusTag, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tools > Report — and it is deliberately not the report Whova gives you.
 *
 * Whova's Report is not self-serve: you complete a survey, an account manager
 * is notified, and a 50–70 page PDF arrives in 10 to 14 days. Their live view,
 * meanwhile, is scattered across seven surfaces with no unified analytics home.
 * This is the opposite of both — one page, current, for the two days when
 * something is going wrong and someone is standing in front of you.
 *
 * It occupies Whova's `Tools > Report` slot rather than a nav node of our own
 * invention, because an organizer looking for "how is it going" looks under
 * Tools, and adding a tenth tab to a nine-tab bar to hold one screen is exactly
 * the kind of tidying-up that makes a familiar product feel unfamiliar.
 *
 * Nothing here polls. A page that silently goes stale during an incident is
 * worse than one that obviously needs a refresh.
 */
export default async function ReportPage() {
  await requireOrganizer();

  const today = todayInEventZone();
  const [attendees, announcements, registrations, sessions, audit, attendance] = await Promise.all([
    countWhereEvent(COLLECTIONS.users),
    countWhereEvent(COLLECTIONS.announcements),
    countWhereEvent(COLLECTIONS.registrations),
    listSessions(),
    recentAudit(),
    sessionAttendance(),
  ]);

  /**
   * How full each room is, for the sessions running today.
   *
   * This is the number the screen exists for: at 11:40 on day one the question
   * is "is anybody in room 2", and until now the only answer available anywhere
   * was a door count for the whole conference. `null` means no door was opened
   * for that session — printed as "no door" rather than as 0, because a zero
   * here would send somebody to an empty-looking room that is actually full.
   */
  const countedIn = new Map(
    attendance.rows.filter((r) => r.tracked).map((r) => [r.session.id, r.countedIn]),
  );

  const todaysSessions = sessions.filter((s) => s.day === today).sort((a, b) =>
    a.startsAtLocal.localeCompare(b.startsAtLocal),
  );
  const errors = recentErrors();
  const days = [...new Set(sessions.map((s) => s.day))].sort();

  return (
    <>
      <PageHeader
        title="Report"
        tags={
          <Tag color="blue" fill="solid">
            ours
          </Tag>
        }
        links={[
          <Link key="t" href="/tools">
            Tools
          </Link>,
          <span key="d" className="muted">
            today is {today} in {EVENT.timeZone}
          </span>,
          <span key="e" className="muted">
            {targetDescription()}
          </span>,
        ]}
      />

      <Panel>
        <Banner kind="info">
          <strong>This screen is ours, not Whova&apos;s.</strong> Whova&apos;s post-event report is
          not self-serve — you fill in a survey, an account manager is notified, and a 50–70 page
          PDF arrives in 10 to 14 days. Their live numbers are spread across seven surfaces with no
          unified home. This is one page, current, for the two days when it matters. Nothing polls;
          refresh to update.
        </Banner>

        <StatTiles
          tiles={[
            { label: 'Registrations', value: registrations, sub: 'imported tickets' },
            {
              label: 'Signed in',
              value: attendees,
              sub: registrations ? `${Math.round((attendees / registrations) * 100)}% of tickets` : undefined,
            },
            { label: 'Sessions today', value: todaysSessions.length, sub: `${sessions.length} total` },
            { label: 'Announcements sent', value: announcements },
            { label: 'Recent errors', value: errors.length, sub: 'in-process ring buffer' },
          ]}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">Sessions today ({today})</h2>
        {todaysSessions.length === 0 ? (
          <p className="body-2 muted">
            Nothing scheduled today — the event runs {days[0] ?? '—'} to {days[days.length - 1] ?? '—'}.
          </p>
        ) : (
          <Table
            cols={[
              { key: 't', label: 'Time', className: 'cell-sm' },
              { key: 'n', label: 'Session', className: 'cell-fill' },
              { key: 'r', label: 'Room', className: 'cell-mdsm' },
              { key: 'i', label: 'Counted in', className: 'cell-sm' },
              { key: 's', label: 'Status', className: 'cell-sm' },
            ]}
            rows={todaysSessions.map((s) => [
              <span key="t" style={{ whiteSpace: 'nowrap' }}>
                {clockOf(s.startsAtLocal)}–{clockOf(s.endsAtLocal)}
              </span>,
              <Link key="n" href={`${ROUTES.sessionManager}/${s.id}`}>
                {s.title}
              </Link>,
              s.roomName ?? <span className="muted">—</span>,
              countedIn.has(s.id) ? (
                <strong key="i">{countedIn.get(s.id)}</strong>
              ) : (
                /*
                  Links to Check-in rather than to the list that does not exist:
                  `?list=` for an absent id silently falls back to the main door,
                  which would put somebody on the wrong screen at the one moment
                  they cannot afford it. Start on the Session card creates it.
                */
                <Link key="i" href={ROUTES.checkIn} className="muted">
                  no door
                </Link>
              ),
              <StatusTag key="s" status={s.status} />,
            ])}
          />
        )}
      </Panel>

      <Panel>
        <h2 className="section-header">Audit trail ({audit.length})</h2>
        <p className="body-2">
          Every write this dashboard has made, newest first. The Admin SDK bypasses{' '}
          <code>firestore.rules</code> entirely — which is the correct posture for an organizer tool
          and is exactly why the writes have to be recorded somewhere a human can read them.
        </p>
        <Table
          cols={[
            { key: 'w', label: 'When', className: 'cell-mdsm' },
            { key: 'a', label: 'Actor', className: 'cell-mdsm' },
            { key: 'x', label: 'Action', className: 'cell-sm' },
            { key: 't', label: 'Target', className: 'cell-fill' },
          ]}
          empty="No writes yet"
          rows={audit.map((a) => [
            <span key="w" style={{ whiteSpace: 'nowrap' }}>
              {a.at ?? '—'}
            </span>,
            a.actor,
            <Tag key="x" color={a.action === 'checkin.undo' ? 'orange' : 'blue'}>
              {a.action}
            </Tag>,
            <code key="t" style={{ fontSize: 12 }}>
              {a.targetPath}
            </code>,
          ])}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">Recent errors ({errors.length})</h2>
        <p className="body-2">
          An in-process ring buffer, not a log service — it empties on restart and does not survive
          a second server process. Adequate for one laptop during Phase 0 and for nothing else.
        </p>
        <Table
          cols={[
            { key: 'w', label: 'When', className: 'cell-mdsm' },
            { key: 'c', label: 'Where', className: 'cell-mdsm' },
            { key: 'm', label: 'Message', className: 'cell-fill' },
          ]}
          empty="No errors recorded"
          rows={errors.map((e) => [
            <span key="w" style={{ whiteSpace: 'nowrap' }}>
              {e.at}
            </span>,
            e.context,
            <span key="m" style={{ color: 'var(--danger)' }}>
              {e.message}
            </span>,
          ])}
        />
      </Panel>
    </>
  );
}
