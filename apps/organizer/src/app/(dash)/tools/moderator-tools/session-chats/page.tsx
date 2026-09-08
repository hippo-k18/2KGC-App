import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel, Table } from '../../../ui';

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
            <strong>Sessions have no chat channel</strong>
            <p>
              A live chat is a companion to a stream, and nothing streams. What an attendee can
              write during a talk is a Q&amp;A question, and that has a real queue.
            </p>
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
        <NotInputted
          what="session chat messages"
          action={
            <Link href="/tools/moderator-tools/moderate-session-qanda" className="whova-btn-main">
              Moderate Session Q&amp;A
            </Link>
          }
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where attendee text actually goes</h2>
        <Table
          cols={[
            { key: 'w', label: 'Channel', className: 'cell-md' },
            { key: 'm', label: 'Moderation', className: 'cell-fill' },
          ]}
          rows={[
            [
              'Session Q&A',
              <span key="m">
                Hide and mark answered, at{' '}
                <Link href={ROUTES.qaManager}>Session Q&amp;A Manager</Link>.
              </span>,
            ],
            [
              'Community board',
              <span key="m">
                Posts and replies: hide, restore and delete, at{' '}
                <Link href={ROUTES.moderateBoard}>Community Board</Link>.
              </span>,
            ],
            [
              'Direct messages',
              <span key="m">
                Deliberately <strong>not</strong> moderated. Thread membership comes from{' '}
                <code>participantIds</code> and the rules deny everyone else. A moderator inbox
                over private messages would mean loosening that, which is a much larger decision
                than a screen.
              </span>,
            ],
          ]}
        />
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
