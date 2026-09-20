import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listQaSessions } from '@/lib/moderation';
import { ROUTES } from '@/lib/nav';
import { clockOf, todayInEventZone } from '@/lib/time';
import { eventTimeZone } from '@/lib/event';
import { EmptyState, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tools › Moderator Tools › Moderate Session Q&A.
 *
 * Whova reaches the same queue from two places in its nav — under the agenda,
 * where you think about a session, and under moderator tools, where you think
 * about a shift. Both open one queue.
 *
 * The manager is already built at Content › Agenda Center › Session Q&A
 * Manager, so this screen renders no second set of hide buttons: two queues
 * over one collection is how a question gets hidden in one tab and answered in
 * the other. What it adds instead is the shift view the manager does not have —
 * which room has a backlog, in the order the rooms are running — so a moderator
 * arriving mid-morning knows where to go first.
 */
export default async function ModerateSessionQandAPage() {
  await requireOrganizer();
  const { sessions, questions } = await listQaSessions();
  const today = todayInEventZone(new Date(), await eventTimeZone());

  const pending = questions.filter((q) => q.state === 'pending').length;
  const hidden = questions.filter((q) => q.state === 'hidden').length;
  const answered = questions.filter((q) => q.state === 'answered').length;

  /**
   * Only the sessions with Q&A switched on and at least one question waiting.
   *
   * A moderator's screen should be a work list, not a catalogue: a session with
   * an empty queue needs nothing from them, and printing thirty rows of zeroes
   * is how the two rows that matter get missed. Today's sessions sort first for
   * the same reason.
   */
  const backlog = sessions
    .filter((s) => s.qaEnabled && s.pendingCount > 0)
    .sort(
      (a, b) =>
        Number(b.day === today) - Number(a.day === today) ||
        b.pendingCount - a.pendingCount ||
        a.startsAtLocal.localeCompare(b.startsAtLocal),
    );

  return (
    <>
      <PageHeader
        title="Moderate Session Q&A"
        info={
          <>
            <strong>Moderate in the Session Q&amp;A Manager</strong>
            <p>This screen shows which sessions have questions waiting. Hide and mark answered there.</p>
          </>
        }
        tags={
          pending > 0 ? (
            <Tag color="orange" fill="solid">
              {pending} waiting
            </Tag>
          ) : (
            <Tag color="green" fill="outline">
              queue clear
            </Tag>
          )
        }
        actions={
          <Link href={ROUTES.qaManager} className="whova-btn-main secondary">
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

      <StatTiles
        tiles={[
          { label: 'Waiting', value: pending, sub: 'not yet reviewed' },
          { label: 'Answered', value: answered, sub: 'marked from the stage' },
          { label: 'Hidden', value: hidden, sub: 'taken down by a moderator' },
          {
            label: 'Sessions with Q&A',
            value: sessions.filter((s) => s.qaEnabled).length,
            sub: `${sessions.length} on the programme`,
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where the backlog is</h2>
        {backlog.length === 0 ? (
          <EmptyState compact>
            <p className="empty-title">No questions waiting</p>
          </EmptyState>
        ) : (
          <Table
            cols={[
              { key: 'w', label: 'When', className: 'cell-sm' },
              { key: 's', label: 'Session', className: 'cell-fill' },
              { key: 'p', label: 'Waiting', className: 'cell-sm' },
              { key: 'h', label: 'Hidden', className: 'cell-sm' },
            ]}
            rows={backlog.map((s) => [
              <span key="w" style={{ whiteSpace: 'nowrap' }}>
                {s.day === today ? <strong>today</strong> : s.day} {clockOf(s.startsAtLocal)}
              </span>,
              <Link key="s" href={`${ROUTES.qaManager}?session=${s.id}&view=pending`}>
                {s.title}
              </Link>,
              <strong key="p">{s.pendingCount}</strong>,
              s.hiddenCount || <span className="muted">—</span>,
            ])}
          />
        )}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
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
            <strong>Pin is absent and upvote counts do not move.</strong> Both wait on the
            `upvoteCount` trigger, which is written and undeployed — a pin control fighting a frozen
            ranking would be worse than no pin control.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
