import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listQaSessions, type QaQuestion } from '@/lib/moderation';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, PageHeader, Panel, StatTiles, Table, Tabs, Tag } from '../../../ui';
import { moderateQuestionAction, setQaSettingsAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Content › Agenda Center › Session Q&A Manager.
 *
 * Two halves, as Whova has it: which sessions have Q&A switched on, and the
 * questions themselves.
 *
 * ── What is deliberately missing, and why ───────────────────────────────────
 *
 * Whova gives a moderator exactly three powers — hide, pin, mark answered. Two
 * are here. **Pinning is not**, because it reorders a board ranked by
 * `upvoteCount`, and that counter is written by a Cloud Function trigger that
 * does not exist on the Spark plan. A pin control fighting a frozen ranking
 * would be worse than none.
 *
 * ⚠️ The upvote numbers below are **whatever the seed wrote and do not move.**
 * They are shown because hiding them would misrepresent what the app displays
 * to attendees, and labelled because a moderator sorting by them would be
 * sorting by a fossil. The queue is ordered by time instead.
 *
 * ── Per-session moderators are not here either ──────────────────────────────
 *
 * Whova assigns a moderator per session. That needs a role the rules can read
 * and a claim to carry it; today every organizer can moderate every session,
 * which is honest for a team of ten.
 */

const STATE_COLOR: Record<QaQuestion['state'], 'grey' | 'green' | 'blue' | 'red'> = {
  pending: 'grey',
  approved: 'green',
  answered: 'blue',
  hidden: 'red',
};

export default async function SessionQaManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; session?: string }>;
}) {
  await requireOrganizer();
  const { view, session: sessionFilter } = await searchParams;
  const { sessions, questions } = await listQaSessions();

  const filtered = questions
    .filter((q) => (sessionFilter ? q.sessionId === sessionFilter : true))
    .filter((q) => {
      if (view === 'pending') return q.state === 'pending';
      if (view === 'hidden') return q.state === 'hidden';
      return true;
    });

  const pending = questions.filter((q) => q.state === 'pending').length;
  const hidden = questions.filter((q) => q.state === 'hidden').length;
  const qaOn = sessions.filter((s) => s.qaEnabled).length;

  return (
    <>
      <PageHeader
        title="Session Q&amp;A Manager"
        tags={
          pending > 0 ? (
            <Tag color="orange" fill="solid">
              {pending} awaiting review
            </Tag>
          ) : (
            <Tag color="green" fill="outline">
              nothing pending
            </Tag>
          )
        }
        links={[
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="c" href={ROUTES.conflictCheck}>
            Conflict Check
          </Link>,
          <Link key="b" href={ROUTES.moderateBoard}>
            Community Board
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Q&A enabled', value: `${qaOn} / ${sessions.length}`, sub: 'sessions' },
          {
            label: 'Polls enabled',
            value: `${sessions.filter((s) => s.pollsEnabled).length} / ${sessions.length}`,
            sub: 'tallies are inert — see below',
          },
          { label: 'Questions', value: questions.length, sub: `${hidden} hidden` },
          { label: 'Awaiting review', value: pending, sub: 'not yet visible to attendees' },
        ]}
      />

      <Banner kind="warning">
        <strong>Upvote counts do not move.</strong> They are written by a Cloud Function trigger
        that needs the Blaze plan, and the project is on Spark — so the numbers below are whatever
        the seed wrote. The app shows the same frozen figures. Poll tallies have the same problem.
        This is the single feature that is genuinely worse without a trigger.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Sessions</h2>
        <Table
          cols={[
            { key: 't', label: 'Session', className: 'cell-fill' },
            { key: 'd', label: 'When', className: 'cell-sm' },
            { key: 'q', label: 'Questions', className: 'cell-sm' },
            { key: 'qa', label: 'Q&A', className: 'cell-xs' },
            { key: 'p', label: 'Polls', className: 'cell-xs' },
          ]}
          rows={sessions.map((s) => [
            <span key="t">
              {s.title}
              {s.pendingCount > 0 && (
                <>
                  {' '}
                  <Tag color="orange" fill="outline" small>
                    {s.pendingCount} pending
                  </Tag>
                </>
              )}
            </span>,
            <span key="d" className="muted" style={{ fontSize: 12 }}>
              {s.day} {s.startsAtLocal.slice(11, 16)}
            </span>,
            s.questionCount === 0 ? (
              <span key="q" className="muted">
                —
              </span>
            ) : (
              <Link key="q" href={`?session=${s.id}`} style={{ fontSize: 13 }}>
                {s.questionCount}
              </Link>
            ),
            /*
              Forms, not links. Switching Q&A on for a session is a write, and a
              GET that changes state is one prefetch away from enabling Q&A on
              every session in the list.
            */
            <form key="qa" action={setQaSettingsAction}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="field" value="qaEnabled" />
              <input type="hidden" name="next" value={String(!s.qaEnabled)} />
              <button
                type="submit"
                style={{
                  background: 'none',
                  border: 0,
                  color: s.qaEnabled ? 'var(--ok, #2e7d32)' : 'var(--muted)',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: 0,
                }}
              >
                {s.qaEnabled ? 'On' : 'Off'}
              </button>
            </form>,
            <form key="p" action={setQaSettingsAction}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="field" value="pollsEnabled" />
              <input type="hidden" name="next" value={String(!s.pollsEnabled)} />
              <button
                type="submit"
                style={{
                  background: 'none',
                  border: 0,
                  color: s.pollsEnabled ? 'var(--ok, #2e7d32)' : 'var(--muted)',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: 0,
                }}
              >
                {s.pollsEnabled ? 'On' : 'Off'}
              </button>
            </form>,
          ])}
          empty="No sessions yet."
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          Questions {sessionFilter && <Link href="?">(clear session filter)</Link>}
        </h2>

        <Tabs
          tabs={[
            { label: `All (${questions.length})`, href: sessionFilter ? `?session=${sessionFilter}` : '?', active: !view },
            { label: `Pending (${pending})`, href: `?view=pending`, active: view === 'pending' },
            { label: `Hidden (${hidden})`, href: `?view=hidden`, active: view === 'hidden' },
          ]}
        />

        {filtered.length === 0 ? (
          <EmptyState icon="◌">
            <strong>Nothing here.</strong>
            <p className="muted" style={{ marginTop: 6 }}>
              Questions appear as attendees ask them during a session with Q&amp;A switched on.
            </p>
          </EmptyState>
        ) : (
          <Table
            cols={[
              { key: 'q', label: 'Question', className: 'cell-fill' },
              { key: 's', label: 'Session', className: 'cell-md' },
              { key: 'v', label: 'Votes', className: 'cell-xs' },
              { key: 'st', label: 'State', className: 'cell-sm' },
              { key: 'a', label: '', className: 'cell-md' },
            ]}
            rows={filtered.map((q) => [
              <span key="q">
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{q.body}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {q.authorName} · {q.createdAt.slice(0, 10)}
                </div>
              </span>,
              <span key="s" className="muted" style={{ fontSize: 12 }}>
                {q.sessionTitle}
              </span>,
              <span key="v" className="muted" style={{ fontSize: 12 }} title="Frozen — no trigger">
                {q.upvoteCount}
              </span>,
              <Tag key="st" color={STATE_COLOR[q.state]} fill="outline" small>
                {q.state}
              </Tag>,
              <div key="a" style={{ display: 'flex', gap: 8 }}>
                {(['approved', 'answered', 'hidden'] as const)
                  .filter((s) => s !== q.state)
                  .map((s) => (
                    <form key={s} action={moderateQuestionAction}>
                      <input type="hidden" name="sessionId" value={q.sessionId} />
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="state" value={s} />
                      <button
                        type="submit"
                        style={{
                          background: 'none',
                          border: 0,
                          color: s === 'hidden' ? 'var(--danger, #b3352c)' : 'var(--link)',
                          cursor: 'pointer',
                          fontSize: 12,
                          padding: 0,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s === 'approved' ? 'Approve' : s === 'answered' ? 'Answered' : 'Hide'}
                      </button>
                    </form>
                  ))}
              </div>,
            ])}
          />
        )}
      </Panel>
    </>
  );
}
