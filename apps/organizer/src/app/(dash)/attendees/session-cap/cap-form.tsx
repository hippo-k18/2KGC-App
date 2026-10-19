'use client';

import { useActionState } from 'react';
import { Field, FormBanner, SubmitButton, type FormState } from '../../form';
import { setCapAction } from './actions';

/** The cap for one session. Blank removes it. */
export function CapForm({ sessionId, capacity }: { sessionId: string; capacity?: number }) {
  const [state, action] = useActionState<FormState, FormData>(setCapAction, {});
  return (
    <form action={action}>
      <FormBanner state={state} style={{ marginBottom: 12 }} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <div className="form-row" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <Field
          name="capacity"
          label="Cap"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          width="sm"
          defaultValue={capacity ?? ''}
          error={state.fieldErrors?.capacity}
          hint="Leave blank for no cap."
          groupStyle={{ marginBottom: 0 }}
        />
        <SubmitButton>Save cap</SubmitButton>
      </div>
    </form>
  );
}
