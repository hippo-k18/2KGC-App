import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, Table } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tools › Moderator Tools › Session Chats.
 *
 * A session chat is the live text channel beside a stream. It exists in Whova
 * because remote attendees have no other way to react to a talk; in a physical
 * room they turn to the person next to them.
 *
 * That makes this screen doubly absent: the feature it moderates is missing,
 * and the reason the feature is missing is the same streaming decision recorded
 * across the Virtual & Hybrid cluster. Worth stating rather than filing as
 * generic unbuilt work — this is not a gap somebody forgot, it is downstream of
 * a choice.
 */
export default async function ModerateSessionChatsPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Session Chats"
        links={[
          <Link key="b" href={ROUTES.moderateBoard}>
            Community Board
          </Link>,
          <Link key="q" href={ROUTES.qaManager}>
            Session Q&amp;A Manager
          </Link>,
          <Link key="v" href="/virtual-and-hybrid/virtual-and-hybrid-setup">
            Virtual &amp; Hybrid Setup
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>Sessions have no chat.</strong> A live chat channel is a companion to a stream, and
        nothing streams. What attendees can write during a talk is a Q&amp;A question, and that has
        a real moderation screen.
      </Banner>

      <Panel>
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
                Real, and moderated at{' '}
                <Link href={ROUTES.qaManager}>Session Q&amp;A Manager</Link> — hide and mark
                answered. Pinning is deliberately absent because it would reorder a board ranked by
                a counter that does not move on the Spark plan.
              </span>,
            ],
            [
              'Community board',
              <span key="m">
                Real, with posts and replies, moderated at{' '}
                <Link href={ROUTES.moderateBoard}>Community Board</Link>.
              </span>,
            ],
            [
              'Direct messages',
              <span key="m">
                Real, and deliberately <strong>not</strong> moderated. Thread membership comes from{' '}
                <code>participantIds</code> and the rules deny everyone else — a moderator inbox
                over private messages would mean loosening that, which is a much larger decision
                than a screen.
              </span>,
            ],
            [
              'Session chat',
              <span key="m" className="muted">
                Does not exist.
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
