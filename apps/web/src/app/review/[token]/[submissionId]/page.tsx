import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assignmentFor, reviewerFor } from '@/lib/reviews';
import { ReviewForm } from '../../review-form';
import { conflictAction } from '../../actions';

export const metadata: Metadata = {
  title: 'Review a submission',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

/** Per-request, and it has to be. Reads a capability token. One reviewer's view of a submission must never be served to another from a cache. */
export const dynamic = 'force-dynamic';

/**
 * `/review/{token}/{submissionId}` — one submission, and this reviewer's scores.
 *
 * ── The three things this page must not leak ───────────────────────────────
 *
 * All three are decided in `loadAssignment`, not here, so that hiding something
 * is never the control:
 *
 *   - a submission this reviewer was not given is a 404, the same 404 as one
 *     that does not exist;
 *   - under double-blind the author is absent from the data this page receives,
 *     because the identity document was never read;
 *   - other reviewers' scores arrive only once this reviewer's own are in.
 */
export default async function ReviewSubmissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; submissionId: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { token: rawToken, submissionId: rawId } = await params;
  const { r } = await searchParams;
  const token = decodeURIComponent(rawToken);

  const reviewer = await reviewerFor(token);
  if (!reviewer) notFound();

  const a = await assignmentFor(reviewer, decodeURIComponent(rawId));
  if (!a) notFound();

  const back = `/review/${encodeURIComponent(token)}`;
  const gone = a.own.conflict || a.own.status === 'declined';

  return (
    <section>
      <div className="wrap narrow" style={{ paddingBottom: 48 }}>
        <p className="eyebrow">{a.callTitle}</p>
        <h1>{gone ? 'No longer on your list' : a.title || 'Untitled'}</h1>
        <p className="muted">
          <Link href={back}>Back to your reviews</Link>
        </p>

        {r === 'submitted' && (
          <p className="notice" role="status">
            <strong>Review submitted.</strong> Thank you.{' '}
            {a.closed ? '' : 'You can change it until the committee decides.'}
          </p>
        )}
        {r === 'saved' && (
          <p className="notice warn" role="status">
            <strong>Draft saved.</strong> It does not count until you press <em>Submit review</em>.
          </p>
        )}

        {gone ? (
          <p className="notice warn" role="status">
            A conflict of interest is recorded for this submission, so it is not shown to you.
          </p>
        ) : (
          <>
            <div className="checkout" style={{ marginBottom: 24 }}>
              <p className="hint" style={{ marginTop: 0 }}>
                {[a.trackName, a.sessionType].filter(Boolean).join(' · ')}
              </p>
              {a.abstract
                .split(/\n\s*\n/)
                .map((para) => para.trim())
                .filter(Boolean)
                .map((para, i) => (
                  <p key={i} style={{ whiteSpace: 'pre-wrap' }}>
                    {para}
                  </p>
                ))}

              {a.author ? (
                <p className="hint">
                  {a.author.name}
                  {a.author.affiliation ? `, ${a.author.affiliation}` : ''}
                  {a.author.coAuthors.length > 0 ? ` · with ${a.author.coAuthors.join(', ')}` : ''}
                </p>
              ) : (
                <p className="hint">
                  {a.blindReview === 'double-blind'
                    ? 'This call is reviewed blind, so the author is not shown.'
                    : 'No author details are on file.'}
                </p>
              )}

              {a.answers.length > 0 && (
                <dl>
                  {a.answers.map((q, i) => (
                    <div key={i} style={{ marginBottom: 12 }}>
                      <dt style={{ fontWeight: 600 }}>{q.prompt}</dt>
                      <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{formatAnswer(q.value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            {a.rubric.length === 0 ? (
              <p className="notice warn" role="status">
                The organizers have not set the scoring criteria yet, so there is nothing to score.
                Come back through the same link.
              </p>
            ) : a.closed ? (
              <>
                <p className="notice" role="status">
                  {a.closed}
                </p>
                {a.own.status === 'submitted' && <OwnScores a={a} />}
              </>
            ) : (
              <ReviewForm assignment={a} token={token} />
            )}

            {a.own.status === 'submitted' ? (
              <div style={{ marginTop: 28 }}>
                <h2>The other reviews</h2>
                {a.others.length === 0 ? (
                  <p className="muted">
                    {a.otherCount === 0
                      ? 'Nobody else is reviewing this submission.'
                      : 'No other reviewer has submitted yet.'}
                  </p>
                ) : (
                  a.others.map((o) => (
                    <div key={o.label} className="checkout" style={{ marginBottom: 14 }}>
                      <strong>
                        {o.label}: {o.overall?.toFixed(1) ?? 'no overall'} of 10
                      </strong>
                      <p className="hint" style={{ margin: '4px 0 0' }}>
                        {a.rubric
                          .filter((c) => o.scores[c.id] !== undefined)
                          .map((c) => `${c.label} ${o.scores[c.id]}/${c.max}`)
                          .join(' · ')}
                      </p>
                      {o.commentsToCommittee && (
                        <p style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{o.commentsToCommittee}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : (
              a.otherCount > 0 && (
                <p className="muted" style={{ marginTop: 20 }}>
                  {a.otherCount} other reviewer{a.otherCount === 1 ? ' has' : 's have'} this
                  submission. Their scores are shown once yours are submitted.
                </p>
              )
            )}

            {!a.closed && (
              <form action={conflictAction} style={{ marginTop: 28 }}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="submissionId" value={a.submissionId} />
                <details>
                  <summary style={{ cursor: 'pointer' }}>I have a conflict of interest</summary>
                  <p className="muted" style={{ marginTop: 10 }}>
                    For example the same institution, a co-author, or a student of yours. The
                    submission leaves your list, any scores you gave stop counting, and the
                    organizers see the reason. There is no undo from here.
                  </p>
                  <div className="field">
                    <label htmlFor="note">Reason</label>
                    <input id="note" name="note" maxLength={500} />
                  </div>
                  <button type="submit" className="btn btn-outline">
                    Declare a conflict
                  </button>
                </details>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** This reviewer's own submitted scores, read-only, once reviews have closed. */
function OwnScores({ a }: { a: NonNullable<Awaited<ReturnType<typeof assignmentFor>>> }) {
  return (
    <div className="checkout">
      <h2 style={{ marginTop: 0 }}>Your review: {a.own.overall?.toFixed(1)} of 10</h2>
      <dl>
        {a.rubric.map((c) => (
          <div key={c.id} style={{ marginBottom: 10 }}>
            <dt style={{ fontWeight: 600 }}>
              {c.label}: {a.own.scores[c.id] ?? 'no score'}/{c.max}
            </dt>
            {a.own.criterionComments[c.id] && (
              <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.own.criterionComments[c.id]}</dd>
            )}
          </div>
        ))}
      </dl>
      {a.own.commentsToCommittee && <p style={{ whiteSpace: 'pre-wrap' }}>{a.own.commentsToCommittee}</p>}
    </div>
  );
}

function formatAnswer(value: string | string[] | boolean | undefined): string {
  if (value === undefined || value === '') return 'No answer';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'No answer';
  return value;
}
