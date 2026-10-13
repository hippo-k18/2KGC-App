'use client';

import { useActionState } from 'react';
import { FormBanner, SubmitButton, type FormState } from '../../../form';
import { finishPassAction, reviewDecideAction } from './actions';

/**
 * Accept / Reject / Leave for one row.
 *
 * Leave is selected until something else is pressed, and pressing it sends
 * nothing: the plan calls leaving "a real choice", and the way it is made is
 * by not deciding. Accept mails the speaker straight away, which is what
 * François asked for ("when I click accept then it triggers an email, right?").
 */
export function RowDecision({ submissionId }: { submissionId: string }) {
  const [state, action] = useActionState<FormState, FormData>(reviewDecideAction, {});

  if (state.ok) return <FormBanner state={state} />;

  return (
    <form action={action}>
      <input type="hidden" name="submissionId" value={submissionId} />
      <FormBanner state={state} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <SubmitButton name="verdict" value="accept" small pendingLabel="Accepting…">
          Accept
        </SubmitButton>
        <SubmitButton name="verdict" value="reject" variant="danger" small pendingLabel="Rejecting…">
          Reject
        </SubmitButton>
        {/* Not a submit: leaving is the default, and it records nothing. */}
        <span
          className="whova-btn-main small secondary"
          aria-current="true"
          style={{ cursor: 'default', outline: '2px solid var(--hairline)' }}
        >
          Leave
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          Left for next week unless you choose
        </span>
      </div>
    </form>
  );
}

export function FinishPass({ callId }: { callId: string }) {
  const [state, action] = useActionState<FormState, FormData>(finishPassAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="callId" value={callId} />
      <FormBanner state={state} />
      <SubmitButton variant="secondary" pendingLabel="Saving…">
        Finish this pass
      </SubmitButton>
      <p className="body-2" style={{ marginTop: 8 }}>
        Marks everything above as seen. What arrives after this shows as new next time. Nothing is
        sent.
      </p>
    </form>
  );
}
