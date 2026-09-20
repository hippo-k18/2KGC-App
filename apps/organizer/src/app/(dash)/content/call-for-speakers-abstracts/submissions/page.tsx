import Link from 'next/link';
import type { SubmissionStatus } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listCalls, windowOf } from '@/lib/calls';
import { listTrackOptions } from '@/lib/data';
import { countSubmissions, listSubmissions, type SubmissionRow } from '@/lib/submissions';
import {
  Banner,
  NotInputted,
  PageHeader,
  Pagination,
  Panel,
  PER_PAGE,
  SearchInput,
  StatTiles,
  Table,
  Tabs,
  Tag,
  listParams,
  paginate,
} from '../../../ui';
import { rankByTrack, OVERALL_MAX } from '@kgc/scripts/src/lib/review-core';
import { CFA_BASE } from '../routes';
import { BulkDecisionBar, RowCheckbox, SelectAllCheckbox } from './bulk-decision';

export const dynamic = 'force-dynamic';

/**
 * Content › Call For Speakers/Abstracts › Submissions.
 *
 * ── Drafts are first-class here, and that is the whole point ────────────────
 *
 * `CFA-PLAN.md` phase 2 is entirely about the people who started and stopped.
 * Whova has an Incomplete Submissions tab because most of the work of running a
 * call is chasing them, and a submission that only existed once it was finished
 * could not be chased at all. So `draft` is a status like any other and it has
 * its own tab.
 *
 * ── Ordered by `updatedAt`, never by `submittedAt` ─────────────────────────
 *
 * A draft has no `submittedAt`, and Firestore drops documents that lack the
 * ordering field from the query entirely — so ordering by it would make the
 * incompletes invisible on the screen that exists to find them. `updatedAt` is
 * also the better question: who touched this last, and how long ago.
 *
 * ── The search runs in memory, on purpose ──────────────────────────────────
 *
 * Firestore has no substring match, and the useful search here is across a
 * title, an abstract, an author's name and their affiliation — three of which
 * live on two different documents. A call is hundreds of submissions, not
 * millions, and `listSubmissions` has already read them all to count them.
 */

const TABS: { key: 'all' | SubmissionStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'under-review', label: 'Under review' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'waitlisted', label: 'Waitlisted' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'draft', label: 'Incomplete' },
  { key: 'withdrawn', label: 'Withdrawn' },
];

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const { page, baseParams } = listParams(sp);

  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const calls = await listCalls();
  if (calls.length === 0) {
    return (
      <>
        <PageHeader title="Submissions" links={[<Link key="b" href={CFA_BASE}>Call setup</Link>]} />
        <Panel>
          <NotInputted
            what="call for abstracts"
            action={
              <Link className="whova-btn-main primary" href={`${CFA_BASE}?new=1`}>
                Create one
              </Link>
            }
          />
        </Panel>
      </>
    );
  }

  const callId = one('call') && calls.some((c) => c.id === one('call')) ? one('call')! : calls[0].id;
  const call = calls.find((c) => c.id === callId)!;
  const status = (one('status') ?? 'all') as 'all' | SubmissionStatus;
  const q = (one('q') ?? '').trim().toLowerCase();
  const ranking = one('view') === 'ranking';

  const [all, tracks] = await Promise.all([listSubmissions(callId), listTrackOptions()]);
  const counts = countSubmissions(all);
  const trackName = new Map(tracks.map((t) => [t.id, t.name]));

  const filtered = all
    .filter((s) => status === 'all' || s.status === status)
    .filter((s) => (q ? matches(s, q) : true));

  const rows = paginate(filtered, page, PER_PAGE);
  const { state } = windowOf(call);

  const tabHref = (key: string) => {
    const p = new URLSearchParams(baseParams);
    p.set('call', callId);
    if (key === 'all') p.delete('status');
    else p.set('status', key);
    p.delete('page');
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Submissions"
        info={
          <>
            <strong>Authors and blind review</strong>
            <p>
              Organizers always see the author. Whether reviewers see the author is set by the
              review mode on the call.
            </p>
          </>
        }
        tags={<Tag color="blue">{counts.total} in this call</Tag>}
        links={[
          <Link key="b" href={CFA_BASE}>
            Call setup
          </Link>,
          <Link key="f" href={`${CFA_BASE}/form-builder?call=${callId}`}>
            Submission form
          </Link>,
          <Link key="r" href={`${CFA_BASE}/reviewers`}>
            Reviewers
          </Link>,
          ranking ? (
            <Link key="v" href={`?call=${callId}`}>
              List
            </Link>
          ) : (
            <Link key="v" href={`?call=${callId}&view=ranking`}>
              Ranking by track
            </Link>
          ),
        ]}
      />

      {state === 'open' && (
        <Banner kind="info">
          <strong>This call is still open.</strong> Submissions can change under you until{' '}
          {call.closesAtLocal.replace('T', ' ')}. An author may still be editing anything below
          that is not yet decided.
        </Banner>
      )}

      <StatTiles
        tiles={[
          {
            label: 'Submitted',
            value:
              counts.submitted +
              counts.underReview +
              counts.accepted +
              counts.waitlisted +
              counts.rejected,
            sub: counts.total === 0 ? 'none yet' : `${counts.underReview} under review`,
          },
          {
            label: 'Incomplete',
            value: counts.draft,
            sub: counts.draft === 0 ? 'none' : 'started, never submitted',
          },
          {
            label: 'Accepted',
            value: counts.accepted,
            sub:
              counts.awaitingPromotion > 0
                ? `${counts.awaitingPromotion} not yet on the agenda`
                : counts.accepted === 0
                  ? 'no decisions yet'
                  : counts.waitlisted > 0
                    ? `${counts.waitlisted} on the waiting list`
                    : 'all on the agenda',
          },
        ]}
      />

      {ranking ? (
        <RankingPanels
          all={all}
          trackOrder={call.trackIds}
          trackName={trackName}
          hasCriteria={call.rubric.length > 0}
        />
      ) : (
      <Panel>
        <form method="get" style={{ alignItems: 'flex-end', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {calls.length > 1 && (
            <div className="whova-form-group" style={{ margin: 0 }}>
              <label className="whova-form-label" htmlFor="call">
                Call
              </label>
              <select id="call" name="call" defaultValue={callId} className="whova-text-input whova-input-lg">
                {calls.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          {calls.length === 1 && <input type="hidden" name="call" value={callId} />}
          {status !== 'all' && <input type="hidden" name="status" value={status} />}
          <SearchInput defaultValue={q} placeholder="Title, abstract, author, affiliation" />
          <button type="submit" className="whova-btn-main primary">
            Search
          </button>
        </form>

        <Tabs
          tabs={TABS.map((t) => ({
            label: (
              <>
                {t.label}
                {t.key !== 'all' ? (
                  <span className="muted" style={{ marginLeft: 6 }}>
                    {countFor(counts, t.key)}
                  </span>
                ) : null}
              </>
            ),
            href: tabHref(t.key),
            active: status === t.key,
          }))}
        />

        {all.length === 0 ? (
          <NotInputted what="submissions" />
        ) : (
          <>
            <Table
              stackSm
              cols={[
                { key: 'pick', label: <SelectAllCheckbox />, className: 'cell-xs' },
                { key: 'title', label: 'Abstract' },
                { key: 'author', label: 'Author', className: 'cell-md' },
                { key: 'track', label: 'Track / type', className: 'cell-md' },
                { key: 'reviews', label: 'Reviews', className: 'cell-sm' },
                { key: 'status', label: 'Status', className: 'cell-sm' },
              ]}
              empty={
                q
                  ? `Nothing matches “${q}” in this tab.`
                  : 'No submissions in this tab.'
              }
              rows={rows.map((s) => [
                <span key="p">
                  {s.status === 'draft' || s.status === 'withdrawn' ? null : (
                    <RowCheckbox id={s.id} title={s.title} />
                  )}
                </span>,
                <span key="t">
                  <Link href={`${CFA_BASE}/submissions/${s.id}`}>
                    <strong>{s.title || 'Untitled'}</strong>
                  </Link>
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {s.abstract ? `${s.abstract.slice(0, 90)}${s.abstract.length > 90 ? '…' : ''}` : 'No abstract yet'}
                  </span>
                </span>,
                <AuthorCell key="a" row={s} />,
                <span key="k">
                  {s.trackId ? (trackName.get(s.trackId) ?? s.trackId) : <span className="muted">no track</span>}
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {s.sessionType ?? '—'}
                  </span>
                </span>,
                <span key="r">
                  {s.reviewsSubmitted}/{s.reviewsAssigned}
                  {s.scoreAverage !== undefined ? (
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      mean {s.scoreAverage.toFixed(1)}
                    </span>
                  ) : null}
                </span>,
                <StatusCell key="s" row={s} />,
              ])}
            />
            <Pagination
              total={filtered.length}
              page={page}
              perPage={PER_PAGE}
              baseParams={baseParams}
            />
            <BulkDecisionBar
              selectable={rows.filter((s) => s.status !== 'draft' && s.status !== 'withdrawn').length}
            />
          </>
        )}
      </Panel>
      )}
    </>
  );
}

/**
 * One table per track, best mean first.
 *
 * The ordering and the ranks are `rankByTrack` in `review-core.ts`, which is
 * pure and tested. The mean is `SubmissionDoc.scoreAverage`, kept by the same
 * transaction that accepts a review, so this view does no arithmetic of its own
 * and cannot disagree with the list. Reviews under a declared conflict are not
 * in the mean or the count.
 *
 * The tick boxes belong to the same bulk form as the list view, because the
 * ranking is where "accept the top six in this track" is decided.
 */
function RankingPanels({
  all,
  trackOrder,
  trackName,
  hasCriteria,
}: {
  all: SubmissionRow[];
  trackOrder: string[];
  trackName: Map<string, string>;
  hasCriteria: boolean;
}) {
  const groups = rankByTrack(all, trackOrder);

  if (groups.length === 0) {
    return (
      <Panel>
        <NotInputted what="submissions to rank" />
      </Panel>
    );
  }

  return (
    <>
      {!hasCriteria && (
        <Banner kind="warning">
          <strong>This call has no scoring criteria yet.</strong> Reviewers cannot score until it
          does. Add them on the <Link href={`${CFA_BASE}/reviewers`}>Reviewers</Link> screen.
        </Banner>
      )}
      {groups.map((g) => (
        <Panel key={g.trackId ?? 'none'} style={{ marginBottom: 16 }}>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            {g.trackId ? (trackName.get(g.trackId) ?? g.trackId) : 'No track chosen'}
            <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
              {g.rows.length} submission{g.rows.length === 1 ? '' : 's'}
            </span>
          </h2>
          <Table
            stackSm
            cols={[
              { key: 'pick', label: '', className: 'cell-xs' },
              { key: 'rank', label: 'Rank', className: 'cell-xs' },
              { key: 'title', label: 'Abstract' },
              { key: 'mean', label: `Mean score (of ${OVERALL_MAX})`, className: 'cell-sm' },
              { key: 'n', label: 'Reviewers', className: 'cell-sm' },
              { key: 'status', label: 'Status', className: 'cell-sm' },
            ]}
            rows={g.rows.map((r) => {
              const s = all.find((x) => x.id === r.id)!;
              return [
                <span key="p">
                  <RowCheckbox id={r.id} title={r.title} />
                </span>,
                <span key="k">{r.rank ?? <span className="muted">–</span>}</span>,
                <span key="t">
                  <Link href={`${CFA_BASE}/submissions/${r.id}`}>
                    <strong>{r.title || 'Untitled'}</strong>
                  </Link>
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {s.author ? s.author.name : 'no author on file'}
                  </span>
                </span>,
                <span key="m">
                  {r.scoreAverage !== undefined ? (
                    <strong>{r.scoreAverage.toFixed(2)}</strong>
                  ) : (
                    <span className="muted">not scored yet</span>
                  )}
                </span>,
                <span key="n">
                  {r.reviewsSubmitted} of {r.reviewsAssigned}
                </span>,
                <StatusCell key="s" row={s} />,
              ];
            })}
          />
        </Panel>
      ))}
      <Panel>
        <BulkDecisionBar selectable={groups.reduce((n, g) => n + g.rows.length, 0)} />
      </Panel>
    </>
  );
}

function countFor(
  counts: ReturnType<typeof countSubmissions>,
  key: 'all' | SubmissionStatus,
): number {
  switch (key) {
    case 'all':
      return counts.total;
    case 'draft':
      return counts.draft;
    case 'submitted':
      return counts.submitted;
    case 'under-review':
      return counts.underReview;
    case 'accepted':
      return counts.accepted;
    case 'rejected':
      return counts.rejected;
    case 'waitlisted':
      return counts.waitlisted;
    case 'withdrawn':
      return counts.withdrawn;
  }
}

/**
 * The author, or a plain statement that there is none on file.
 *
 * Never a placeholder name and never a blank cell. An identity document that is
 * missing means the submission was written without one, which should not happen
 * and is worth seeing rather than papering over.
 */
function AuthorCell({ row }: { row: SubmissionRow }) {
  if (!row.author) return <span className="muted">no author on file</span>;
  return (
    <span>
      {row.author.name}
      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
        {row.author.affiliation ?? row.author.email}
      </span>
    </span>
  );
}

function StatusCell({ row }: { row: SubmissionRow }) {
  const colour =
    row.status === 'accepted'
      ? 'green'
      : row.status === 'rejected' || row.status === 'withdrawn'
        ? 'red'
        : row.status === 'draft'
          ? 'grey'
          : row.status === 'waitlisted'
            ? 'blue'
            : 'orange';
  return (
    <span>
      <Tag color={colour}>{row.status}</Tag>
      {row.status === 'accepted' && !row.sessionId ? (
        <span className="muted" style={{ display: 'block', fontSize: 12 }}>
          not on the agenda
        </span>
      ) : null}
    </span>
  );
}

/** Title, abstract, author and affiliation. Everything an organizer would type. */
function matches(s: SubmissionRow, q: string): boolean {
  return (
    s.title.toLowerCase().includes(q) ||
    s.abstract.toLowerCase().includes(q) ||
    (s.author?.name.toLowerCase().includes(q) ?? false) ||
    (s.author?.email.toLowerCase().includes(q) ?? false) ||
    (s.author?.affiliation?.toLowerCase().includes(q) ?? false)
  );
}
