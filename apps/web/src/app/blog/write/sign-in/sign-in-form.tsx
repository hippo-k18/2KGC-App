'use client';

import { useActionState, useEffect } from 'react';
import { signInAction, type SignInState } from '../actions';

export function SignInForm({ initialEmail }: { initialEmail: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, {
    step: 'email',
    email: initialEmail,
  });

  useEffect(() => {
    if (state.go) window.location.assign(state.go);
  }, [state.go]);

  if (state.step === 'code' || state.step === 'done') {
    return (
      <form action={action} className="st-panel">
        <h1>Check your email</h1>
        <p>
          If <strong>{state.email}</strong> writes for the blog, a six-digit code is on its way. It
          expires in 10 minutes.
        </p>
        <label className="st-field">
          <span>Code</span>
          <input
            className="st-input st-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
            autoFocus
          />
        </label>
        <button className="st-btn st-btn-primary" style={{ width: '100%' }} disabled={pending}>
          {pending || state.step === 'done' ? 'Signing in…' : 'Sign in'}
        </button>
        {state.error && <p className="st-error" role="alert">{state.error}</p>}
        <div className="st-signin-foot">
          <button type="submit" name="intent" value="restart" formNoValidate>
            Use another address
          </button>
          <button type="submit" name="intent" value="resend" formNoValidate>
            Send a new code
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={action} className="st-panel">
      <h1>Sign in to the KGC blog</h1>
      <p>Enter the address your invitation went to. We will email you a code.</p>
      <label className="st-field">
        <span>Email</span>
        <input
          className="st-input"
          type="email"
          name="email"
          autoComplete="email"
          defaultValue={state.email}
          required
          autoFocus
        />
      </label>
      <button className="st-btn st-btn-primary" style={{ width: '100%' }} disabled={pending}>
        {pending ? 'Sending…' : 'Email me a code'}
      </button>
      {state.error && <p className="st-error" role="alert">{state.error}</p>}
    </form>
  );
}
