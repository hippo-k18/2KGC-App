'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, { step: 'email' });

  if (state.step === 'code') {
    return (
      <form action={action}>
        <p className="body-2" style={{ marginTop: 0 }}>
          We sent a six-digit code to <strong>{state.email}</strong>. It expires in 10 minutes.
        </p>
        {state.notice ? <p className="body-2 muted">{state.notice}</p> : null}
        <div className="whova-form-group">
          <div className="whova-form-label">
            <label htmlFor="code">Code</label>
            <span className="whova-form-label-suffix">*</span>
          </div>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            className={`whova-text-input${state.error ? ' error' : ''}`}
            style={{ letterSpacing: '0.25em', fontSize: 18 }}
            required
            autoFocus
          />
          {state.error ? <p className="whova-form-error-message">{state.error}</p> : null}
        </div>
        <button type="submit" className="whova-btn-main primary" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="body-2" style={{ marginTop: 16, marginBottom: 0, display: 'flex', gap: 16 }}>
          <button type="submit" name="intent" value="restart" formNoValidate className="whova-btn-link">
            Use another address
          </button>
          <button type="submit" name="intent" value="resend" formNoValidate className="whova-btn-link">
            Send a new code
          </button>
        </p>
      </form>
    );
  }

  return (
    <form action={action}>
      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="email">Email</label>
          <span className="whova-form-label-suffix">*</span>
        </div>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={state.email}
          className={`whova-text-input${state.error ? ' error' : ''}`}
          autoComplete="email"
          required
          autoFocus
        />
        {state.error ? <p className="whova-form-error-message">{state.error}</p> : null}
      </div>
      <button type="submit" className="whova-btn-main primary" disabled={pending}>
        {pending ? 'Sending…' : 'Email me a code'}
      </button>
    </form>
  );
}
