import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { eventAnalytics } from '@/lib/exports';
import { Banner, PageHeader, Panel, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Gamification.
 *
 * Whova's version is a points economy: attendees earn points for scanning
 * badges, joining sessions, posting on the board and visiting booths, and a
 * leaderboard ranks them.
 *
 * ── Every ingredient is a write we do not observe ───────────────────────────
 *
 * The blocker is not a missing collection, it is that points are inherently
 * derived from other people's writes. An attendee posting on the board is a
 * client write; awarding a point for it from the client means the client
 * decides its own score, which is a leaderboard anybody can win with a debugger.
 * Awarding it from a trigger needs Cloud Functions, and this project is on the
 * Spark plan. That is the same wall that freezes reply counts and poll tallies —
 * so gamification is not one feature away, it is behind the same door as six
 * others.
 *
 * Two of Whova's game mechanics **do** have screens here already, both under
 * Exhibitor Center, and both are honest gap notes for the same reason. Linking
 * them rather than restating them keeps the argument in one place.
 */
export default async function GamificationPage() {
  await requireOrganizer();
  const a = await eventAnalytics();

  // The four scoring events Whova counts, against whether this repo can observe
  // one happening. "Observed" is the operative word: several are recorded, and
  // none is recorded anywhere a score could safely be incremented from.
  const MECHANICS = [
    {
      earn: 'Checking in at the door',
      have: 'yes' as const,
      note: 'checkIns is real, server-written and idempotent — the one scoring event that is already trustworthy.',
    },
    {
      earn: 'Posting on the community board',
      have: 'client' as const,
      note: 'The post is a client write. A client that also writes its own score is a client that writes any score.',
    },
    {
      earn: 'Attending a session',
      have: 'no' as const,
      note: 'Nothing records session attendance. Saving a session to your schedule is an intention, not a turnstile.',
    },
    {
      earn: 'Visiting a booth',
      have: 'no' as const,
      note: 'The passport contest is the feature that would record this, and it is unbuilt.',
    },
  ];

  return (
    <>
      <PageHeader
        title="Gamification"
        tags={<Tag color="red" fill="outline">blocked on Spark</Tag>}
        links={[
          <Link key="p" href="/content/exhibitor-center/passport-contest">
            Passport contest
          </Link>,
          <Link key="t" href="/content/exhibitor-center/exhibitor-trivia">
            Exhibitor trivia
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>A score has to be written by something the scorer does not control.</strong> That
        means a Cloud Function trigger, and the Firebase project is on the Spark plan, so no trigger
        can be deployed. The same wall freezes reply counts, upvote counts and poll tallies — see{' '}
        <Link href="/engagement/live-polling">Live Polling</Link> for the version of this that is
        already visible to attendees.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What we could score, if we could score</h2>
        <Table
          cols={[
            { key: 'e', label: 'Whova awards points for', className: 'cell-md' },
            { key: 'h', label: 'Do we see it?', className: 'cell-sm' },
            { key: 'n', label: '', className: 'cell-fill' },
          ]}
          rows={MECHANICS.map((m) => [
            m.earn,
            m.have === 'yes' ? (
              <Tag key="h" color="green" fill="outline" small>
                yes
              </Tag>
            ) : m.have === 'client' ? (
              <Tag key="h" color="orange" fill="outline" small>
                client-written
              </Tag>
            ) : (
              <Tag key="h" color="red" fill="outline" small>
                no
              </Tag>
            ),
            <span key="n" className="muted" style={{ fontSize: 12 }}>
              {m.note}
            </span>,
          ])}
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          One of four is scorable today. A leaderboard built on that single signal would rank
          attendees by whether they turned up, which is a list the check-in desk already has. Of{' '}
          {a.ticketHolders} ticket holders, {a.signedIn} have opened the app at all — the ceiling on
          how many could ever appear on a leaderboard.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Points, rules and a leaderboard.</strong> No collection, no screen in this
            dashboard, no surface in the app. Blocked on triggers before it is blocked on UI.
          </li>
          <li>
            <strong>Prizes and redemption.</strong> Follows from the above — nothing to redeem
            against.
          </li>
          <li>
            <strong>The passport contest and exhibitor trivia.</strong> Both are Whova game
            mechanics, both already have honest gap notes under Exhibitor Center, and both are
            blocked on a booth-side scan path rather than on triggers.
          </li>
          <li>
            <strong>Attendance gamification for online sessions.</strong> A separate Whova screen
            under Virtual &amp; Hybrid. There is no streaming integration at all, so there is no
            attendance to gamify.
          </li>
        </ul>
      </Panel>
    </>
  );
}
