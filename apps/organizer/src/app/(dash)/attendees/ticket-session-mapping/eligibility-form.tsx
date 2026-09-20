'use client';

import { useActionState } from 'react';
import {
  CheckboxField,
  FieldSet,
  FormActions,
  FormBanner,
  Select,
  SubmitButton,
  type FormState,
  type SelectOption,
} from '../../form';
import { restrictWorkshopsAction, saveEligibilityAction } from './actions';

/** One session, and the ticket types that may take a seat in it. */
export function EligibilityForm({
  sessions,
  tiers,
  sessionId,
  allowed,
}: {
  sessions: SelectOption[];
  tiers: string[];
  sessionId?: string;
  allowed: string[];
}) {
  const [state, action] = useActionState<FormState, FormData>(saveEligibilityAction, {});
  return (
    <form action={action}>
      <FormBanner state={state} style={{ marginBottom: 12 }} />
      <Select
        name="sessionId"
        label="Session"
        required
        width="xl"
        options={sessions}
        placeholder="Pick a session"
        defaultValue={sessionId ?? ''}
        error={state.fieldErrors?.sessionId}
      />
      <FieldSet legend="Tickets that may take a seat" hint="Tick none to open the session to every ticket.">
        {tiers.map((name) => (
          <CheckboxField
            key={name}
            name="tickets"
            value={name}
            label={name}
            defaultChecked={allowed.includes(name)}
          />
        ))}
      </FieldSet>
      <FormActions>
        <SubmitButton>Save</SubmitButton>
      </FormActions>
    </form>
  );
}

/** The one-press version for workshops, driven by the ticket types' own switch. */
export function RestrictWorkshopsForm({ count, names }: { count: number; names: string }) {
  const [state, action] = useActionState<FormState, FormData>(restrictWorkshopsAction, {});
  return (
    <form action={action}>
      <FormBanner state={state} style={{ marginBottom: 12 }} />
      <SubmitButton variant="secondary" disabled={count === 0 || !names}>
        Limit all {count} workshops to {names || 'workshop tickets'}
      </SubmitButton>
    </form>
  );
}
