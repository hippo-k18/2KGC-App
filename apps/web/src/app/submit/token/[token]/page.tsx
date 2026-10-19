import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readSubmissionToken } from '@kgc/scripts/src/lib/submission-token';
import { fieldsForSessionType, typeLabel } from '@kgc/scripts/src/lib/cfp-core';
import { formatDeadline, SITE } from '@/lib/site';
import { loadOwnSubmission } from '@/lib/submissions';
import { SubmissionForm } from '../../submission-form';
import { withdrawAction } from '../../actions';

export const metadata: Metadata = {
  // The same treatment as `/order/{token}`, `/u/{token}` and `/consent/{token}`:
  // this URL is a capability, and a capability in a search index is a capability
  // anybody can exercise. `noarchive` keeps it out of the caches too.
  title: 'Your submission',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

/** Per-request, and it has to be. Reads a capability token. One author's draft must never be served to another from a cache. */
export const dynamic = 'force-dynamic';

/**
 * `/submit/token/{token}` — an author's own way back to their abstract.
 *
 * ── What holding this URL lets you do ──────────────────────────────────────
 *
 * Read and, while the call is open, edit **one** submission, and read its
 * decision once one is made. Nothing else: not another submission, not a review,
 * not a reviewer's name, not the list of who else submitted, not the call's
 * private configuration. `scripts/src/lib/submission-token.ts` carries the full
 * argument and the threat it accepts, which is stated plainly rather than
 * hedged: this is a bearer credential for one author's unpublished work, for up
 * to a year.
 *
 * ── The token does not enforce the deadline, and must not ──────────────────
 *
 * It keeps verifying after the call closes, because it has to — the author still
 * needs to read their submission and, later, their decision. Refusing the
 * *write* is `saveSubmission`'s job. A reader of this file will assume the token
 * did it; it did not.
 *
 * ── `/submit/token` cannot collide with a call called "token" ──────────────
 *
 * A static segment beats a dynamic one in Next's router, so this route wins over
 * `/submit/[callId]` whatever a call is named. `saveCall` refuses `token` as a
 * call id anyway, so no organizer can create the ambiguity in the first place.
 */
export default async function SubmissionTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { token: raw } = await params;
  const { r } = await searchParams;
  const token = decodeURIComponent(raw);

  const payload = readSubmissionToken(token);
  if (!payload) notFound();

  const own = await loadOwnSubmission(payload.sid);
  if (!own) notFound();

  // Min's settings name the close date; while it is unset, say "the call closes".
  const closes = own.call.cfp
    ? (own.call.cfp.closeDay ?? 'the call closes')
    : (formatDeadline(own.call.closesAtLocal, own.call.timeZone) ?? own.call.closesAtLocal);

  /*
   * Submitted and waiting for a decision (T276): the page closes to this. An
   * untold rejection arrives here as `submitted`, so it reads the same.
   */
  const received = own.status === 'submitted' && !own.decided;

  return (
    <section>
      <div className="wrap narrow cfp-page" style={{ paddingBottom: 48 }}>
        <p className="eyebrow">{own.call.title}</p>
        <h1>{received ? 'Submission received' : own.title || 'Your submission'}</h1>

        {received && (
          <p className="notice" role="status">
            <strong>Thank you, we have your submission.</strong>{' '}
            {r === 'submitted' ? 'We have emailed you this link. ' : ''}Keep it to see what you sent
            and, later, our decision. The submission is final and can no longer be changed.
          </p>
        )}
        {r === 'saved' && (
          <p className="notice" role="status">
            <strong>Saved as a draft.</strong> This has <strong>not</strong> been submitted and
            nobody will read it. Come back through the link we have emailed you and press{' '}
            <em>Submit</em> before {closes}.
          </p>
        )}
        {r === 'withdrawn' && (
          <p className="notice warn" role="status">
            <strong>Withdrawn.</strong> This will not be considered. Nothing has been deleted;
            the committee sees it as withdrawn rather than rejected.
          </p>
        )}
        {r === 'error' && (
          <p className="notice bad" role="alert">
            <strong>Something went wrong and nothing was changed.</strong> Email{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we will help.
          </p>
        )}

        {own.decided === 'waitlisted' && (
          <p className="notice" role="status">
            <strong>This is on the waiting list.</strong> The programme is full for now. If a
            place opens we will offer it to you, and we will write to you either way. It can no
            longer be edited.
          </p>
        )}

        {own.decided && own.decided !== 'waitlisted' && (
          <p className={`notice ${own.decided === 'accepted' ? '' : 'warn'}`} role="status">
            <strong>
              {own.decided === 'accepted'
                ? 'This has been accepted.'
                : 'This was not accepted this year.'}
            </strong>{' '}
            {own.decided === 'accepted'
              ? own.cfp
                ? 'We have emailed you a link to send your bio, headshot and session details.'
                : 'The programme committee will be in touch about scheduling. This is not a slot yet.'
              : 'We had more good submissions than we have room for. You are very welcome to submit again.'}{' '}
            It can no longer be edited.
          </p>
        )}

        {own.status === 'withdrawn' && !own.decided && (
          <p className="notice warn" role="status">
            <strong>You withdrew this submission.</strong> It is not being considered. Email{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> if that was a mistake.
          </p>
        )}

        {own.status === 'draft' && !own.decided && own.editable && (
          <p className="notice warn" role="status">
            <strong>This is still a draft.</strong> It has not been submitted and nobody is reading
            it. Press <em>Submit</em> at the bottom before {closes}.
          </p>
        )}

        {/*
          ⚠️ This says what the form below actually does, which is not what it
          said until 2026-09-06. It claimed "you are still being asked the ones
          you answered", and `SubmissionForm` is handed `own.call`, so it has
          always rendered the questions **as they stand now**. Saving then
          re-stamps the submission at the current `formVersion`, which is the
          honest record of what was asked. Answers to a question that has since
          been withdrawn are kept on the document and are shown to the committee
          under the wording that was actually asked — but they are not on this
          form, because nobody is being asked them any more.
        */}
        {own.formMoved && own.editable && (
          <p className="notice">
            The organizers have changed the questions since you started. The form shows the current
            ones and keeps what you already wrote. Check it before you save.
          </p>
        )}

        {own.editable ? (
          <SubmissionForm call={own.call} existing={own} token={token} />
        ) : (
          <ReadOnly own={own} />
        )}

        {own.withdrawable && own.status !== 'withdrawn' && (
          <form action={withdrawAction} style={{ marginTop: 28 }}>
            <input type="hidden" name="token" value={token} />
            <details>
              <summary style={{ cursor: 'pointer' }}>Withdraw this submission</summary>
              <p className="muted" style={{ marginTop: 10 }}>
                It will not be considered. Nothing is deleted; the committee sees it as
                withdrawn rather than rejected. There is no undo. Email{' '}
                <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> if you change your
                mind.
              </p>
              <button type="submit" className="btn btn-outline">
                Withdraw
              </button>
            </details>
          </form>
        )}

        <p className="muted" style={{ marginTop: 32 }}>
          Keep this link and do not forward it. Anybody who has it can read your abstract.
        </p>

        <p className="muted">
          <Link href="/">
            Back to {SITE.shortName} {SITE.year}
          </Link>
        </p>
      </div>
    </section>
  );
}

/**
 * The submission as it stands, when it can no longer be changed.
 *
 * Reading is always allowed and editing is not: the author is entitled to see
 * what they sent whatever the deadline says, and `submission-token.ts` sets the
 * token's life at twelve months for exactly this reason — a six-month link would
 * die before the decision on a paper submitted on day one.
 */
function ReadOnly({ own }: { own: Awaited<ReturnType<typeof loadOwnSubmission>> }) {
  if (!own) return null;
  // Only the questions this type was asked (T280 B#4): a talk has no workshop outline to show.
  const asked = fieldsForSessionType(own.fields, own.sessionType).filter((f) => f.kind !== 'description');
  return (
    <div className="checkout">
      <h2 style={{ marginTop: 0 }}>{own.title || 'Untitled'}</h2>
      <dl className="submission-facts">
        {own.sessionType && (
          <div>
            <dt>Session Type &amp; Format</dt>
            <dd>{typeLabel(own.sessionType)}</dd>
          </div>
        )}
        {own.submittedOn && (
          <div>
            <dt>Submitted</dt>
            <dd>{own.submittedOn}</dd>
          </div>
        )}
      </dl>
      <h3>Session Description</h3>
      {own.abstract
        .split(/\n\s*\n/)
        .map((para) => para.trim())
        .filter(Boolean)
        .map((para, i) => (
          <p key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {para}
          </p>
        ))}

      {own.resourceLink && (
        <>
          <h3>Additional Resources or Supporting Materials</h3>
          <p>
            <a href={own.resourceLink} rel="noopener noreferrer nofollow" target="_blank">
              {own.resourceLink}
            </a>
          </p>
        </>
      )}

      <h3>About you</h3>
      <p>
        {own.author.name}
        {own.author.affiliation ? `, ${own.author.affiliation}` : ''}
      </p>
      {own.author.coAuthors.length > 0 && (
        <p>
          Co-Speakers or Co-Authors:{' '}
          {own.author.coAuthors
            .map((c) => (c.affiliation ? `${c.name} (${c.affiliation})` : c.name))
            .join(', ')}
        </p>
      )}

      {asked.length > 0 && (
        <>
          <h3>Your answers</h3>
          <dl>
            {asked
              .map((f) => {
                const value = own.answers[f.id];
                return (
                  <div key={f.id} style={{ marginBottom: 12 }}>
                    <dt style={{ fontWeight: 600 }}>{f.prompt}</dt>
                    <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                      {value === undefined || value === ''
                        ? 'No answer'
                        : typeof value === 'boolean'
                          ? value
                            ? 'Yes'
                            : 'No'
                          : Array.isArray(value)
                            ? value.join(', ')
                            : value}
                    </dd>
                  </div>
                );
              })}
          </dl>
        </>
      )}
    </div>
  );
}
