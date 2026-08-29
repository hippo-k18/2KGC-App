import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { readPolls } from '@/lib/polls';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Live Polling.
 *
 * ── This screen exists to report one broken number ──────────────────────────
 *
 * Polls are further along than almost anything else on this tab. `PollDoc` and
 * `PollVoteDoc` are modelled, the rules allow a voter to write exactly their own
 * vote document and nothing else, and the app renders a poll and takes an
 * answer. Attendees can vote right now and their votes land correctly.
 *
 * What does not work is the count. `tallies` and `totalVotes` are written by the
 * `tallyPoll` trigger, triggers need Cloud Functions, and the project is on the
 * Spark plan — so those two fields hold whatever the seed wrote and never move,
 * while the votes accumulate in the subcollection beside them. An organizer
 * reading the result off a screen mid-keynote would read a frozen number with
 * total confidence.
 *
 * So the table below prints both: the stored tally and the vote documents
 * actually on disk, counted at read time. Where they disagree the row says so.
 * Printing only one of them is the defect AGENTS.md names as this codebase's
 * recurring one — a screen claiming a capability that is absent — and here it
 * would be claiming it in front of an audience.
 *
 * ── Why the fix is not "just count them in the app too" ─────────────────────
 *
 * It could be, and that is worth knowing: Firestore's `count()` aggregation
 * works on Spark and would give a live total without any trigger. What it will
 * not give is the per-option breakdown, which needs one aggregation per option
 * per render, on every client watching. The trigger exists so that a thousand
 * phones read one document instead of running a thousand queries. `AGENTS.md`
 * calls poll tallies the one feature that is genuinely worse without a trigger,
 * and this is why.
 */
export default async function LivePollingPage() {
  await requireOrganizer();
  const { polls, enabledSessions, liveSessions, votesCast, votesShownByTallies } = await readPolls();

  const stale = polls.filter((p) => p.stale);
  const open = polls.filter((p) => p.open);

  return (
    <>
      <PageHeader
        title="Live Polling"
        tags={
          stale.length > 0 ? (
            <Tag color="red" fill="outline">{stale.length} tallies out of date</Tag>
          ) : (
            <Tag color="orange" fill="outline">tallies are not maintained</Tag>
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

      <Banner kind="danger">
        <strong>Votes are real. The totals are not.</strong> Attendees can vote and every vote is
        stored correctly, one document per voter. <code>totalVotes</code> and <code>tallies</code>{' '}
        are written by a Cloud Function trigger that cannot be deployed on the Spark plan, so they
        are frozen at whatever the seed wrote. This screen counts the vote documents instead —{' '}
        <strong>{votesCast}</strong> cast, against <strong>{votesShownByTallies}</strong> the stored
        tallies would show.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Polls', value: polls.length, sub: `${open.length} open` },
          {
            label: 'Sessions with polling on',
            value: enabledSessions,
            sub: `of ${liveSessions} live sessions`,
          },
          {
            label: 'Votes actually cast',
            value: votesCast,
            sub: votesCast === votesShownByTallies ? 'tallies agree' : `tallies say ${votesShownByTallies}`,
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Polls, with both numbers</h2>
        <Table
          cols={[
            { key: 'q', label: 'Question', className: 'cell-fill' },
            { key: 's', label: 'Session', className: 'cell-md' },
            { key: 'o', label: 'State', className: 'cell-sm' },
            { key: 'a', label: 'Votes on disk', className: 'cell-sm' },
            { key: 't', label: 'Stored tally', className: 'cell-sm' },
          ]}
          rows={polls.map((p) => [
            p.question,
            <span key="s" style={{ fontSize: 12 }}>
              {p.sessionTitle}
            </span>,
            p.open ? (
              <Tag key="o" color="green" fill="outline" small>
                open
              </Tag>
            ) : (
              <Tag key="o" color="grey" fill="outline" small>
                closed
              </Tag>
            ),
            p.actualVotes,
            // The stored number is the one that would be shown on stage, so it
            // is marked rather than merely printed when it disagrees.
            p.stale ? (
              <span key="t" style={{ color: 'var(--danger)', fontSize: 13 }}>
                {p.storedTotal} — stale
              </span>
            ) : (
              <span key="t" className="muted" style={{ fontSize: 13 }}>
                {p.storedTotal}
              </span>
            ),
          ])}
          empty="No polls have been created on any session yet."
        />
        {polls.length > 0 ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
            &ldquo;Votes on disk&rdquo; is counted from the <code>votes</code> subcollection on every
            page load and is correct. &ldquo;Stored tally&rdquo; is what the app displays to
            attendees.
          </p>
        ) : null}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Creating or editing a poll.</strong> Polls exist in the data model and in the
            app; no screen in this dashboard writes one. Building the editor before the tallies work
            would produce polls whose results nobody can read.
          </li>
          <li>
            <strong>Opening and closing a poll from here.</strong> <code>open</code> is a real field
            and flipping it is a one-line write — but the moment to flip it is on stage, from a
            phone, not from a desktop dashboard.
          </li>
          <li>
            <strong>The per-option breakdown.</strong> This screen shows totals only. Reconstructing
            each option&rsquo;s share means reading every vote document and grouping by option id,
            which is fine for one poll on this page and is exactly what a thousand attendee phones
            must not do.
          </li>
          <li>
            <strong>A results display for a projector.</strong> Whova has one. It would need the
            live tally to be trustworthy first, which is the whole content of this screen.
          </li>
          <li>
            <strong>The fix.</strong> Deploy <code>tallyPoll</code>. That needs Blaze, whose free
            quotas equal Spark&rsquo;s — the cost of unblocking this is a card on file rather than
            money.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
