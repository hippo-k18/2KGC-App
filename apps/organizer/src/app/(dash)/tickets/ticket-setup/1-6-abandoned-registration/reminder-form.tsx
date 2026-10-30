'use client';

import { useState } from 'react';
import { ActionForm, CheckboxField, Field, FormActions, FormBanner, SubmitButton, Textarea, useFormAction } from '../../../form';
import { reminderFormAction, type ReminderFormState } from './actions';

export interface ReminderFormValues {
  enabled: boolean;
  delayHours: number;
  subject: string;
  body: string;
  replyTo: string;
  skipList: string[];
}

/**
 * The reminder's settings and Send me a test, in one form so the test sends
 * exactly the words on screen. The answer stays under the buttons until the
 * owner edits the form.
 */
export function ReminderForm({ values, ownerEmail }: { values: ReminderFormValues; ownerEmail: string }) {
  const [state, run] = useFormAction<ReminderFormState>(reminderFormAction, {});
  const [dismissed, setDismissed] = useState<ReminderFormState | null>(null);
  const show = !run.pending && state !== dismissed && Boolean(state.ok || state.error);

  return (
    <ActionForm run={run} onChange={() => setDismissed(state)}>
      <CheckboxField
        name="enabled"
        label="Send the reminder automatically"
        defaultChecked={values.enabled}
        description="Off by default. When you switch it on, only checkouts that close after that get a reminder. Each person gets one reminder at most every 30 days."
      />
      <div style={{ marginTop: 14 }}>
        <Field
          name="delayHours"
          type="number"
          label="Hours to wait after the payment page closed"
          min={1}
          max={720}
          step={1}
          defaultValue={values.delayHours}
          width="sm"
          required
        />
        <Field name="subject" label="Subject" defaultValue={values.subject} maxLength={150} width="xl" required />
        <Textarea
          name="body"
          label="Message"
          hint="Plain text. A blank line starts a new paragraph. {first name} is replaced with their first name, or left out when we do not know it. The ticket they picked, the Finish registering button, the unsubscribe link and the postal address are added below it."
          defaultValue={values.body}
          rows={6}
          maxLength={3000}
          width="xl"
          required
        />
        <Field name="replyTo" type="email" label="Reply-to" defaultValue={values.replyTo} width="lg" required />
        <Textarea
          name="skipList"
          label="Never remind these addresses"
          hint="One per line. Staff and test addresses. Addresses at example.com and example.org, addresses with +test, the dashboard owners and our own test checkouts are always skipped."
          defaultValue={values.skipList.join('\n')}
          rows={3}
          width="lg"
        />
      </div>
      <FormActions style={{ marginTop: 8 }}>
        <SubmitButton name="intent" value="save">
          Save
        </SubmitButton>
        <SubmitButton name="intent" value="test" variant="secondary" pendingLabel="Sending…">
          Send me a test
        </SubmitButton>
      </FormActions>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
        The test goes to {ownerEmail} with the words above, saved or not.
      </p>
      {show ? (
        <div style={{ marginTop: 12 }}>
          <FormBanner state={state} />
          {state.problems?.length ? (
            <ul className="whova-form-error-message" role="alert" style={{ display: 'block', listStyle: 'disc outside', margin: '8px 0 0', paddingLeft: 18 }}>
              {state.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </ActionForm>
  );
}
