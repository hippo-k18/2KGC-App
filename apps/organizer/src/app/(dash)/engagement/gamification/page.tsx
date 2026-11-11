import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { eventAnalytics } from '@/lib/exports';
import { EmptyState, GapPanel, PageHeader, Panel, StatTiles } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Gamification.
 *
 * A points economy — points for scanning badges, joining sessions, posting on
 * the board and visiting booths, with a leaderboard over the total.
 *
 * ── Why there is no leaderboard here, stated once in a comment ─────────────
 *
 * Points are inherently derived from other people's writes. An attendee posting
 * on the board is a *client* write; awarding a point for it from the client
 * means the client decides its own score, which is a leaderboard anybody wins
 * with a debugger. Awarding it from a trigger is the right shape, and the 10
 * Firestore triggers in `functions/` are written and tested but undeployed —
 * blocked on one IAM grant (`OWNER-ACTIONS.md` §3), not on code.
 *
 * The dashboard can count at read time where a screen needs a number, and does
 * so on Live Polling and the community board. A score cannot be handled that
 * way: it is not a count of one collection, it is an accumulation over events
 * that have to be observed as they happen and attributed to a person.
 *
 * So this screen measures the ceiling — how many people could ever appear on a
 * leaderboard — and stops. The counting arguments live in `functions/SPEC.md`.
 */
export default async function GamificationPage() {
  await requireOrganizer();
  const a = await eventAnalytics();

  return (
    <>
      <PageHeader
        title="Gamification"
        info={
          <>
            <strong>Nothing is scored yet</strong>
            <p>Points, scoring rules and the leaderboard are not available yet.</p>
          </>
        }
        links={[
          <Link key="p" href="/content/exhibitor-center/passport-contest">
            Passport contest
          </Link>,
          <Link key="t" href="/content/exhibitor-center/exhibitor-trivia">
            Exhibitor trivia
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Points awarded', value: 0 },
          { label: 'Scoring rules', value: 0 },
          {
            label: 'Could appear on a leaderboard',
            value: a.ticketHoldersSignedIn,
            sub: `of ${a.ticketHolders} ticket holders`,
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Leaderboard</h2>
        <EmptyState>
          <p className="empty-title">No leaderboard yet</p>
          <p className="empty-sub">Points and scoring rules are not available yet.</p>
        </EmptyState>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Points, rules and a leaderboard.</strong> No collection and no surface in the
            app. Blocked on the trigger deploy (`OWNER-ACTIONS.md` §3) before it is blocked on UI.
          </li>
          <li>
            <strong>Prizes and redemption.</strong> Follows from the above — nothing to redeem
            against.
          </li>
          <li>
            <strong>Board posts and booth visits as scoring events.</strong> A post is a client
            write, and a client that writes its own score writes any score. A booth visit is not
            recorded at all — the passport contest is the feature that would record it.
          </li>
          <li>
            <strong>Attendance gamification for online sessions.</strong> There is no streaming
            integration, so there is no online attendance to score.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
