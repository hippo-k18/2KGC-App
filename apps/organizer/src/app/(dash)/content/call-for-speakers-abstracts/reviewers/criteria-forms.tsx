'use client';

import { useActionState } from 'react';
import type { RubricCriterionDef } from '@kgc/shared';
import {
  Field,
  FieldIdScope,
  FormActions,
  FormBanner,
  FormGrid,
  Select,
  SubmitButton,
  Textarea,
  type FormState,
} from '../../../form';
import type { ReviewerRow } from '@/lib/reviewers';
import {
  defaultCriteriaAction,
  deleteCriterionAction,
  saveCriterionAction,
  sendInvitationAction,
} from './actions';

/**
 * One scoring criterion: add a new one, or edit the one passed in.
 *
 * `locked` is set once reviews have been scored. The scale fields then go
 * read-only, because a 4 on 1 to 5 is not a 4 on 1 to 10 — the server refuses
 * the change as well, this only stops it being offered.
 */
export function CriterionForm({
  callId,
  existing,
  locked,
}: {
  callId: string;
  existing?: RubricCriterionDef;
  locked?: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(saveCriterionAction, {});
  const [removed, remove] = useActionState<FormState, FormData>(deleteCriterionAction, {});

  return (
    // One scope per criterion: this form is rendered once to add and once
    // inline per existing criterion, so `label`, `min`, `max` and `description`
    // are on the screen four times over.
    <FieldIdScope scope={`criterion-${existing?.id ?? 'new'}`}>
      <>
        <form action={action}>
          <input type="hidden" name="callId" value={callId} />
          {existing && <input type="hidden" name="id" value={existing.id} />}
          <FormBanner state={state} />
          <FormGrid>
            <Field
              label="Name"
              name="label"
              required
              maxLength={80}
              width="lg"
              defaultValue={existing?.label}
              placeholder="Relevance"
            />
            <Field
              label="Lowest score"
              name="min"
              type="number"
              min={0}
              max={99}
              width="sm"
              defaultValue={existing?.min ?? 1}
              readOnly={Boolean(existing && locked)}
            />
            <Field
              label="Highest score"
              name="max"
              type="number"
              min={1}
              max={100}
              width="sm"
              defaultValue={existing?.max ?? 5}
              readOnly={Boolean(existing && locked)}
            />
          </FormGrid>
          <Field
            label="What reviewers should judge"
            name="description"
            maxLength={300}
            width="full"
            defaultValue={existing?.description}
            hint="Shown to reviewers beside the score."
          />
          <FormActions>
            <SubmitButton variant={existing ? 'secondary' : 'primary'}>
              {existing ? 'Save' : 'Add criterion'}
            </SubmitButton>
          </FormActions>
        </form>

        {existing && !locked && (
          <form action={remove} style={{ marginTop: 8 }}>
            <input type="hidden" name="callId" value={callId} />
            <input type="hidden" name="id" value={existing.id} />
            <FormBanner state={removed} />
            <button type="submit" className="linkish" style={{ color: 'var(--danger)' }}>
              Remove this criterion
            </button>
          </form>
        )}
      </>
    </FieldIdScope>
  );
}

/** Offered only on a call with no criteria, so it can never overwrite any. */
export function DefaultCriteriaForm({ callId }: { callId: string }) {
  const [state, action] = useActionState<FormState, FormData>(defaultCriteriaAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="callId" value={callId} />
      <FormBanner state={state} />
      <FormActions>
        <SubmitButton variant="secondary">Start with Relevance, Originality and Clarity</SubmitButton>
      </FormActions>
    </form>
  );
}

/** Send one reviewer, or everyone, their link. The same form is the reminder. */
export function InvitationForm({
  callId,
  reviewers,
  emailOn,
}: {
  callId: string;
  reviewers: ReviewerRow[];
  emailOn: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(sendInvitationAction, {});

  return (
    <FieldIdScope scope="invitation">
      <form action={action}>
        <input type="hidden" name="callId" value={callId} />
        <FormBanner state={state} />
        <Select
          label="Send to"
          name="reviewerId"
          required
          placeholder="Choose…"
          width="xl"
          options={[
            { value: '__all', label: `Everyone on the committee (${reviewers.length})` },
            ...reviewers.map((r) => ({
              value: r.id,
              label: `${r.name} · ${r.assignedCount} assigned${r.lastInvitationAtMs ? ' · invited before' : ''}`,
            })),
          ]}
        />
        <Textarea
          label="A note from you"
          name="note"
          rows={4}
          maxLength={2000}
          placeholder="Optional. Shown above the link, for example when reviews are due."
        />
        <FormActions>
          <SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton>
        </FormActions>
        {!emailOn && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Email is not switched on yet. Until it is, copy each reviewer&rsquo;s link from the list
            above and send it yourself.
          </p>
        )}
      </form>
    </FieldIdScope>
  );
}
