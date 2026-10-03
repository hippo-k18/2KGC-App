import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { GapPanel, NotInputted, PageHeader, Panel } from '../../../ui';

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
 * *tally* over those subcollections is written by a Cloud Function trigger, and
 * those have never deployed (`OWNER-ACTIONS.md` §3). So a competition would
 * collect votes correctly and be unable to display a leaderboard that moves.
 *
 * Firestore's `count()` aggregation at read time is the substitute that needs no
 * trigger, and it is the right answer here rather than a workaround: a poster
 * leaderboard is read by an organizer occasionally rather than by a thousand
 * phones continuously.
 */
export default async function ArtifactCompetitionPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Competition"
        info={
          <>
            <strong>Nothing to vote on yet</strong>
            <p>
              Voting on posters, demos and pitches is not available yet.
            </p>
          </>
        }
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
        <NotInputted what="entries" />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Everything.</strong> No artifacts, no votes, no judges, no leaderboard.
          </li>
          <li>
            <strong>Votes as a uid-keyed subcollection,</strong> never a map. That rule is not
            stylistic: a map of votes on one document is a single-document write hotspot, and it
            has already cost this project sixteen minutes of drain time in testing.
          </li>
          <li>
            <strong>Judge scoring,</strong> which is a different shape from attendee voting —
            weighted criteria and named judges, not one anonymous tap.
          </li>
          <li>
            <strong>Live tallies generally.</strong> Session Q&amp;A and live polls already render
            in the app and their counts never move, for the same reason.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
