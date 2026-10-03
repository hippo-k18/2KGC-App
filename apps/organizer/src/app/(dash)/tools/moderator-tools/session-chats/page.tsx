import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { EmptyState, GapPanel, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tools › Moderator Tools › Session Chats.
 *
 * A session chat is the live text channel beside a stream. It exists in Whova
 * because remote attendees have no other way to react to a talk; in a physical
 * room they turn to the person next to them.
 *
 * That makes this screen doubly absent — the feature it moderates is missing,
 * and it is missing because of the streaming decision recorded across the
 * Virtual & Hybrid cluster rather than because anybody forgot. What the screen
 * does instead is answer the question a moderator actually arrives with: where
 * does attendee text go, and which of those places has a queue.
 */
export default async function ModerateSessionChatsPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Session Chats"
        info={
          <>
            <strong>Sessions have no chat</strong>
            <p>During a talk attendees can ask a Q&amp;A question, and those can be moderated.</p>
          </>
        }
        links={[
          <Link key="b" href={ROUTES.moderateBoard}>
            Community Board
          </Link>,
          <Link key="q" href={ROUTES.qaManager}>
            Session Q&amp;A Manager
          </Link>,
        ]}
      />

      <Panel>
        <EmptyState
          action={
            <Link href="/tools/moderator-tools/moderate-session-qanda" className="whova-btn-main secondary">
              Moderate Session Q&amp;A
            </Link>
          }
        >
          <p className="empty-title">Session chat is not available yet</p>
        </EmptyState>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What you can moderate</h2>
        <p className="body-2" style={{ marginBottom: 0 }}>
          Session questions at <Link href={ROUTES.qaManager}>Session Q&amp;A Manager</Link>, and
          posts and replies at <Link href={ROUTES.moderateBoard}>Community Board</Link>. Direct
          messages are private and are not moderated.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No chat collection and no queue.</strong> Nothing under{' '}
            <code>sessions/&#123;id&#125;</code> holds free-form messages.
          </li>
          <li>
            <strong>Live moderation would need a different shape anyway.</strong> Reviewing text
            during a talk is a seconds-scale job; this dashboard is server-rendered and pages
            refresh on navigation, which is right for a queue and wrong for a live feed.
          </li>
          <li>
            <strong>No word filter or auto-moderation anywhere.</strong> Every moderation action in
            this project is a human decision with an audit entry, on purpose.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
