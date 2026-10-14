'use client';

import { useActionState, useEffect, useState } from 'react';
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
 *
 * ── On the rolling review there is no box to untick (T262) ─────────────────
 *
 * There, Accept emails every author their acceptance whatever the box said,
 * so the note and the box are gone and Accept asks first: "N authors will be
 * emailed". The N it showed is posted and re-checked by the server.
 */
export function BulkDecisionBar({
  selectable,
  rolling,
  holdsE2,
}: {
  selectable: number;
  rolling?: boolean;
  /** The call has closed, so an acceptance's email waits for the decision send. */
  holdsE2?: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(bulkDecideAction, {});
  const [confirming, setConfirming] = useState<number | null>(null);
  const [nothingTicked, setNothingTicked] = useState(false);
  // A finished press, either way, closes the question.
  useEffect(() => setConfirming(null), [state]);

  const ticked = () =>
    document.querySelectorAll<HTMLInputElement>(`input[name="ids"][form="${BULK_FORM_ID}"]:checked`).length;
  const people = (n: number) => (n === 1 ? 'author' : 'authors');

  return (
    <form id={BULK_FORM_ID} action={action} style={{ marginTop: 16 }}>
      <h3 className="section-header">Decide the ticked submissions</h3>
      <FormBanner state={state} />
      {nothingTicked && confirming === null ? (
        <div className="whova-banner danger" role="alert">
          Tick at least one submission first.
        </div>
      ) : null}
      <p className="body-2">
        Tick rows in the table above, then choose one decision for all of them.{' '}
        {selectable === 0 ? 'Nothing on this page can be decided.' : null}
      </p>

      {rolling ? (
        <p className="body-2">
          {holdsE2
            ? 'Accept creates each speaker. The call has closed, so their acceptance emails wait for the decision send.'
            : 'Accept creates each speaker and emails each author their acceptance straight away.'}{' '}
          Reject records the decision and sends nothing. An accepted submission cannot be rejected from here.
        </p>
      ) : (
        <>
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
        </>
      )}

      {rolling && confirming !== null ? (
        <div
          role="alertdialog"
          aria-label="Confirm the acceptances"
          style={{
            background: 'var(--surface-alt)',
            border: '1px solid var(--hairline)',
            borderRadius: 4,
            marginTop: 12,
            padding: 12,
          }}
        >
          <input type="hidden" name="confirmCount" value={confirming} />
          <p className="body-2" style={{ marginTop: 0 }}>
            <strong>
              {holdsE2
                ? `${confirming} ${people(confirming)} will be accepted. Their emails wait for the decision send.`
                : `${confirming} ${people(confirming)} will be emailed their acceptance now.`}
            </strong>{' '}
            An email cannot be recalled once it is sent.
          </p>
          <FormActions>
            <SubmitButton name="verdict" value="accept" pendingLabel="Accepting…">
              {holdsE2 ? `Accept ${confirming}` : `Accept and email ${confirming}`}
            </SubmitButton>
            <button type="button" className="whova-btn-main secondary" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </FormActions>
        </div>
      ) : null}

      <FormActions>
        {rolling ? (
          <button
            type="button"
            className="whova-btn-main primary"
            disabled={confirming !== null}
            onClick={() => {
              const n = ticked();
              setNothingTicked(n === 0);
              setConfirming(n === 0 ? null : n);
            }}
          >
            Accept ticked
          </button>
        ) : (
          <SubmitButton name="verdict" value="accept" pendingLabel="Recording…">
            Accept ticked
          </SubmitButton>
        )}
        {/* No waiting list on Min's rolling review (T252). */}
        {!rolling && (
          <SubmitButton name="verdict" value="waitlist" variant="secondary" pendingLabel="Recording…">
            Waitlist ticked
          </SubmitButton>
        )}
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
