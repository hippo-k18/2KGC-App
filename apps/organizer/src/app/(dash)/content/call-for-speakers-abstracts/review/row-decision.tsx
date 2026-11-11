'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { REVIEW_HELP } from '@kgc/scripts/src/lib/cfp-core';
import {
  FormBanner,
  SubmitButton,
  ActionForm,
  useFormAction,
  type FormState,
} from '../../../form';
import { AcceptWithEmail, ContactAuthor } from '../cfp-dialogs';
import { finishPassAction, reviewDecideAction } from './actions';

/**
 * Accept / Reject / Leave for one row, each with its one line (T378).
 *
 * Accept opens the acceptance email for editing and sends it (François: "when
 * I click accept then it triggers an email, right?"). Reject records and sends
 * nothing. Leave is recorded: off this week's list, back after the next pass,
 * status unchanged. Once one is pressed the row shows what happened instead.
 */
export function RowDecision({ submissionId, e2Held }: { submissionId: string; e2Held: boolean }) {
  const [state, action] = useFormAction(reviewDecideAction, {}, { resetOnSuccess: true });
  const [accepted, setAccepted] = useState<FormState | null>(null);

  if (accepted) return <FormBanner state={accepted} />;
  if (state.ok) return <FormBanner state={state} />;

  /*
   * The Accept dialog holds a form of its own, so it sits outside these: a
   * form inside a form is dropped by the browser. Reject and Leave share one
   * action, each in its own small form.
   */
  const one = (verdict: 'reject' | 'leave', button: ReactNode) => (
    <ActionForm run={action} style={{ display: 'inline' }}>
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="verdict" value={verdict} />
      {button}
    </ActionForm>
  );

  return (
    <div>
      <FormBanner state={state} />
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        <Choice
          button={<AcceptWithEmail submissionId={submissionId} action={reviewDecideAction} small onAccepted={setAccepted} />}
          help={e2Held ? REVIEW_HELP.acceptHeld : REVIEW_HELP.accept}
        />
        <Choice
          button={one(
            'reject',
            <SubmitButton variant="danger" small pendingLabel="Rejecting…">
              Reject
            </SubmitButton>,
          )}
          help={REVIEW_HELP.reject}
        />
        <Choice
          button={one(
            'leave',
            <SubmitButton variant="secondary" small pendingLabel="Leaving…">
              Leave
            </SubmitButton>,
          )}
          help={REVIEW_HELP.leave}
        />
      </ul>
      <div style={{ marginTop: 10 }}>
        <ContactAuthor submissionId={submissionId} small />
      </div>
    </div>
  );
}

function Choice({ button, help }: { button: ReactNode; help: string }) {
  return (
    <li style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ minWidth: 72, display: 'inline-flex' }}>{button}</span>
      <span className="muted" style={{ fontSize: 12 }}>
        {help}
      </span>
    </li>
  );
}

export function FinishPass({ callId }: { callId: string }) {
  const [state, action] = useFormAction(finishPassAction, {});
  return (
    <ActionForm run={action}>
      <input type="hidden" name="callId" value={callId} />
      <FormBanner state={state} />
      <SubmitButton variant="secondary" pendingLabel="Saving…">
        Finish this pass
      </SubmitButton>
      <p className="body-2" style={{ marginTop: 8 }}>
        {REVIEW_HELP.finish} Nothing is sent.
      </p>
    </ActionForm>
  );
}

/**
 * Asks the server again when the browser shows an old copy of the list (T378).
 *
 * François saw decided talks still listed in a new session. The server read
 * is fresh on every request (`force-dynamic`, no cache anywhere), but the
 * browser can put an earlier copy back without asking: the Back button
 * (Next's router cache, which the row buttons deliberately leave alone so
 * their confirmation stays on screen), the page restored from the back/forward
 * cache, or a tab brought back with the browser. The page says when the server
 * rendered it, and a copy more than a few seconds old is refreshed in place.
 */
export function RefreshWhenStale({ renderedAtMs }: { renderedAtMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const check = () => {
      if (Date.now() - renderedAtMs > 5_000) router.refresh();
    };
    check();
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) router.refresh();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [renderedAtMs, router]);
  return null;
}
