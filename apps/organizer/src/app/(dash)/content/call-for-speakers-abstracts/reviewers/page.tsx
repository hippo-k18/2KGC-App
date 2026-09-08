import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listCalls } from '@/lib/calls';
import { listTrackOptions } from '@/lib/data';
import { listReviewers, reviewerInvitesAvailable } from '@/lib/reviewers';
import { listSubmissions } from '@/lib/submissions';
import { Banner, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';
import { ConfirmButton } from '../../../form';
import { CFA_BASE } from '../routes';
import { AssignByTrackForm, AssignForm, InviteReviewerForm } from './reviewer-forms';
import { setReviewerStatusAction } from './actions';

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
 * ── What is built here, and what honestly is not ───────────────────────────
 *
 * Built: the committee list, invitation, assignment by hand and by track, and
 * the `reviews/{reviewerId}` document written at the moment of assignment —
 * which is what makes "who has not reviewed yet" a query rather than a
 * subtraction.
 *
 * Not built, and not implied anywhere on this screen: the reviewer's own
 * screen. The rubric, the scoring form, and the rule that hides other reviewers'
 * scores until yours is entered are `CFA-PLAN.md` phase 3. There is deliberately
 * no "copy invitation link" button, because the link would point at a route that
 * does not exist — `lib/reviewers.ts` mints the token only to store its hash and
 * throws the plaintext away.
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

  const capacity = active.reduce((n, r) => n + r.maxAssignments, 0);
  const load = active.reduce((n, r) => n + r.assignedCount, 0);
  const needed = call ? assignable.length * call.reviewsPerSubmission : 0;

  return (
    <>
      <PageHeader
        title="Reviewers"
        info={
          <>
            <strong>The reviewing screen is not built</strong>
            <p>
              Assignment writes a review document straight away, so progress is a real query. The
              rubric and the scoring form a reviewer would use are the next phase, and no link is
              offered until they exist.
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
          <strong>No reviewer can be added on this deployment.</strong> Every reviewer document
          stores the hash of their capability link, and neither{' '}
          <code>WEB_REVIEWER_SECRET</code> nor <code>WEB_ORDER_SECRET</code> is set, so no link can
          be minted. Set one and this screen works.
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
          said it will take {capacity}. Assignment will stop short rather than push anybody past
          what they agreed to.
        </Banner>
      )}

      <StatTiles
        tiles={[
          {
            label: 'Reviewers',
            value: active.length,
            sub: active.length === 0 ? 'not inputted yet' : `${reviewers.length - active.length} removed`,
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

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          The committee
        </h2>
        {reviewers.length === 0 ? (
          <NotInputted what="reviewers" />
        ) : (
          <Table
            cols={[
              { key: 'n', label: 'Reviewer' },
              { key: 't', label: 'Tracks', className: 'cell-md' },
              { key: 'l', label: 'Load', className: 'cell-sm' },
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
                {r.assignedCount}/{r.maxAssignments}
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
                  >
                    {r.assignedCount > 0 ? (
                      <>
                        They hold {r.assignedCount} assignment
                        {r.assignedCount === 1 ? '' : 's'}. Those stay on the submissions. A review
                        somebody wrote is not deleted by removing them, and the matcher will not
                        hand them anything new.
                      </>
                    ) : (
                      <>They have no assignments, so this costs nothing.</>
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
            Nothing is emailed. The committee is recorded here and you write to them yourself. An
            invitation to review is usually one paragraph of a longer personal message, and a
            template is the wrong shape for it.
          </p>
          <InviteReviewerForm tracks={tracks} />
        </Panel>
      )}

      {call && active.length > 0 && (
        <Panel style={{ marginTop: 16 }}>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            Assignment — {call.title}
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
    </>
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
