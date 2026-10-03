import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { EmptyState, GapPanel, PageHeader, Panel } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Attendance Gamification.
 *
 * Points for joining sessions, a leaderboard, prizes.
 *
 * ── Two objections, and the second is the one that decides it ───────────────
 *
 * The score would be computed from session check-ins, and a session check-in is
 * a badge scan at a door. Points per scan makes the optimal strategy "be
 * scanned in as many rooms as possible", which is precisely the behaviour a
 * conference with parallel tracks does not want: a full room of people staying
 * for the whole talk scores identically to four doorway appearances.
 *
 * And a public leaderboard names attendees and their movements. This project
 * keeps a separate `directory` projection precisely so an attendee who opts out
 * has no record leaving the server; a leaderboard would need an opt-in of its
 * own, and an opt-in leaderboard with twelve participants is not a leaderboard.
 *
 * Neither of those is a reason to describe the feature on screen. The
 * attendance data behind it is real and is reported without a score at
 * Analytics & Exports and Attendee Activity, both linked below.
 */
export default async function AttendanceGamificationPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Attendance Gamification"
        links={[
          <Link key="a" href={ROUTES.analyticsExports}>
            Analytics &amp; Exports
          </Link>,
          <Link key="c" href={ROUTES.checkIn}>
            Check-in
          </Link>,
          <Link key="v" href="/virtual-and-hybrid/attendee-activity">
            Attendee Activity
          </Link>,
        ]}
      />

      <Panel>
        <EmptyState>
          <p className="empty-title">Not available yet</p>
          <p className="empty-sub">
            Points, prizes and a leaderboard are not available yet. Attendee Activity shows who attended what.
          </p>
        </EmptyState>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No points, no leaderboard, no prizes.</strong> Nothing in{' '}
            <code>packages/shared/src/models.ts</code> scores an attendee, and nothing should be
            added speculatively.
          </li>
          <li>
            <strong>Attendance is measured, just not scored.</strong>{' '}
            <Link href={ROUTES.analyticsExports}>Analytics &amp; Exports</Link> reports real
            check-in numbers from real scans, which is the useful half without the incentive.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
