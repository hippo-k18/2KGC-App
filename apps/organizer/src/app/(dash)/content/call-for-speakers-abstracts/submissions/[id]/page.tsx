import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fieldsAtVersion, type FormFieldDef } from '@kgc/scripts/src/lib/question-forms';
import { requireOrganizer } from '@/lib/auth';
import { getCall } from '@/lib/calls';
import { listTrackOptions } from '@/lib/data';
import {
  getSubmission,
  listReviews,
  submissionLink,
  submissionLinksAvailable,
} from '@/lib/submissions';
import { listReviewers } from '@/lib/reviewers';
import { ROUTES } from '@/lib/nav';
import { Banner, NotInputted, PageHeader, Panel, Table, Tag } from '../../../../ui';
import { ConfirmButton } from '../../../../form';
import { CFA_BASE } from '../../routes';
import { DecisionPanel } from '../decision-panel';
import { liftExclusionAction, undoDecisionAction } from '../actions';
import { ExcludeReviewerForm } from '../exclude-form';

export const dynamic = 'force-dynamic';

/**
 * One submission, with its answers, its reviews and the decision.
 *
 * ── The answers are rendered against the version they were given under ─────
 *
 * A call that runs for months has its form edited. `CFA-PLAN.md` §1.2 versions
 * the form rather than freezing it, so a submission from August may have been
 * answered against questions that have since been reworded — and rendering
 * today's prompts over yesterday's answers would quietly misattribute them.
 * `fieldsAtVersion` returns the definition as it stood, falling back to the
 * current one with a caveat if the archive has lost it.
 *
 * ── There is no editing here ───────────────────────────────────────────────
 *
 * An organizer can decide on a submission and cannot rewrite it. The abstract
 * belongs to its author, they can still edit it themselves while the call is
 * open, and a dashboard that could silently change the text under a review is a
 * dashboard where a review means nothing.
 */
export default async function SubmissionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ undo?: string }>;
}) {
  await requireOrganizer();
  const { id } = await params;
  const { undo } = await searchParams;

  const submission = await getSubmission(id);
  if (!submission) notFound();

  const [call, reviews, tracks, committee] = await Promise.all([
    getCall(submission.callId),
    listReviews(id),
    listTrackOptions(),
    listReviewers(),
  ]);

  const reviewerName = new Map(committee.map((r) => [r.id, r.name]));
  const rubric = call?.rubric ?? [];
  const off = new Set(reviews.filter((r) => r.conflict || r.status === 'declined').map((r) => r.reviewerId));
  const excludable = committee
    .filter((r) => r.status !== 'removed' && !off.has(r.id))
    .map((r) => ({ id: r.id, name: r.name, holds: reviews.some((v) => v.reviewerId === r.id) }));

  const trackName = submission.trackId
    ? (tracks.find((t) => t.id === submission.trackId)?.name ?? submission.trackId)
    : undefined;

  /*
   * `priorVersions` holds `CallFormFieldDef[]`, which is `FormFieldDef` minus
   * `ticketTypeIds` — a call has no ticket tiers. The cast widens rather than
   * narrows, so nothing is asserted that is not already true.
   */
  const fields: FormFieldDef[] = call
    ? fieldsAtVersion(
        { version: call.formVersion, fields: call.form },
        call.priorVersions.map((v) => ({ version: v.version, fields: v.fields, retiredAt: new Date(0) })),
        submission.formVersion,
      )
    : [];

  const staleForm = call ? submission.formVersion !== call.formVersion : false;
  const linkable = submissionLinksAvailable();

  return (
    <>
      <PageHeader
        title={submission.title || 'Untitled submission'}
        tags={<Tag color={tagColour(submission.status)}>{submission.status}</Tag>}
        links={[
          <Link key="l" href={`${CFA_BASE}/submissions?call=${submission.callId}`}>
            All submissions
          </Link>,
          <Link key="c" href={CFA_BASE}>
            Call setup
          </Link>,
          ...(submission.sessionId
            ? [
                <Link key="s" href={`${ROUTES.sessionManager}/${submission.sessionId}`}>
                  Its session
                </Link>,
              ]
            : []),
        ]}
      />

      {undo === 'ok' && (
        <Banner kind="success">
          <strong>Decision removed.</strong> This is back under review. If the author was already
          emailed, that message stands. Nothing here can recall it, so tell them.
        </Banner>
      )}
      {undo && undo !== 'ok' && (
        <Banner kind="danger">
          <strong>That decision was not removed.</strong> {undo}
        </Banner>
      )}

      {submission.status === 'accepted' && !submission.sessionId && (
        /*
         * Operational: acceptance does not put anything on the agenda, and the
         * organizer has to do it. Whova's marketing claims otherwise and its own
         * help centre corrects it — see `promoteSubmission`.
         */
        <Banner kind="warning">
          <strong>Accepted, and not on the agenda.</strong> It still needs a day, a time and a room.
          Put it on the
          agenda from{' '}
          <Link href={`${ROUTES.sessionManager}/from-accepted`}>
            Session Manager → From accepted submissions
          </Link>
          .
        </Banner>
      )}

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          The abstract
        </h2>
        {submission.abstract ? (
          submission.abstract
            .split(/\n\s*\n/)
            .map((para) => para.trim())
            .filter(Boolean)
            .map((para, i) => (
              <p className="body-2" key={i} style={{ whiteSpace: 'pre-wrap' }}>
                {para}
              </p>
            ))
        ) : (
          <NotInputted what="abstract text" compact />
        )}

        <dl className="gap-grid" style={{ marginTop: 18 }}>
          <Row label="Call">{call?.title ?? submission.callId}</Row>
          <Row label="Track">{trackName ?? <span className="muted">none chosen</span>}</Row>
          <Row label="Session type">{submission.sessionType ?? <span className="muted">none chosen</span>}</Row>
          <Row label="Submitted">
            {submission.submittedAtMs
              ? new Date(submission.submittedAtMs).toLocaleString('en-GB')
              : 'never. This is still a draft'}
          </Row>
          <Row label="Last touched">{new Date(submission.updatedAtMs).toLocaleString('en-GB')}</Row>
          <Row label="Form version">
            v{submission.formVersion}
            {staleForm ? (
              <span className="muted">. The call is now on v{call?.formVersion}</span>
            ) : null}
          </Row>
        </dl>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          The author
        </h2>
        {submission.author ? (
          <>
            <dl className="gap-grid">
              <Row label="Name">{submission.author.name}</Row>
              <Row label="Email">
                <a href={`mailto:${submission.author.email}`}>{submission.author.email}</a>
              </Row>
              <Row label="Affiliation">
                {submission.author.affiliation ?? <span className="muted">not given</span>}
              </Row>
              {submission.author.coAuthors.length > 0 && (
                <Row label="Co-authors">
                  {submission.author.coAuthors
                    .map((c) => (c.affiliation ? `${c.name} (${c.affiliation})` : c.name))
                    .join(', ')}
                </Row>
              )}
              {submission.author.bio && <Row label="Bio">{submission.author.bio}</Row>}
            </dl>
            {linkable && (
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                Their own link back to this submission. Send it if they have lost theirs. The
                old link keeps working:{' '}
                <code style={{ wordBreak: 'break-all' }}>{submissionLink(submission.id)}</code>
              </p>
            )}
            {!linkable && (
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                Author links are not set up for this event. Ask your administrator to finish the
                setup.
              </p>
            )}
          </>
        ) : (
          <>
            <NotInputted what="author record" compact />
            <p className="body-2" style={{ marginBottom: 0 }}>
              This submission has no author on file, so there is nobody to email about it.
            </p>
          </>
        )}
      </Panel>

      {fields.length > 0 && (
        <Panel style={{ marginTop: 16 }}>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            Answers
          </h2>
          {staleForm && (
            <p className="muted" style={{ fontSize: 12 }}>
              Shown under the questions as they stood at version {submission.formVersion}, which is
              what this author was actually asked. The call has been edited since.
            </p>
          )}
          {/* Wider label column than the default 120px: a question prompt is a
              sentence, and wrapping it to three lines beside a one-word answer
              reads as a rendering fault. */}
          <dl className="gap-grid" style={{ gridTemplateColumns: '240px 1fr' }}>
            {fields
              .filter((f) => f.kind !== 'description')
              .map((f) => (
                <Row key={f.id} label={f.prompt}>
                  {formatAnswer(submission.answers[f.id])}
                </Row>
              ))}
          </dl>
        </Panel>
      )}

      <Panel style={{ marginTop: 16 }}>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Reviews
        </h2>
        {reviews.length === 0 ? (
          <>
            <NotInputted what="reviews" compact />
            <p className="body-2" style={{ marginBottom: 0 }}>
              Nobody has been assigned this submission. Assign reviewers from{' '}
              <Link href={`${CFA_BASE}/reviewers`}>Reviewers</Link>.
            </p>
          </>
        ) : (
          <>
            {submission.scoreAverage !== undefined && (
              <p className="body-2">
                Mean score <strong>{submission.scoreAverage.toFixed(2)}</strong> of 10, from{' '}
                {submission.reviewsSubmitted} review{submission.reviewsSubmitted === 1 ? '' : 's'}.
                Reviews under a conflict of interest are not counted.
              </p>
            )}
            <Table
              stackSm
              cols={[
                { key: 'r', label: 'Reviewer', className: 'cell-md' },
                { key: 's', label: 'Status', className: 'cell-sm' },
                { key: 'o', label: 'Scores', className: 'cell-md' },
                { key: 'c', label: 'Comments' },
              ]}
              rows={reviews.map((r) => {
                const gone = r.conflict || r.status === 'declined';
                return [
                  <span key="r">
                    {reviewerName.get(r.reviewerId) ?? r.reviewerId}
                    {r.assignedBy ? (
                      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                        assigned {r.assignedBy === 'topic' ? 'by track' : r.assignedBy}
                      </span>
                    ) : null}
                  </span>,
                  <span key="s">
                    <Tag color={gone ? 'red' : r.status === 'submitted' ? 'green' : 'orange'}>
                      {gone ? (r.excludedBy ? 'excluded' : 'conflict') : r.status}
                    </Tag>
                    {gone && r.conflictNote ? (
                      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                        {r.conflictNote}
                      </span>
                    ) : null}
                    {gone && r.liftable ? (
                      <form action={liftExclusionAction}>
                        <input type="hidden" name="submissionId" value={submission.id} />
                        <input type="hidden" name="reviewerId" value={r.reviewerId} />
                        <button type="submit" className="linkish">
                          Lift exclusion
                        </button>
                      </form>
                    ) : null}
                  </span>,
                  <span key="o">
                    {gone ? (
                      <span className="muted">not counted</span>
                    ) : r.overall !== undefined ? (
                      <>
                        <strong>{r.overall.toFixed(2)}</strong>
                        {r.confidence ? (
                          <span className="muted"> · confidence {r.confidence}/5</span>
                        ) : null}
                        {rubric.map((c) =>
                          r.scores[c.id] !== undefined ? (
                            <span className="muted" key={c.id} style={{ display: 'block', fontSize: 12 }}>
                              {c.label}: {r.scores[c.id]}/{c.max}
                            </span>
                          ) : null,
                        )}
                      </>
                    ) : (
                      <span className="muted">not entered yet</span>
                    )}
                  </span>,
                  <span key="c">
                    {gone ? null : (
                      <>
                        {rubric.map((c) =>
                          r.criterionComments[c.id] ? (
                            <span key={c.id} style={{ display: 'block', marginBottom: 6 }}>
                              <strong>{c.label}.</strong> {r.criterionComments[c.id]}
                            </span>
                          ) : null,
                        )}
                        {r.commentsToCommittee ? (
                          <span style={{ display: 'block', marginBottom: 6 }}>
                            <strong>To the committee.</strong> {r.commentsToCommittee}
                          </span>
                        ) : null}
                        {r.commentsToAuthors ? (
                          <span style={{ display: 'block' }}>
                            <strong>For the author.</strong> {r.commentsToAuthors}
                          </span>
                        ) : null}
                        {!r.commentsToCommittee &&
                        !r.commentsToAuthors &&
                        Object.keys(r.criterionComments).length === 0 ? (
                          <span className="muted">none</span>
                        ) : null}
                      </>
                    )}
                  </span>,
                ];
              })}
            />
          </>
        )}
      </Panel>

      {excludable.length > 0 && (
        <Panel style={{ marginTop: 16 }}>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            Conflict of interest
          </h2>
          <p className="body-2">
            Exclude a reviewer who should not read this submission. They lose access to it, any
            scores they gave stop counting, and assignment skips them. Reviewers can also declare
            a conflict themselves from their review page.
          </p>
          <ExcludeReviewerForm submissionId={submission.id} reviewers={excludable} />
        </Panel>
      )}

      <Panel style={{ marginTop: 16 }}>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Decision
        </h2>

        {submission.decision && (
          <Banner kind={submission.status === 'accepted' ? 'success' : 'info'}>
            <strong>
              {submission.status === 'accepted'
                ? 'Accepted'
                : submission.status === 'waitlisted'
                  ? 'Waitlisted'
                  : 'Rejected'}{' '}
              by{' '}
              {submission.decision.by}
            </strong>{' '}
            on {new Date(submission.decision.atMs).toLocaleString('en-GB')}, round{' '}
            {submission.decision.round}.
          </Banner>
        )}

        {submission.status === 'draft' ? (
          <p className="body-2" style={{ marginBottom: 0 }}>
            This is still a draft. It can be decided once the author submits it.
          </p>
        ) : submission.status === 'withdrawn' ? (
          <p className="body-2" style={{ marginBottom: 0 }}>
            The author withdrew this, so it cannot be decided.
          </p>
        ) : (
          <>
            <DecisionPanel
              id={submission.id}
              decided={Boolean(submission.decision)}
              authorEmail={submission.author?.email}
            />
            {submission.decision && (
              <div style={{ marginTop: 16 }}>
                <ConfirmButton
                  action={undoDecisionAction}
                  hidden={{ id: submission.id }}
                  label="Undo this decision"
                  confirmLabel="Remove the decision"
                >
                  The submission goes back to <strong>under review</strong> and the decision is
                  deleted. ⚠️ If the author has already been emailed, that message cannot be
                  recalled. Write to them yourself.
                </ConfirmButton>
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function tagColour(status: string): 'green' | 'red' | 'orange' | 'grey' | 'blue' {
  if (status === 'accepted') return 'green';
  if (status === 'waitlisted') return 'blue';
  if (status === 'rejected' || status === 'withdrawn') return 'red';
  if (status === 'draft') return 'grey';
  return 'orange';
}

/**
 * One answer, rendered.
 *
 * An unanswered question is "not answered", never a blank cell: on a form that
 * has been versioned, the difference between "they said nothing" and "they were
 * never asked" is the difference between chasing somebody and not.
 */
function formatAnswer(value: string | string[] | boolean | undefined): React.ReactNode {
  if (value === undefined || value === '') return <span className="muted">not answered</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : <span className="muted">not answered</span>;
  return <span style={{ whiteSpace: 'pre-wrap' }}>{value}</span>;
}
