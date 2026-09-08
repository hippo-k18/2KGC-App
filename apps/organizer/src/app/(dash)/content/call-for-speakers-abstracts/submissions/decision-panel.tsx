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
 * Accept or reject one abstract.
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
}: {
  id: string;
  /** True when a decision already stands — the buttons then say "change to". */
  decided: boolean;
  /** Absent when there is no identity document, which disables the mail. */
  authorEmail?: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(decideAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <FormBanner state={state} />

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
        description="Unticked by default. An email in somebody's inbox cannot be recalled by anything in this product, so this is the half of the decision that is genuinely final."
      />

      <FormActions>
        <SubmitButton name="verdict" value="accept" pendingLabel="Recording…">
          {decided ? 'Change to accepted' : 'Accept'}
        </SubmitButton>
        <SubmitButton name="verdict" value="reject" variant="danger" pendingLabel="Recording…">
          {decided ? 'Change to rejected' : 'Reject'}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
