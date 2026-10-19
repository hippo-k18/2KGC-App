'use client';

import { useActionState, useState } from 'react';
import type { AnswerValue } from '@kgc/scripts/src/lib/question-forms';
import {
  OTHER_TRACK,
  PHONE_MAX,
  RESOURCE_LINK_MAX,
  TRACK_OTHER_MAX,
  fieldsForSessionType,
  typeLabel,
  wordCount,
} from '@kgc/scripts/src/lib/cfp-core';
import type { OwnSubmission, PublicCall } from '@/lib/submissions';
import { SubmissionFields } from './submission-fields';
import { KeepTypedForm } from '@/components/keep-typed-form';
import { formatDeadline } from '@/lib/site';
import { submitAction, type SubmitState } from './actions';

/**
 * The abstract form, used both to start one and to come back to it.
 *
 * ── Two submits, and only one of them is final ─────────────────────────────
 *
 * "Save draft" and "Submit" post the same fields and differ in one hidden
 * value. A draft is saved with whatever exists, because the whole of
 * `CFA-PLAN.md` phase 2 is about the people who start and stop — refusing a
 * half-written draft simply means they do not save, and then there is nothing to
 * chase. A finished submission has to have a title, an abstract, an author and
 * an answer to every required question.
 *
 * ── The only thing a draft cannot do without is an address ─────────────────
 *
 * There is no account here. The link back to this draft is emailed, so a draft
 * with no address is a document its author can never reach again — which is why
 * the email field is required even on the draft path, and why the form says so
 * rather than failing after the click.
 *
 * ── Co-authors are one textarea ────────────────────────────────────────────
 *
 * A repeating field group needs client state to add a row and a server that can
 * parse a sparse index. One name per line parses unambiguously, survives a
 * paste out of a paper, and is what a submitter has to hand. `SubmissionCoAuthor`
 * is name plus optional affiliation, and `Name (Affiliation)` is the shape
 * people already write.
 */
export function SubmissionForm({
  call,
  existing,
  token,
}: {
  call: PublicCall;
  /** Present when returning to a draft through a capability link. */
  existing?: OwnSubmission;
  /**
   * The capability token from the URL, posted back so the action can re-verify
   * it. ⚠️ The action reads the submission id out of the HMAC and never out of
   * a form field: a field naming which submission is being edited would let
   * anybody edit anybody's.
   */
  token?: string;
}) {
  const [state, action] = useActionState<SubmitState, FormData>(submitAction, {});
  const errors = state.fieldErrors ?? {};
  const a = existing?.author;

  const answers: Record<string, AnswerValue> | undefined = existing?.answers;

  /*
   * The form changes with the session type (T249): a workshop is asked for
   * its learning objectives, outline and install list, a talk for its length.
   * Which questions belong to which type is set per question in the
   * dashboard's form builder, and the server applies the same filter, so a
   * question hidden here is neither validated nor kept.
   */
  const [sessionType, setSessionType] = useState<string>(
    existing?.sessionType ?? (call.sessionTypes.length === 1 ? call.sessionTypes[0] : ''),
  );
  const [words, setWords] = useState(() => wordCount(existing?.abstract ?? ''));
  const [track, setTrack] = useState<string>(
    existing?.trackId ?? (existing?.trackOther ? OTHER_TRACK : ''),
  );
  const cfp = call.cfp;
  const fields = fieldsForSessionType(call.fields, sessionType || undefined);
  const closesLabel = cfp
    ? cfp.closeDay
    : (formatDeadline(call.closesAtLocal, call.timeZone) ?? call.closesAtLocal);

  return (
    <KeepTypedForm action={action} className="checkout">
      <input type="hidden" name="callId" value={call.id} />
      {token && <input type="hidden" name="token" value={token} />}

      {state.error && (
        <p className="notice bad" role="alert">
          <strong>Nothing has been saved.</strong> {state.error}
        </p>
      )}

      {call.sessionTypes.length > 0 && (
        <div className="field">
          <label htmlFor="sessionType">Session Type &amp; Format *</label>
          <select
            id="sessionType"
            name="sessionType"
            value={sessionType}
            onChange={(e) => setSessionType(e.target.value)}
          >
            <option value="">Choose one…</option>
            {call.sessionTypes.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
          <FieldError message={errors.sessionType} />
        </div>
      )}

      <div className="field">
        <label htmlFor="title">Session Title *</label>
        <input
          id="title"
          name="title"
          required={false}
          maxLength={200}
          defaultValue={existing?.title}
        />
        <FieldError message={errors.title} />
      </div>

      <div className="field">
        <label htmlFor="abstract">Session Description *</label>
        <textarea
          id="abstract"
          name="abstract"
          rows={10}
          maxLength={10000}
          defaultValue={existing?.abstract}
          onChange={(e) => setWords(wordCount(e.target.value))}
        />
        {cfp ? (
          <p className="hint" aria-live="polite">
            {cfp.abstractMinWords} to {cfp.abstractMaxWords} words. You have {words}.
          </p>
        ) : (
          <p className="hint">
            Plain text. Blank lines separate paragraphs. Up to 10,000 characters, which is about 1,500
            words.
          </p>
        )}
        <FieldError message={errors.abstract} />
      </div>

      {cfp && call.askTalkLength && sessionType === 'talk' && (
        <div className="field">
          <label htmlFor="durationMinutes">How long is your talk? *</label>
          <select id="durationMinutes" name="durationMinutes" defaultValue={existing?.durationMinutes ?? ''}>
            <option value="">Choose one…</option>
            {cfp.talkMinutes.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
          <FieldError message={errors.durationMinutes} />
        </div>
      )}

      {call.askTrack && (call.tracks.length > 0 || call.allowOtherTrack) && (
        <div className="field">
          <label htmlFor="trackId">Track *</label>
          <select id="trackId" name="trackId" value={track} onChange={(e) => setTrack(e.target.value)}>
            <option value="">Choose one…</option>
            {call.tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {call.allowOtherTrack && <option value={OTHER_TRACK}>Other</option>}
          </select>
          <FieldError message={errors.trackId} />
        </div>
      )}

      {call.askTrack && call.allowOtherTrack && track === OTHER_TRACK && (
        <div className="field">
          <label htmlFor="trackOther">Which topic? *</label>
          <input
            id="trackOther"
            name="trackOther"
            maxLength={TRACK_OTHER_MAX}
            defaultValue={existing?.trackOther}
          />
          <FieldError message={errors.trackOther} />
        </div>
      )}

      <div className="field">
        <label htmlFor="resourceLink">Link to Additional Resources or Supporting Materials (Optional)</label>
        <input
          id="resourceLink"
          name="resourceLink"
          inputMode="url"
          maxLength={RESOURCE_LINK_MAX}
          defaultValue={existing?.resourceLink}
        />
        <FieldError message={errors.resourceLink} />
      </div>

      <SubmissionFields fields={fields} answers={answers} errors={errors} />

      <div className="field">
        <label htmlFor="authorName">Your Name *</label>
        <input id="authorName" name="authorName" maxLength={120} autoComplete="name" defaultValue={a?.name} />
        <FieldError message={errors.authorName} />
      </div>

      <div className="field">
        <label htmlFor="authorEmail">Your Email *</label>
        <input
          id="authorEmail"
          name="authorEmail"
          type="email"
          required
          autoComplete="email"
          defaultValue={a?.email}
        />
        <p className="hint">
          We&apos;ll send submission updates, decisions, and a link to your submission to this email. No
          password or account required.
        </p>
        <FieldError message={errors.authorEmail} />
      </div>

      <div className="field">
        <label htmlFor="affiliation">{cfp ? 'Organization *' : 'Organization'}</label>
        <input
          id="affiliation"
          name="affiliation"
          maxLength={120}
          autoComplete="organization"
          defaultValue={a?.affiliation}
        />
        <FieldError message={errors.affiliation} />
      </div>

      <div className="field">
        <label htmlFor="phone">Your Phone Number (Optional)</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={PHONE_MAX}
          defaultValue={a?.phone}
        />
        <FieldError message={errors.phone} />
      </div>

      {/* Min's plan asks for the bio after acceptance, through the speaker's own link. */}
      {!cfp && (
        <div className="field">
          <label htmlFor="bio">A short bio</label>
          <textarea id="bio" name="bio" rows={4} maxLength={1000} defaultValue={a?.bio} />
          <p className="hint">
            Optional. If your work is accepted, this becomes your speaker bio.
          </p>
        </div>
      )}

      <div className="field">
        <label htmlFor="coAuthors">Co-Speakers or Co-Authors (Optional)</label>
        <textarea
          id="coAuthors"
          name="coAuthors"
          rows={4}
          defaultValue={(a?.coAuthors ?? [])
            .map((c) => (c.affiliation ? `${c.name} (${c.affiliation})` : c.name))
            .join('\n')}
        />
        <p className="hint">One per line. Put an organization in brackets after the name if you want to.</p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button type="submit" className="btn btn-primary" name="finish" value="1">
          Submit
        </button>
        {/* Only a draft is ever on this form: a submitted one is read-only (T276). */}
        {/* A draft may leave required questions empty; the server checks it loosely (T280 B#3). */}
        <button type="submit" className="btn btn-outline" name="finish" value="" formNoValidate>
          Save as a draft
        </button>
      </div>

      <p className="hint" style={{ marginTop: 14 }}>
        A draft is not submitted and nobody reads it. You can come back to it from the link we
        email you until the call closes{closesLabel ? ` on ${closesLabel}` : ''}. Once you press
        Submit, the submission is final and can no longer be changed.
      </p>
    </KeepTypedForm>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="hint" style={{ color: '#991b1b' }} role="alert">
      {message}
    </p>
  );
}
