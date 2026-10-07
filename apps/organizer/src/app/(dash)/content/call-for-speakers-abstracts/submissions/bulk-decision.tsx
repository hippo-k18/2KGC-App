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
import { bulkDecideAction } from './actions';

/** The id the row checkboxes name in their `form` attribute. */
export const BULK_FORM_ID = 'bulk-decide';

/**
 * One decision for every ticked row.
 *
 * ── The checkboxes live in the table, and the form lives here ───────────────
 *
 * `RowCheckbox` renders an `<input form="bulk-decide">`, which makes it part of
 * this form wherever it sits in the document. The alternative was wrapping the
 * whole table in a form, and the table has its own links and its own search
 * form above it; a form around all of that is a form somebody nests another
 * form inside.
 *
 * Same rules as the single decision: three verdicts on one form so the note
 * cannot be typed into one and lost by pressing another, and the notify box is
 * unticked by default because it is the half that cannot be undone.
 */
export function BulkDecisionBar({ selectable }: { selectable: number }) {
  const [state, action] = useActionState<FormState, FormData>(bulkDecideAction, {});

  return (
    <form id={BULK_FORM_ID} action={action} style={{ marginTop: 16 }}>
      <h3 className="section-header">Decide the ticked submissions</h3>
      <FormBanner state={state} />
      <p className="body-2">
        Tick rows in the table above, then choose one decision for all of them.{' '}
        {selectable === 0 ? 'Nothing on this page can be decided.' : null}
      </p>

      <Textarea
        label="A note for the authors"
        name="note"
        rows={3}
        placeholder="Optional. The same note goes to every ticked author."
        hint="Only sent if you tick the box below."
      />

      <CheckboxField
        name="notify"
        label="Email each author with this decision"
        description="Unticked by default. An email cannot be recalled once it is sent."
      />

      <FormActions>
        <SubmitButton name="verdict" value="accept" pendingLabel="Recording…">
          Accept ticked
        </SubmitButton>
        <SubmitButton name="verdict" value="waitlist" variant="secondary" pendingLabel="Recording…">
          Waitlist ticked
        </SubmitButton>
        <SubmitButton name="verdict" value="reject" variant="danger" pendingLabel="Recording…">
          Reject ticked
        </SubmitButton>
      </FormActions>
    </form>
  );
}

/** One row's tick box. Drafts and withdrawals get none: they cannot be decided. */
export function RowCheckbox({ id, title }: { id: string; title: string }) {
  return (
    <input
      type="checkbox"
      name="ids"
      value={id}
      form={BULK_FORM_ID}
      aria-label={`Select ${title || 'untitled submission'}`}
      style={{ height: 18, width: 18 }}
    />
  );
}

/** Ticks or clears every row box on the page. */
export function SelectAllCheckbox() {
  return (
    <input
      type="checkbox"
      aria-label="Select every submission on this page"
      style={{ height: 18, width: 18 }}
      onChange={(e) => {
        document
          .querySelectorAll<HTMLInputElement>(`input[name="ids"][form="${BULK_FORM_ID}"]`)
          .forEach((box) => {
            box.checked = e.currentTarget.checked;
          });
      }}
    />
  );
}
