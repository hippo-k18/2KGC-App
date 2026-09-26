'use client';

import { ConfirmCodeField } from '@/components/confirm-code';

import { useActionState, useState } from 'react';
import { Field, FormBanner, SubmitButton, type FormState } from '../../../form';
import { erasePersonAction } from './person-data-actions';

/**
 * The confirmation that stands between a row menu and a person ceasing to
 * exist in this database.
 *
 * The phrase to type is the **email address on the row**, not the word delete.
 * `ConfirmButton` makes the same argument for refunds and it applies harder
 * here: a fixed word becomes muscle memory after the third one, and typing the
 * address requires reading which row you are on. That is the mistake being
 * defended against — not a person who means to erase somebody, a person who
 * means to erase somebody else.
 *
 * ⚠️ The disabled button is a convenience. `erasePerson()` re-checks the typed
 * value against the address it resolved server-side, because anything enforced
 * only in the browser is enforced only for people who did not think to look.
 *
 * ── Why the disclosure is in here rather than around it ─────────────────────
 *
 * Because the action revalidates the attendee list, which re-runs the panel
 * above — and the person it was describing is now gone, so everything above
 * this line is replaced by "nothing is held any more". If this component sat
 * inside that replaced markup it would unmount at the moment it succeeded, and
 * the organizer would be told nothing: no count, no list of what was kept, just
 * a panel that emptied. It keeps its own position in the panel's children so it
 * survives that re-render and can say what it did.
 */
export function ErasePersonForm({
  refParam,
  email,
  total,
  needsPassphrase,
}: {
  refParam: string;
  /** Empty once there is nobody left to delete. */
  email: string;
  total: number;
  /** False only on a machine with no passphrase configured, i.e. localhost. */
  needsPassphrase: boolean;
}) {
  const [state, erase] = useActionState<FormState, FormData>(erasePersonAction, {});
  const [typed, setTyped] = useState('');
  const armed = typed.trim().toLowerCase() === email.toLowerCase() && email.length > 0;

  if (state.ok) return <FormBanner state={state} style={{ marginBottom: 0 }} />;
  if (!email) return null;

  return (
    <details
      id="erase"
      style={{ borderTop: '1px solid var(--hairline)', marginTop: 20, paddingTop: 16 }}
    >
      <summary className="linkish" style={{ color: 'var(--danger)', cursor: 'pointer' }}>
        Delete everything held about them
      </summary>
      <div style={{ marginTop: 12 }}>
        <p className="body-2">
          This removes {total} {total === 1 ? 'record' : 'records'} and cannot be undone. Their
          ticket, profile, check-ins, messages, posts and survey answers go. They can no longer sign
          into the app.
        </p>
        <p className="body-2">
          Five things stay, with their name and address taken off each. What they paid, because it
          is on the books. What they signed, because it is the record that they agreed. Their row on
          the mailing list, which is marked unsubscribed so a later import cannot email them. Their
          talk on the published programme, if they spoke. And the log of what organizers did. The
          table above says which is which.
        </p>
        <p className="body-2">
          Download the file first if they asked for a copy. It cannot be produced afterwards.
        </p>
        <form action={erase}>
          <input type="hidden" name="ref" value={refParam} />
          <FormBanner state={state} />
          <Field
            name="confirm"
            width="lg"
            label={
              <>
                Type <code>{email}</code> to confirm
              </>
            }
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={email}
            autoComplete="off"
            groupStyle={{ marginBottom: 12 }}
          />
          {needsPassphrase && <ConfirmCodeField id="erase-confirm-code" />}
          <SubmitButton variant="danger" disabled={!armed} pendingLabel="Deleting…">
            Delete everything
          </SubmitButton>
        </form>
      </div>
    </details>
  );
}
