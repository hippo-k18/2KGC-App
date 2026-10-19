'use client';

import { useState } from 'react';
import type { CallCfpSettings } from '@kgc/shared';
import {
  CheckboxField,
  Field,
  FormActions,
  FormBanner,
  FormGrid,
  SubmitButton,
  ActionForm,
  useFormAction,
} from '../../../form';
import { ConfirmCodeField } from '@/components/confirm-code';
import {
  saveCfpSettingsAction,
  saveDeclineReasonAction,
  sendCloseDecisionsAction,
  sendStillOpenAction,
} from './actions';

export function SettingsForm({ callId, cfp }: { callId: string; cfp: CallCfpSettings }) {
  const [state, action] = useFormAction(saveCfpSettingsAction, {});
  return (
    <ActionForm run={action}>
      <input type="hidden" name="callId" value={callId} />
      <FormBanner state={state} />
      <FormGrid>
        <Field
          name="closeDate"
          type="date"
          label="Close date"
          defaultValue={cfp.closeDate ?? ''}
          hint="The last day for submissions. The form closes at 23:59 New York time."
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
          name="abstractMaxWords"
          type="number"
          label="Description, most words"
          defaultValue={String(cfp.abstractMaxWords ?? 300)}
        />
      </FormGrid>
      <p className="body-2">Leave a date empty while it is undecided. Its sentence is left out until then.</p>
      <FormActions>
        <SubmitButton>Save</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

export function ReasonForm({ submissionId, reason }: { submissionId: string; reason?: string }) {
  const [state, action] = useFormAction(saveDeclineReasonAction, {});
  return (
    <ActionForm run={action} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
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
    </ActionForm>
  );
}

/** A bulk send behind a tick box. */
export function ConfirmedSend({
  kind,
  callId,
  count,
  label,
  confirmLabel,
  stillOpen,
}: {
  kind: 'close' | 'still-open';
  callId: string;
  count: number;
  label: string;
  confirmLabel: string;
  /**
   * The call is still open: this warning, and a second box that must be
   * ticked as well (T275). The send is allowed, never blocked.
   */
  stillOpen?: string;
}) {
  const [ticked, setTicked] = useState(false);
  const [openTicked, setOpenTicked] = useState(false);
  // A sent batch clears the boxes and the code, so a second press is a new decision.
  const [state, action] = useFormAction(kind === 'close' ? sendCloseDecisionsAction : sendStillOpenAction, {}, {
    resetOnSuccess: true,
    onSuccess: () => {
      setTicked(false);
      setOpenTicked(false);
    },
  });
  const ready = ticked && count > 0 && (!stillOpen || openTicked);
  return (
    <ActionForm run={action}>
      <input type="hidden" name="callId" value={callId} />
      <FormBanner state={state} />
      {stillOpen && (
        <p className="whova-banner warning" role="alert">
          <span>{stillOpen}</span>
        </p>
      )}
      <CheckboxField
        name="confirm"
        label={confirmLabel}
        description="An email cannot be recalled once it is sent."
        checked={ticked}
        onChange={setTicked}
        disabled={count === 0}
      />
      {stillOpen && (
        <CheckboxField
          name="confirmStillOpen"
          label="Send now, while the call is still open"
          checked={openTicked}
          onChange={setOpenTicked}
          disabled={count === 0}
        />
      )}
      {/* A fresh emailed code, as for every other mass send (T252). */}
      {count > 0 && <ConfirmCodeField id={`confirm-code-${kind}`} />}
      <FormActions>
        <SubmitButton disabled={!ready} pendingLabel="Sending…">
          {label}
        </SubmitButton>
      </FormActions>
    </ActionForm>
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
