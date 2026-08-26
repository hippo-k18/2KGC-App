import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listQaSessions } from '@/lib/moderation';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tools › Moderator Tools › Moderate Session Q&A.
 *
 * Whova reaches the same queue from two places in its nav — under the agenda,
 * where you think about a session, and under moderator tools, where you think
 * about a shift. Both open one queue.
 *
 * The manager is already built at Content › Agenda Center › Session Q&A
 * Manager, so this screen sends people there instead of rendering a second copy
 * with its own moderate action. Two queues over one collection is how a
 * question gets hidden in one tab and answered in the other; the counts here
 * are read-only for exactly that reason.
 */
export default async function ModerateSessionQandAPage() {
  await requireOrganizer();
  const { sessions, questions } = await listQaSessions();

  const pending = questions.filter((q) => q.state === 'pending').length;
  const hidden = questions.filter((q) => q.state === 'hidden').length;
  const answered = questions.filter((q) => q.state === 'answered').length;

  return (
    <>
      <PageHeader
        title="Moderate Session Q&A"
        actions={
          <Link href={ROUTES.qaManager} className="whova-btn-main">
            Open Session Q&amp;A Manager
          </Link>
        }
        links={[
          <Link key="b" href={ROUTES.moderateBoard}>
            Community Board
          </Link>,
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>One queue, reached from two places.</strong> Every moderation action lives in{' '}
        <Link href={ROUTES.qaManager}>Session Q&amp;A Manager</Link>. This screen only counts what
        is waiting — a second set of hide buttons over the same questions would let two moderators
        disagree about the same row.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Waiting', value: pending, sub: 'not yet reviewed' },
          { label: 'Answered', value: answered, sub: 'marked from the stage' },
          { label: 'Hidden', value: hidden, sub: 'taken down by a moderator' },
          { label: 'Sessions with Q&A', value: sessions.length, sub: 'switched on' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a moderator can actually do</h2>
        <p className="body-2">
          Two of Whova&rsquo;s three powers: <strong>hide</strong> and <strong>mark answered</strong>
          . <strong>Pin</strong> is missing on purpose — pinning reorders a board ranked by{' '}
          <code>upvoteCount</code>, and that counter is written by a Cloud Function trigger that
          cannot be deployed on the Spark plan. A pin control fighting a frozen ranking would be
          worse than no pin control.
        </p>
        <p className="body-2">
          There is also no per-session moderator assignment. Today every organizer can moderate every
          session, which is honest for a team of ten and would need a role the rules can read before
          it could be anything else.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No moderation actions on this screen, deliberately.</strong> They belong to the
            one queue, at <Link href={ROUTES.qaManager}>Session Q&amp;A Manager</Link>.
          </li>
          <li>
            <strong>No moderator shift assignment or hand-off notes.</strong> Whova&rsquo;s version
            of this screen is organised around who is on duty; there is no staff model here to
            organise around.
          </li>
          <li>
            <strong>Upvote counts do not move.</strong> They are whatever the seed wrote, because the
            counter trigger is unbuilt — so the queue is ordered by time instead of popularity.
          </li>
        </ul>
      </Panel>
    </>
  );
}
