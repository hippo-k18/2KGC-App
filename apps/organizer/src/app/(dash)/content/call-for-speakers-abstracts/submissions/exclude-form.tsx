'use client';

import { useActionState } from 'react';
import { Field, FormActions, FormBanner, FormGrid, Select, SubmitButton, type FormState } from '../../../form';
import { excludeReviewerAction } from './actions';

/**
 * Keep one reviewer away from this submission.
 *
 * Offered for every reviewer who is not already off it, assigned or not: the
 * useful moment is before "Assign by track" runs, when the chair already knows
 * who supervised whom.
 */
export function ExcludeReviewerForm({
  submissionId,
  reviewers,
}: {
  submissionId: string;
  reviewers: { id: string; name: string; holds: boolean }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(excludeReviewerAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="submissionId" value={submissionId} />
      <FormBanner state={state} />
      <FormGrid>
        <Select
          label="Reviewer"
          name="reviewerId"
          required
          placeholder="Choose one…"
          width="lg"
          options={reviewers.map((r) => ({
            value: r.id,
            label: r.holds ? `${r.name} (assigned)` : r.name,
          }))}
        />
        <Field
          label="Reason"
          name="note"
          maxLength={500}
          width="lg"
          hint="Optional. Only organizers see it."
        />
      </FormGrid>
      <FormActions>
        <SubmitButton variant="danger" pendingLabel="Excluding…">
          Exclude from this submission
        </SubmitButton>
      </FormActions>
    </form>
  );
}
