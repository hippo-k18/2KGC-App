import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Attendance Gamification.
 *
 * Points for joining sessions, a leaderboard, prizes. `ROADMAP.md` names this
 * one twice — once inside the Virtual & Hybrid cut, and once in "real features,
 * low value for KGC's format" alongside Passport Contest and Exhibitor Trivia.
 *
 * The objection is not that leaderboards are frivolous. It is that a
 * leaderboard measures the thing the event is not optimising for. KGC's rooms
 * hold a few hundred practitioners choosing between parallel tracks; the
 * desired behaviour is *choosing well and staying*, and a points-per-session
 * score rewards the opposite — walking into four rooms to farm scans.
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
        ]}
      />

      <Banner kind="warning">
        <strong>Recommended cut, not deferred work.</strong> This is one of the four screens the
        roadmap argues against building on the merits rather than on cost — trade-show mechanics for
        a research conference.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Awards points for joining sessions, watching for a minimum duration, asking questions and
          answering polls, then ranks everyone on a public leaderboard with prizes at the top. For a
          virtual trade show this genuinely works: attention is scarce and the leaderboard is the
          only lever an organizer has over it.
        </p>

        <h2 className="section-header">Why it would misfire here</h2>
        <p className="body-2">
          The score would be computed from session check-ins, and session check-in is a badge scan
          at a door. Points per scan makes the optimal strategy &ldquo;be scanned in as many rooms
          as possible&rdquo;, which is precisely the behaviour a conference with parallel tracks
          does not want — a full room of people staying for the whole talk is the outcome, and it
          scores identically to four doorway appearances.
        </p>
        <p className="body-2">
          There is a second problem that is harder to design around: a public leaderboard names
          attendees and their movements. This project keeps a separate <code>directory</code>{' '}
          projection precisely so an attendee who opts out of the directory has no record leaving
          the server. A leaderboard would need an opt-in of its own, and an opt-in leaderboard with
          twelve participants is not a leaderboard.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No points, no leaderboard, no prizes.</strong> Nothing in{' '}
            <code>packages/shared/src/models.ts</code> scores an attendee, and nothing should be
            added speculatively.
          </li>
          <li>
            <strong>The counters it would need are unbuilt anyway.</strong> Any score aggregating
            client writes wants a Cloud Function trigger, and the project is on the Spark plan —
            the same blocker that freezes <code>replyCount</code> and poll tallies.
          </li>
          <li>
            <strong>Attendance is measured, just not scored.</strong>{' '}
            <Link href={ROUTES.analyticsExports}>Analytics &amp; Exports</Link> reports real
            check-in numbers from real scans, which is the useful half without the incentive.
          </li>
        </ul>
      </Panel>
    </>
  );
}
