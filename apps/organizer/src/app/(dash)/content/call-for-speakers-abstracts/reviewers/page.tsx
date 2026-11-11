import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listCalls } from '@/lib/calls';
import { listTrackOptions } from '@/lib/data';
import {
  invitationEmailAvailable,
  listReviewers,
  reviewProgress,
  reviewerInvitesAvailable,
  reviewerLink,
} from '@/lib/reviewers';
import { submittedReviewCount } from '@/lib/rubric';
import { listSubmissions } from '@/lib/submissions';
import { Banner, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';
import { ConfirmButton } from '../../../form';
import { CFA_BASE } from '../routes';
import { AssignByTrackForm, AssignForm, InviteReviewerForm } from './reviewer-forms';
import { CriterionForm, DefaultCriteriaForm, InvitationForm } from './criteria-forms';
import { moveCriterionAction, setReviewerStatusAction } from './actions';
import { liftExclusionAction } from '../submissions/actions';

export const dynamic = 'force-dynamic';

/**
 * Content › Call For Speakers/Abstracts › Reviewers.
 *
 * ── A reviewer is not a user, and must not become one ──────────────────────
 *
 * `reviewers/{id}` is its own collection (`CFA-PLAN.md` §2). A reviewer need not
 * hold a ticket, and most external academics on a programme committee never buy
 * one — so making them a `users` document would mean either minting the
 * `registered` claim for somebody who is not registered, which destroys the only
 * thing that claim means, or a second kind of user document half the app's
 * queries would have to know about.
 *
 * ── What is on this screen ─────────────────────────────────────────────────
 *
 * The scoring criteria, the committee, the invitation, assignment by hand and by
 * track, and the conflicts of interest. The reviewer's own page is
 * `/review/{token}` on the website. Each row carries a freshly minted link to
 * it, because the invitation mail only reaches people once the sender domain is
 * verified and until then the organizer pastes the link into a message of their
 * own.
 */
export default async function ReviewersPage({
  searchParams,
}: {
  searchParams: Promise<{ call?: string }>;
}) {
  await requireOrganizer();
  const { call: callParam } = await searchParams;

  const [reviewers, tracks, calls] = await Promise.all([
    listReviewers(),
    listTrackOptions(),
    listCalls(),
  ]);

  const callId = callParam && calls.some((c) => c.id === callParam) ? callParam : calls[0]?.id;
  const call = calls.find((c) => c.id === callId);
  const submissions = callId ? await listSubmissions(callId) : [];
  const assignable = submissions.filter((s) => s.status !== 'draft' && s.status !== 'withdrawn');

  const active = reviewers.filter((r) => r.status !== 'removed');
  const trackName = new Map(tracks.map((t) => [t.id, t.name]));
  const canInvite = reviewerInvitesAvailable();

  const [progress, scored] = await Promise.all([
    reviewProgress(assignable.map((s) => s.id)),
    callId ? submittedReviewCount(callId) : Promise.resolve(0),
  ]);
  const titleOf = new Map(submissions.map((s) => [s.id, s.title || 'Untitled']));
  const nameOf = new Map(reviewers.map((r) => [r.id, r.name]));
  const invitable = reviewers.filter((r) => r.status === 'invited' || r.status === 'accepted');
  const emailOn = invitationEmailAvailable();

  const capacity = active.reduce((n, r) => n + r.maxAssignments, 0);
  const load = active.reduce((n, r) => n + r.assignedCount, 0);
  const needed = call ? assignable.length * call.reviewsPerSubmission : 0;

  return (
    <>
      <PageHeader
        title="Reviewers"
        info={
          <>
            <strong>How reviewing works</strong>
            <p>
              Set the scoring criteria, add reviewers, assign submissions, then send each
              reviewer their link. They score from that link with no account. Rankings are on
              the Submissions screen.
            </p>
          </>
        }
        tags={
          <Tag color="blue">
            {active.length} on the committee
          </Tag>
        }
        links={[
          <Link key="b" href={CFA_BASE}>
            Call setup
          </Link>,
          ...(callId
            ? [
                <Link key="s" href={`${CFA_BASE}/submissions?call=${callId}`}>
                  Submissions
                </Link>,
              ]
            : []),
        ]}
      />

      {!canInvite && (
        <Banner kind="danger">
          <strong>Reviewers cannot be added yet.</strong> Reviewer links are not set up for this
          event. Ask your administrator to finish the setup.
        </Banner>
      )}

      {call && needed > capacity && active.length > 0 && (
        /*
         * Operational: it decides whether the chair spends the next hour
         * inviting people or assigning them. The two numbers are the real ones,
         * not an estimate — every reviewer states a ceiling and every submission
         * has a target.
         */
        <Banner kind="warning">
          <strong>The committee is smaller than the workload.</strong> {assignable.length}{' '}
          submission{assignable.length === 1 ? '' : 's'} × {call.reviewsPerSubmission} review
          {call.reviewsPerSubmission === 1 ? '' : 's'} is {needed} reviews, and the committee has
          said it will take {capacity}. Assignment stops at each reviewer&rsquo;s limit.
        </Banner>
      )}

      <StatTiles
        tiles={[
          {
            label: 'Reviewers',
            value: active.length,
            sub: active.length === 0 ? 'none yet' : `${reviewers.length - active.length} removed`,
          },
          {
            label: 'Assignments made',
            value: load,
            sub: needed > 0 ? `${needed} wanted for this call` : 'no call selected',
          },
          {
            label: 'Capacity',
            value: capacity,
            sub: capacity === 0 ? 'nobody has said what they will take' : 'what the committee agreed to',
          },
        ]}
      />

      {call && (
        <Panel style={{ marginBottom: 16 }}>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            Scoring criteria · {call.title}
          </h2>
          {call.rubric.length === 0 ? (
            <>
              <p className="body-2">
                Reviewers score each submission against these. There are none yet, so reviewers
                can read their submissions but cannot score them.
              </p>
              <DefaultCriteriaForm callId={call.id} />
            </>
          ) : (
            <>
              {scored > 0 && (
                <p className="body-2">
                  {scored} review{scored === 1 ? ' has' : 's have'} been scored, so scales are
                  fixed and criteria cannot be removed. Names and descriptions can still change.
                  A criterion added now does not change the overall of reviews already in.
                </p>
              )}
              <Table
                stackSm
                cols={[
                  { key: 'n', label: 'Criterion' },
                  { key: 's', label: 'Scale', className: 'cell-sm' },
                  { key: 'x', label: '', className: 'cell-md' },
                ]}
                rows={call.rubric.map((c, i) => [
                  <span key="n">
                    <strong>{c.label}</strong>
                    {c.description ? (
                      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                        {c.description}
                      </span>
                    ) : null}
                  </span>,
                  <span key="s">
                    {c.min} to {c.max}
                  </span>,
                  <span key="x" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {i > 0 && <MoveButton callId={call.id} id={c.id} direction="up" />}
                    {i < call.rubric.length - 1 && (
                      <MoveButton callId={call.id} id={c.id} direction="down" />
                    )}
                    <details>
                      <summary className="linkish" style={{ cursor: 'pointer', listStyle: 'none' }}>
                        Edit
                      </summary>
                      <div style={{ marginTop: 8 }}>
                        <CriterionForm callId={call.id} existing={c} locked={scored > 0} />
                      </div>
                    </details>
                  </span>,
                ])}
              />
            </>
          )}
          <h3 className="section-header">Add a criterion</h3>
          <CriterionForm callId={call.id} />
        </Panel>
      )}

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          The committee
        </h2>
        {reviewers.length === 0 ? (
          <NotInputted what="reviewers" />
        ) : (
          <Table
            stackSm
            cols={[
              { key: 'n', label: 'Reviewer' },
              { key: 't', label: 'Tracks', className: 'cell-md' },
              { key: 'l', label: 'Reviews done', className: 'cell-sm' },
              { key: 's', label: 'Status', className: 'cell-sm' },
              { key: 'x', label: '', className: 'cell-md' },
            ]}
            rows={reviewers.map((r) => [
              <span key="n">
                <strong>{r.name}</strong>
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  {r.affiliation ? `${r.affiliation} · ` : ''}
                  <a href={`mailto:${r.email}`}>{r.email}</a>
                </span>
              </span>,
              <span key="t">
                {r.trackIds.length === 0 ? (
                  <span className="muted">none. Can only be assigned by hand</span>
                ) : (
                  r.trackIds.map((id) => trackName.get(id) ?? id).join(', ')
                )}
              </span>,
              <span key="l">
                {progress.byReviewer.get(r.id)?.submitted ?? 0} of {r.assignedCount}
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  will take {r.maxAssignments}
                  {progress.byReviewer.get(r.id)?.conflicts
                    ? ` · ${progress.byReviewer.get(r.id)?.conflicts} conflict${progress.byReviewer.get(r.id)?.conflicts === 1 ? '' : 's'}`
                    : ''}
                </span>
              </span>,
              <span key="s">
                <Tag
                  color={
                    r.status === 'accepted'
                      ? 'green'
                      : r.status === 'declined' || r.status === 'removed'
                        ? 'red'
                        : 'orange'
                  }
                >
                  {r.status}
                </Tag>
              </span>,
              <span key="x" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {canInvite && (r.status === 'invited' || r.status === 'accepted') && (
                  <details>
                    <summary className="linkish" style={{ cursor: 'pointer', listStyle: 'none' }}>
                      Review link
                    </summary>
                    <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                      Their private link. Anyone who has it can score as {r.name}.
                    </p>
                    <code style={{ display: 'block', fontSize: 12, wordBreak: 'break-all' }}>
                      {reviewerLink(r.id)}
                    </code>
                  </details>
                )}
                {r.status !== 'accepted' && r.status !== 'removed' && (
                  <StatusButton id={r.id} status="accepted" label="Mark accepted" />
                )}
                {r.status === 'invited' && (
                  <StatusButton id={r.id} status="declined" label="Mark declined" />
                )}
                {r.status !== 'removed' && (
                  <ConfirmButton
                    action={setReviewerStatusAction}
                    hidden={{ id: r.id, status: 'removed' }}
                    label="Remove"
                    confirmLabel="Take them off the committee"
                    width={240}
                  >
                    {r.assignedCount > 0 ? (
                      <>
                        They hold {r.assignedCount} assignment
                        {r.assignedCount === 1 ? '' : 's'}. Those stay on the submissions, their
                        link stops working, and they will not be assigned anything new.
                      </>
                    ) : (
                      <>They have no assignments.</>
                    )}
                  </ConfirmButton>
                )}
              </span>,
            ])}
          />
        )}
      </Panel>

      {canInvite && (
        <Panel style={{ marginTop: 16 }}>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            Add a reviewer
          </h2>
          <p className="body-2">
            Adding a reviewer sends nothing. Assign their submissions, then send the invitation
            below.
          </p>
          <InviteReviewerForm tracks={tracks} />
        </Panel>
      )}

      {call && active.length > 0 && (
        <Panel style={{ marginTop: 16 }}>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            Assignment · {call.title}
          </h2>
          {assignable.length === 0 ? (
            <NotInputted what="submissions to assign" compact />
          ) : (
            <>
              <AssignByTrackForm callId={call.id} target={call.reviewsPerSubmission} />
              <h3 className="section-header">Or by hand</h3>
              <AssignForm
                reviewers={active}
                submissions={assignable}
              />
            </>
          )}
        </Panel>
      )}

      {call && invitable.length > 0 && canInvite && (
        <Panel style={{ marginTop: 16 }}>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            Invite reviewers
          </h2>
          <p className="body-2">
            Emails the reviewer a private link to their review page. Send it again as a reminder:
            every email carries a new link and the old ones keep working.
          </p>
          <InvitationForm callId={call.id} reviewers={invitable} emailOn={emailOn} />
        </Panel>
      )}

      {progress.conflicts.length > 0 && (
        <Panel style={{ marginTop: 16 }}>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            Conflicts of interest
          </h2>
          <p className="body-2">
            These reviewers cannot open these submissions and assignment skips them. Exclude a
            reviewer from a submission on that submission&rsquo;s page.
          </p>
          <Table
            stackSm
            cols={[
              { key: 'r', label: 'Reviewer', className: 'cell-md' },
              { key: 's', label: 'Submission' },
              { key: 'w', label: 'Who said so', className: 'cell-md' },
            ]}
            rows={progress.conflicts.map((c) => [
              <span key="r">{nameOf.get(c.reviewerId) ?? c.reviewerId}</span>,
              <span key="s">
                <Link href={`${CFA_BASE}/submissions/${c.submissionId}`}>
                  {titleOf.get(c.submissionId) ?? c.submissionId}
                </Link>
                {c.note ? (
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {c.note}
                  </span>
                ) : null}
              </span>,
              <span key="w">
                {c.excludedBy ? `Excluded by ${c.excludedBy}` : 'Declared by the reviewer'}
                {c.liftable ? (
                  <form action={liftExclusionAction}>
                    <input type="hidden" name="submissionId" value={c.submissionId} />
                    <input type="hidden" name="reviewerId" value={c.reviewerId} />
                    <button type="submit" className="linkish">
                      Lift exclusion
                    </button>
                  </form>
                ) : null}
              </span>,
            ])}
          />
        </Panel>
      )}
    </>
  );
}

/** Reorders one criterion. A POST, because it changes what reviewers see. */
function MoveButton({ callId, id, direction }: { callId: string; id: string; direction: 'up' | 'down' }) {
  return (
    <form action={moveCriterionAction}>
      <input type="hidden" name="callId" value={callId} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <button type="submit" className="linkish">
        {direction === 'up' ? 'Move up' : 'Move down'}
      </button>
    </form>
  );
}

/** A one-field form, because a status change is a POST and not a link. */
function StatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <form action={setReviewerStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className="linkish">
        {label}
      </button>
    </form>
  );
}
