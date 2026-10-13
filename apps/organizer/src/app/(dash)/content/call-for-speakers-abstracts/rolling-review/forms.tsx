'use client';

import { useActionState, useState } from 'react';
import type { CallCfpSettings } from '@kgc/shared';
import {
  CheckboxField,
  Field,
  FormActions,
  FormBanner,
  FormGrid,
  SubmitButton,
  type FormState,
} from '../../../form';
import {
  saveCfpSettingsAction,
  saveDeclineReasonAction,
  sendCloseDecisionsAction,
  sendStillOpenAction,
} from './actions';

export function SettingsForm({ callId, cfp }: { callId: string; cfp: CallCfpSettings }) {
  const [state, action] = useActionState<FormState, FormData>(saveCfpSettingsAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="callId" value={callId} />
      <FormBanner state={state} />
      <FormGrid>
        <Field
          name="closeDate"
          type="date"
          label="Close date"
          defaultValue={cfp.closeDate ?? ''}
          hint="The last day submissions are taken. Also becomes the deadline, at 23:59 New York time."
        />
        <Field
          name="decisionDate"
          type="date"
          label="Decision date"
          defaultValue={cfp.decisionDate ?? ''}
          hint="Everyone has an answer by this day. Used on the page, in E1, E6 and S1."
        />
        <Field
          name="sessionNoticeDate"
          type="date"
          label="Session day and time notice"
          defaultValue={cfp.sessionNoticeDate ?? ''}
          hint="E2 says: Your session day and time will be shared by this date."
        />
        <Field
          name="acceptNoticeEmail"
          type="email"
          label="Tell this address about every acceptance"
          defaultValue={cfp.acceptNoticeEmail ?? ''}
          hint="Min, to start onboarding."
        />
        <Field
          name="reviewerReminderEmail"
          type="email"
          label="Thursday reminder goes to"
          defaultValue={cfp.reviewerReminderEmail ?? ''}
          hint="François. Sent Thursdays from 9:00 New York time."
        />
        <Field
          name="talkMinutes"
          label="Talk lengths, in minutes"
          defaultValue={(cfp.talkMinutes ?? [25, 45]).join(', ')}
        />
        <Field
          name="abstractMinWords"
          type="number"
          label="Abstract, fewest words"
          defaultValue={String(cfp.abstractMinWords ?? 150)}
        />
        <Field
          name="abstractMaxWords"
          type="number"
          label="Abstract, most words"
          defaultValue={String(cfp.abstractMaxWords ?? 300)}
        />
      </FormGrid>
      <p className="body-2">Leave a date empty while it is undecided. Its sentence is left out until then.</p>
      <FormActions>
        <SubmitButton>Save</SubmitButton>
      </FormActions>
    </form>
  );
}

export function ReasonForm({ submissionId, reason }: { submissionId: string; reason?: string }) {
  const [state, action] = useActionState<FormState, FormData>(saveDeclineReasonAction, {});
  return (
    <form action={action} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <input type="hidden" name="submissionId" value={submissionId} />
      <input
        name="reason"
        defaultValue={reason ?? ''}
        maxLength={300}
        placeholder="One line: the nearest true reason. Optional."
        aria-label="Reason for the not-accepted email"
        style={{ flex: '1 1 320px', minWidth: 0 }}
      />
      <SubmitButton small variant="secondary">
        Save line
      </SubmitButton>
      <div style={{ flexBasis: '100%' }}>
        <FormBanner state={state} />
      </div>
    </form>
  );
}

/** A bulk send behind a tick box. */
export function ConfirmedSend({
  kind,
  callId,
  count,
  label,
  confirmLabel,
}: {
  kind: 'close' | 'still-open';
  callId: string;
  count: number;
  label: string;
  confirmLabel: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(
    kind === 'close' ? sendCloseDecisionsAction : sendStillOpenAction,
    {},
  );
  const [ticked, setTicked] = useState(false);
  return (
    <form action={action}>
      <input type="hidden" name="callId" value={callId} />
      <FormBanner state={state} />
      <CheckboxField
        name="confirm"
        label={confirmLabel}
        description="An email cannot be recalled once it is sent."
        checked={ticked}
        onChange={setTicked}
        disabled={count === 0}
      />
      <FormActions>
        <SubmitButton disabled={!ticked || count === 0} pendingLabel="Sending…">
          {label}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

export function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <textarea
        readOnly
        value={text}
        rows={Math.min(16, text.split('\n').length + 2)}
        aria-label={label}
        style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }}
      />
      <button
        type="button"
        className="whova-btn-main small secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
