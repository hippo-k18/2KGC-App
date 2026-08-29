import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { GapPanel, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Artifact Center › Competition.
 *
 * Best-poster voting. Downstream of Artifact Manager — there is nothing to vote
 * on — but it also carries a problem of its own that is worth recording, because
 * it is the reason this is not simply "the artifact model plus a button".
 *
 * **Voting is the one thing this stack is currently worst at.** Poll votes were
 * a `Record<uid, number>` map once, and 1,000 voters against Firestore's
 * ~1 write/sec/document limit took sixteen minutes to drain. The fix was
 * uid-keyed subcollections, which is also how reactions and upvotes work — but a
 * *tally* over those subcollections is function-owned, and the aggregate
 * triggers do not exist because the project is on the Spark plan. So a
 * competition would collect votes correctly and be unable to display a
 * leaderboard that moves.
 *
 * Firestore's `count()` aggregation at read time is the Spark-compatible
 * substitute and would work here, because a poster leaderboard is read by an
 * organizer occasionally rather than by a thousand phones continuously.
 */
export default async function ArtifactCompetitionPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Competition"
        links={[
          <Link key="a" href="/content/artifact-center-poster-pitch-gallery/artifact-manager">
            Artifact Manager
          </Link>,
          <Link key="g" href="/engagement/gamification">
            Gamification
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Runs a best-poster or best-pitch contest: attendees vote in the app, judges score against
          criteria the organizer defines, and a leaderboard settles it. Organizers can restrict
          voting to a segment — judges only, or one vote per attendee.
        </p>

        <h2 className="section-header">What this would need</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Artifacts to vote on.</strong> There is no artifact collection —{' '}
            <strong>6–8 days</strong>, sized on Artifact Manager.
          </li>
          <li>
            <strong>Votes as a uid-keyed subcollection,</strong> never a map. That rule is not
            stylistic: a map of votes on one document is a single-document write hotspot, and it has
            already cost this project sixteen minutes of drain time in testing.
          </li>
          <li>
            <strong>A tally an organizer can read.</strong> The aggregate triggers that own counters
            here need Cloud Functions and therefore the Blaze plan. Firestore{' '}
            <code>count()</code> at read time avoids that entirely for a leaderboard this small, and
            is the right answer rather than a workaround.
          </li>
          <li>
            <strong>Judge scoring,</strong> which is a different shape from attendee voting —
            weighted criteria and named judges, not one anonymous tap.
          </li>
        </ul>

        <p className="body-2">
          <strong>3–4 days</strong> on top of the artifact model, assuming attendee voting only.
          Judge scoring roughly doubles it.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Everything.</strong> No artifacts, no votes, no judges, no leaderboard.
          </li>
          <li>
            <strong>Live tallies generally.</strong> Session Q&amp;A and live polls already render
            in the app and their counts never move, for the same reason. That is the honest state of
            every tally in this project.
          </li>
          <li>
            <strong>Prizes.</strong> Somebody still has to buy them.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
