'use client';

import { useActionState } from 'react';
import { setPassphraseAction, type SetPassphraseState } from './actions';

export function SetPassphraseForm({
  token,
  email,
  minLength,
}: {
  token: string;
  email: string;
  minLength: number;
}) {
  const [state, action, pending] = useActionState<SetPassphraseState, FormData>(
    setPassphraseAction,
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      {/* Present so a password manager files the new passphrase under the address. */}
      <input type="hidden" name="email" value={email} autoComplete="username" />

      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="passphrase">Passphrase</label>
          <span className="whova-form-label-suffix">*</span>
        </div>
        <input
          id="passphrase"
          name="passphrase"
          type="password"
          className={`whova-text-input${state.error ? ' error' : ''}`}
          autoComplete="new-password"
          minLength={minLength}
          required
          autoFocus
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          At least {minLength} characters.
        </p>
      </div>

      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="again">Passphrase again</label>
          <span className="whova-form-label-suffix">*</span>
        </div>
        <input
          id="again"
          name="again"
          type="password"
          className={`whova-text-input${state.error ? ' error' : ''}`}
          autoComplete="new-password"
          required
        />
        {state.error ? <p className="whova-form-error-message">{state.error}</p> : null}
      </div>

      <button type="submit" className="whova-btn-main primary" disabled={pending}>
        {pending ? 'Saving…' : 'Save and sign in'}
      </button>
    </form>
  );
}
