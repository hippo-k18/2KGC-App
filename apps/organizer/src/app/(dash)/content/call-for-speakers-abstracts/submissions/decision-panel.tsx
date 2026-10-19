'use client';

import { useActionState } from 'react';
import {
  CheckboxField,
  FormActions,
  FormBanner,
  SubmitButton,
  Textarea,
  type FormState,
} from '../../../form';
import { decideAction } from './actions';

/**
 * Accept, waitlist or reject one abstract.
 *
 * ── Two submits, one form ──────────────────────────────────────────────────
 *
 * `SubmitButton` carries a `name`/`value`, so the accept and the reject post the
 * same note and the same "tell the author" choice and differ only in the
 * verdict. Two separate forms would let the note be typed into one and lost by
 * pressing the other, which is the mistake somebody makes once at 23:00 on
 * decision night.
 *
 * ── The notify box is unticked, and it is the only thing that sends mail ────
 *
 * Recording a decision can be undone; the email cannot. A mis-click should
 * record a decision, not announce one, so the default is off and the label says
 * plainly that pressing it with the box ticked cannot be taken back.
 *
 * ── The note is for the author, and only the author ─────────────────────────
 *
 * `ReviewDoc` keeps `commentsToCommittee` and `commentsToAuthors` in separate
 * fields precisely so that one textarea does not do both jobs. This is the
 * second one. Nothing on this screen copies a committee comment into it — that
 * has to be a deliberate paste, because a private remark about a submitter
 * ending up in their rejection is the failure that field split exists to
 * prevent.
 */
export function DecisionPanel({
  id,
  decided,
  authorEmail,
  rolling,
  accepted,
  told,
}: {
  id: string;
  /** True when a decision already stands — the buttons then say "change to". */
  decided: boolean;
  /** Absent when there is no identity document, which disables the mail. */
  authorEmail?: string;
  /**
   * The call runs the rolling review (T249). Accept then mails E2 and tells
   * onboarding by itself, and Reject sends nothing, so there is no note and
   * no notify box to get wrong.
   */
  rolling?: boolean;
  /**
   * Rolling review, and this stands accepted (T262). Rejecting it then
   * needs the withdraw box: the speaker exists and may have been told.
   */
  accepted?: boolean;
  /** The author was emailed the acceptance. */
  told?: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(decideAction, {});

  return (
    <form action={action}>
      {/*
        ⚠️ Never a control named id. React posts the pressed button's name and value by
        inserting a temporary input with `form={form.id}`, and a control named
        `id` makes `form.id` return that control instead of a string. The
        temporary input then belongs to no form, the verdict is dropped, and
        every press answered "Choose accept, waitlist or reject." (T249).
        `tests/parity/submitter-field-names.test.ts` holds the line.
      */}
      <input type="hidden" name="submissionId" value={id} />
      <FormBanner state={state} />

      {rolling ? (
        <p className="body-2">
          Accept creates the speaker, emails {authorEmail ?? 'the author'} their acceptance with the
          link for their details, and tells onboarding. Reject records the decision and sends nothing:
          the author is told only when someone presses Send on Dates and emails, with every other
          rejection.
        </p>
      ) : (
        <>
      <Textarea
        label="A note for the author"
        name="note"
        rows={5}
        placeholder="Optional. Anything here is sent with the decision. The committee's own comments are not."
        hint="Only sent if you tick the box below. Reviewer comments are not copied in."
      />

      <CheckboxField
        name="notify"
        label={
          authorEmail
            ? `Email ${authorEmail} with this decision`
            : 'Email the author, no address on file, so nothing can be sent'
        }
        disabled={!authorEmail}
        description="Unticked by default. An email cannot be recalled once it is sent."
      />
        </>
      )}

      {rolling && accepted ? (
        <CheckboxField
          name="withdraw"
          label="Withdraw the acceptance"
          description={
            told
              ? 'Required to change the decision to rejected. The author has already been emailed their acceptance and will not get the “not accepted” email, so tell them yourself. The speaker becomes unlisted again.'
              : 'Required to change the decision to rejected. Their acceptance email has not been sent and will not be. The speaker becomes unlisted again.'
          }
        />
      ) : null}

      <FormActions>
        <SubmitButton name="verdict" value="accept" pendingLabel="Recording…">
          {decided ? 'Change to accepted' : 'Accept'}
        </SubmitButton>
        {/* Min's rolling review has no waiting list (T252); a legacy call keeps it. */}
        {!rolling && (
          <SubmitButton name="verdict" value="waitlist" variant="secondary" pendingLabel="Recording…">
            {decided ? 'Change to waitlisted' : 'Waitlist'}
          </SubmitButton>
        )}
        <SubmitButton name="verdict" value="reject" variant="danger" pendingLabel="Recording…">
          {decided ? 'Change to rejected' : 'Reject'}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
