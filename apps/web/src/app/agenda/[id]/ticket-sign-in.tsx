'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ticketSignInAction, type TicketSignInState } from '@/app/ticket-actions';

/**
 * "Already have a ticket?" on a session page whose video the reader cannot
 * play yet: their address, then the code mailed to it.
 */
export function TicketSignIn() {
  const router = useRouter();
  const [state, action, pending] = useActionState<TicketSignInState, FormData>(ticketSignInAction, {
    step: 'email',
    email: '',
  });

  // The cookie is set; re-render the page on the server so the video appears.
  useEffect(() => {
    if (state.step === 'done') router.refresh();
  }, [state.step, router]);

  if (state.step === 'code' || state.step === 'done') {
    return (
      <form action={action} className="ticket-signin">
        <p className="watch-sub">
          If <strong>{state.email}</strong> has a ticket, we sent it a six-digit code. It expires
          in 10 minutes.
        </p>
        <div className="ticket-signin-row">
          <input
            className="ticket-signin-input"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            placeholder="Code"
            aria-label="Six-digit code"
            required
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={pending || state.step === 'done'}>
            {pending || state.step === 'done' ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        {state.error && (
          <p className="ticket-signin-error" role="alert">
            {state.error}
          </p>
        )}
        <p className="ticket-signin-foot">
          <button type="submit" name="intent" value="restart" formNoValidate className="linkish">
            Use another address
          </button>
          <button type="submit" name="intent" value="resend" formNoValidate className="linkish">
            Send a new code
          </button>
        </p>
        <p className="watch-sub">No email? Use the address you bought the ticket with.</p>
      </form>
    );
  }

  return (
    <form action={action} className="ticket-signin">
      <p className="watch-sub">Already have a ticket? Sign in with the email you bought it with.</p>
      <div className="ticket-signin-row">
        <input
          className="ticket-signin-input"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="Email"
          aria-label="Email"
          defaultValue={state.email}
          required
        />
        <button type="submit" className="btn btn-outline" disabled={pending}>
          {pending ? 'Sending…' : 'Email me a code'}
        </button>
      </div>
      {state.error && (
        <p className="ticket-signin-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
