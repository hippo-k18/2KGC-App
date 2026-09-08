import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { callUrl, listCalls, windowOf, type CallRow } from '@/lib/calls';
import { listTrackOptions } from '@/lib/data';
import { countSubmissions, listSubmissions } from '@/lib/submissions';
import { ROUTES } from '@/lib/nav';
import { Banner, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';
import { CallForm } from './call-form';
import { CFA_BASE } from './routes';

export const dynamic = 'force-dynamic';

/**
 * Content › Call For Speakers/Abstracts.
 *
 * ── What this screen used to be ─────────────────────────────────────────────
 *
 * Nine hundred words arguing that a call for papers was the clearest case on
 * the parity list for *not* building one, over three stat tiles counting the
 * output of a call that had happened somewhere else. That argument was sound
 * while the programme committee ran on a spreadsheet, and `CFA-PLAN.md`
 * supersedes it: the owner asked for the feature, so it is built rather than
 * described, and the essay is now the plan file rather than the page body.
 *
 * ── The shape of the thing ──────────────────────────────────────────────────
 *
 * A call for abstracts is a **second public surface** with its own audience.
 * The people it is for hold no ticket, have no account and may never attend, so
 * `isRegistered()` — the gate for everything in `firestore.rules` — is false for
 * them and has to stay false. `calls`, `submissions`, `submissions/{id}/identity`
 * and `reviewers` therefore have no `match` block at all: every write is
 * Admin-SDK through a server action, and the submitter reaches their own draft
 * with an HMAC capability link, the scheme `/order/{token}` already proves.
 *
 * The consequence worth repeating on every screen in this folder: **the deadline
 * is enforced by the server action or it is not enforced.** There is no rule
 * underneath to catch a write that a hidden button let through.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 *
 * Scheduled reminders. `CallDoc.reminderDaysBefore` is a list of dates, and
 * nothing fires on them: scheduled work wants Cloud Tasks and everything in
 * `functions/` is blocked on one IAM grant (`OWNER-ACTIONS.md` §3). A reminder
 * is a button an organizer presses, and the `info` tip says so rather than
 * letting the field imply an automation that is not running.
 */
export default async function CallForSpeakersPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; edit?: string }>;
}) {
  await requireOrganizer();
  const { new: creating, edit } = await searchParams;

  const [calls, tracks] = await Promise.all([listCalls(), listTrackOptions()]);
  const editing = edit ? calls.find((c) => c.id === edit) : undefined;
  const showForm = Boolean(creating) || Boolean(editing);

  /*
   * Counts come from the submissions themselves rather than from a counter on
   * the call. There is no trigger to keep one — `functions/` is blocked — and a
   * denormalised count that nothing maintains is a number that is wrong in
   * exactly the direction that flatters the screen.
   */
  const perCall = await Promise.all(
    calls.map(async (c) => ({ call: c, counts: countSubmissions(await listSubmissions(c.id)) })),
  );

  const totals = perCall.reduce(
    (acc, { counts }) => ({
      total: acc.total + counts.total,
      draft: acc.draft + counts.draft,
      decided: acc.decided + counts.accepted + counts.rejected,
      accepted: acc.accepted + counts.accepted,
    }),
    { total: 0, draft: 0, decided: 0, accepted: 0 },
  );

  const openCall = perCall.find(({ call }) => windowOf(call).state === 'open');

  return (
    <>
      <PageHeader
        title="Call For Speakers/Abstracts"
        info={
          <>
            <strong>Reminders are a button, not a schedule</strong>
            <p>
              The nudge dates on a call are the days the dashboard offers you a send button on.
              Nothing fires on its own: scheduled work needs Cloud Tasks and <code>functions/</code>{' '}
              is waiting on one IAM grant.
            </p>
          </>
        }
        tags={
          calls.length > 0 ? (
            <Tag color="blue">
              {calls.length} call{calls.length === 1 ? '' : 's'}
            </Tag>
          ) : null
        }
        actions={
          showForm ? (
            <Link href={CFA_BASE} className="whova-btn-main secondary">
              Back
            </Link>
          ) : (
            <Link href="?new=1" className="whova-btn-main">
              + New call
            </Link>
          )
        }
        links={[
          <Link key="s" href={`${CFA_BASE}/submissions`}>
            Submissions
          </Link>,
          <Link key="f" href={`${CFA_BASE}/form-builder`}>
            Submission form
          </Link>,
          <Link key="r" href={`${CFA_BASE}/reviewers`}>
            Reviewers
          </Link>,
          <Link key="m" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      {showForm ? (
        <Panel>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            {editing ? `Edit “${editing.title}”` : 'New call for abstracts'}
          </h2>
          <CallForm existing={editing} tracks={tracks} />
        </Panel>
      ) : (
        <>
          {openCall && (
            /*
             * Operational, not a caveat: a call that is open is collecting
             * submissions right now, and the number of days left is the thing
             * that decides what an organizer does in the next minute.
             */
            <Banner kind="info">
              <strong>“{openCall.call.title}” is open.</strong> It closes in{' '}
              {windowOf(openCall.call).daysLeft} day
              {windowOf(openCall.call).daysLeft === 1 ? '' : 's'}, on{' '}
              {openCall.call.closesAtLocal.replace('T', ' ')}. Submissions arrive at{' '}
              <code>{callUrl(openCall.call.id)}</code>.
            </Banner>
          )}

          <StatTiles
            tiles={[
              {
                label: 'Submissions',
                value: totals.total,
                sub: totals.total === 0 ? 'not inputted yet' : 'across every call',
              },
              {
                label: 'Incomplete',
                value: totals.draft,
                sub: totals.draft === 0 ? 'nobody has started and stopped' : 'started, not submitted',
              },
              {
                label: 'Decided',
                value: totals.decided,
                sub: `${totals.accepted} accepted`,
              },
            ]}
          />

          {calls.length === 0 ? (
            <Panel>
              <NotInputted
                what="call for abstracts"
                action={
                  <Link className="whova-btn-main" href="?new=1">
                    Create one
                  </Link>
                }
              />
              <p className="body-2" style={{ marginBottom: 0 }}>
                A call gets its own public page at <code>/submit/&#123;id&#125;</code> on the
                website. People submitting to it need no account and no ticket. They come back to
                their own draft through a signed link, and every write goes through a server action
                that checks the deadline.
              </p>
            </Panel>
          ) : (
            <Panel>
              <Table
                cols={[
                  { key: 'title', label: 'Call' },
                  { key: 'window', label: 'Window', className: 'cell-md' },
                  { key: 'subs', label: 'Submissions', className: 'cell-sm' },
                  { key: 'form', label: 'Questions', className: 'cell-sm' },
                  { key: 'act', label: '', className: 'cell-md' },
                ]}
                rows={perCall.map(({ call, counts }) => [
                  <CallCell key="t" call={call} />,
                  <WindowCell key="w" call={call} />,
                  <span key="s">
                    {counts.total}
                    {counts.draft > 0 ? (
                      <span className="muted" style={{ fontSize: 12, display: 'block' }}>
                        {counts.draft} incomplete
                      </span>
                    ) : null}
                  </span>,
                  <span key="f">
                    {call.form.length}
                    <span className="muted" style={{ fontSize: 12, display: 'block' }}>
                      v{call.formVersion}
                    </span>
                  </span>,
                  <span key="a" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <Link href={`?edit=${call.id}`}>Edit</Link>
                    <Link href={`${CFA_BASE}/submissions?call=${call.id}`}>Submissions</Link>
                    <Link href={`${CFA_BASE}/form-builder?call=${call.id}`}>Form</Link>
                  </span>,
                ])}
              />
            </Panel>
          )}
        </>
      )}
    </>
  );
}

function CallCell({ call }: { call: CallRow }) {
  return (
    <span>
      <strong>{call.title}</strong>
      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
        {call.status === 'published' ? callUrl(call.id) : `/submit/${call.id}, not published`}
      </span>
    </span>
  );
}

/**
 * The window, computed by the same function the public portal's refusal uses.
 *
 * Deliberately not a second reading of the two dates: a screen that said "open"
 * while the server refused the write would be the worst possible arrangement,
 * because the person who finds out is the submitter and the error is on their
 * side of the transaction.
 */
function WindowCell({ call }: { call: CallRow }) {
  const { state, daysLeft } = windowOf(call);
  const colour =
    state === 'open' ? 'green' : state === 'closed' || state === 'cancelled' ? 'red' : 'orange';

  return (
    <span>
      <Tag color={colour}>{state === 'not-open' ? 'not open yet' : state}</Tag>
      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
        {state === 'open'
          ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
          : `${call.opensAtLocal.slice(0, 10)} → ${call.closesAtLocal.slice(0, 10)}`}
      </span>
    </span>
  );
}
