import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { readPolls } from '@/lib/polls';
import { ROUTES } from '@/lib/nav';
import {
  Banner,
  EmptyState,
  GapPanel,
  NotInputted,
  PageHeader,
  Panel,
  ProgressBar,
  StatTiles,
  Table,
  Tag,
} from '../../ui';
import { PollForm } from '../poll-form';
import { publishTallyAction, setPollOpenAction } from '../poll-actions';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Live Polling.
 *
 * ── Two numbers, and the difference between them is the whole screen ───────
 *
 * `PollDoc.tallies` and `totalVotes` are written by the `tallyPoll` trigger, and
 * the triggers in `functions/` are written, tested and undeployed — blocked on
 * one IAM grant (`OWNER-ACTIONS.md` §3). The votes themselves land correctly,
 * one document per voter, in the `votes` subcollection.
 *
 * So this dashboard never reads the stored numbers as truth. `lib/polls.ts`
 * counts the vote documents on every load and splits them by option, which
 * needs no trigger and no plan upgrade. The stored numbers appear only as *what
 * the attendee's phone currently shows*, and where the two disagree the row
 * says so — because the phone's number is the one that ends up on a slide.
 *
 * ── Publish the count is the honest bridge, not a workaround ───────────────
 *
 * The dashboard can count because it is one reader. A thousand phones cannot,
 * which is what the trigger exists to prevent. `publishTallyAction` counts once
 * on the server and writes the result, so the app reads one document and shows
 * a correct figure — a snapshot rather than a live tally. During a vote that is
 * still in progress there is no substitute for the trigger, and the header's
 * "i" says so in one sentence rather than a paragraph of banner.
 */
export default async function LivePollingPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  await requireOrganizer();
  const { edit, new: creating } = await searchParams;
  const { polls, enabledSessions, liveSessions, votesCast, sessions } = await readPolls();

  // `sessionId:pollId`, because a poll id is only unique within its session.
  const editing = edit ? polls.find((p) => `${p.sessionId}:${p.id}` === edit) : undefined;
  const showForm = Boolean(creating) || Boolean(editing);

  const open = polls.filter((p) => p.open);
  /** Open polls whose published figure no longer matches the votes on disk. */
  const misreported = open.filter((p) => p.stale);

  return (
    <>
      <PageHeader
        title="Live Polling"
        info={
          <>
            <strong>Counted here, published on demand</strong>
            <p>
              The counts on this screen are always current. Attendees see the result from the last
              time you pressed <em>Publish the count</em>.
            </p>
            <p>A result that updates by itself in the app is not available yet.</p>
          </>
        }
        actions={
          showForm ? (
            <Link href="/engagement/live-polling" className="whova-btn-main secondary">
              Back to list
            </Link>
          ) : (
            <Link href="?new=1" className="whova-btn-main primary">
              + New poll
            </Link>
          )
        }
        tags={
          open.length > 0 ? (
            <Tag color="green" fill="solid">
              {open.length} open
            </Tag>
          ) : (
            <Tag color="grey">none open</Tag>
          )
        }
        links={[
          <Link key="q" href={ROUTES.qaManager}>
            Session Q&amp;A Manager
          </Link>,
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      {/*
        Kept as a banner, and the only one: an open poll whose published figure
        is behind is a wrong number on somebody's phone, in a room, right now.
        Everything else about how the counting works is a caveat and lives
        behind the header's "i".
      */}
      {misreported.length > 0 && !showForm ? (
        <Banner kind="warning">
          <strong>
            {misreported.length} open {misreported.length === 1 ? 'poll shows' : 'polls show'}{' '}
            attendees an out-of-date result.
          </strong>{' '}
          The counts below are correct. Press <em>Publish the count</em> on a poll to send the same
          numbers to the app.
        </Banner>
      ) : null}

      <StatTiles
        tiles={[
          { label: 'Polls', value: polls.length, sub: `${open.length} open to votes` },
          {
            label: 'Sessions with polling on',
            value: enabledSessions,
            sub: `of ${liveSessions} live sessions`,
          },
          { label: 'Votes cast', value: votesCast },
        ]}
      />

      {showForm ? (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>
            {editing ? `Edit “${editing.question}”` : 'New poll'}
          </h2>
          <PollForm key={editing?.id ?? 'new'} existing={editing} sessions={sessions} />
        </Panel>
      ) : polls.length === 0 ? (
        <Panel>
          <EmptyState
            action={
              <Link href="?new=1" className="whova-btn-main secondary">
                Create the first one
              </Link>
            }
          >
            <p className="empty-title">No polls yet</p>
          </EmptyState>
        </Panel>
      ) : (
        polls.map((p) => (
          <Panel key={`${p.sessionId}:${p.id}`} style={{ marginBottom: 16 }}>
            <div style={{ alignItems: 'baseline', display: 'flex', gap: 10 }}>
              <h2 style={{ fontSize: 15, margin: 0 }}>{p.question}</h2>
              {p.open ? (
                <Tag color="green" fill="outline" small>
                  open
                </Tag>
              ) : (
                <Tag color="grey" fill="outline" small>
                  closed
                </Tag>
              )}
              <span style={{ flex: 1 }} />
              <Link href={`?edit=${p.sessionId}:${p.id}`} style={{ fontSize: 12 }}>
                Edit
              </Link>
            </div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>
              {p.sessionDay} {p.startsAtLocal.slice(11, 16)} · {p.sessionTitle}
            </div>

            <Table
              cols={[
                { key: 'o', label: 'Option', className: 'cell-md' },
                { key: 'v', label: 'Votes', className: 'cell-xs' },
                { key: 'b', label: '', className: 'cell-fill' },
                { key: 's', label: 'Shown in the app', className: 'cell-sm' },
              ]}
              rows={p.options.map((o) => [
                o.label,
                <strong key="v">{o.votes}</strong>,
                <ProgressBar
                  key="b"
                  pct={p.actualVotes > 0 ? Math.round((o.votes / p.actualVotes) * 100) : 0}
                />,
                o.votes === o.storedVotes ? (
                  <span key="s" className="muted" style={{ fontSize: 12 }}>
                    {o.storedVotes}
                  </span>
                ) : (
                  <span key="s" style={{ color: 'var(--danger)', fontSize: 12 }}>
                    {o.storedVotes}
                  </span>
                ),
              ])}
              empty={<NotInputted what="options on this poll" compact />}
            />

            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
              <form action={setPollOpenAction}>
                <input type="hidden" name="sessionId" value={p.sessionId} />
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="open" value={p.open ? 'false' : 'true'} />
                <button type="submit" className="whova-btn-main secondary small">
                  {p.open ? 'Close voting' : 'Open voting'}
                </button>
              </form>

              <form action={publishTallyAction}>
                <input type="hidden" name="sessionId" value={p.sessionId} />
                <input type="hidden" name="id" value={p.id} />
                <button
                  type="submit"
                  className={`whova-btn-main small ${p.stale ? 'primary' : 'secondary'}`}
                >
                  Publish the count
                </button>
              </form>

              <span className="muted" style={{ fontSize: 12 }}>
                {p.actualVotes} {p.actualVotes === 1 ? 'vote' : 'votes'} counted.{' '}
                {p.talliesUpdatedAt
                  ? `The app shows ${p.storedTotal}, published ${p.talliesUpdatedAt.slice(0, 10)} ${p.talliesUpdatedAt.slice(11, 16)}.`
                  : `The app shows ${p.storedTotal}; nothing has been published yet.`}
              </span>
            </div>
          </Panel>
        ))
      )}

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>A tally that moves on its own.</strong> The one thing on this screen that
            genuinely needs <code>tallyPoll</code> deployed. Publishing the count is a snapshot; a
            vote arriving a second later is not in it.
          </li>
          <li>
            <strong>Opening and closing from a phone.</strong> The moment to close a poll is on
            stage. These are forms on a desktop dashboard, which is the wrong device for it.
          </li>
          <li>
            <strong>A results display for a projector.</strong> The per-option split is computed
            here; a full-screen public page for it is not built.
          </li>
          <li>
            <strong>Multi-select polls.</strong> <code>PollVoteDoc.optionIds</code> is an array and
            the counting here handles it, but the editor writes single-answer polls only and the
            model has no field saying how many answers are allowed.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
