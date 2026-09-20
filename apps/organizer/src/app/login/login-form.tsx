'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';

export function LoginForm({ needsPassphrase }: { needsPassphrase: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={action}>
      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="email">Organizer email or username</label>
          <span className="whova-form-label-suffix">*</span>
        </div>
        <input
          id="email"
          name="email"
          type="text"
          inputMode="email"
          className={`whova-text-input${state.error ? ' error' : ''}`}
          autoComplete="username"
          required
          autoFocus
        />
        {state.error ? <p className="whova-form-error-message">{state.error}</p> : null}
      </div>
      {/*
        Always shown. An invited team member signs in with a passphrase of their
        own even where no shared one is configured; `needsPassphrase` only
        decides whether leaving it empty is allowed.
      */}
      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="passphrase">Password</label>
          {needsPassphrase ? <span className="whova-form-label-suffix">*</span> : null}
        </div>
        <input
          id="passphrase"
          name="passphrase"
          type="password"
          className={`whova-text-input${state.error ? ' error' : ''}`}
          autoComplete="current-password"
          required={needsPassphrase}
        />
      </div>

      <button type="submit" className="whova-btn-main primary" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
