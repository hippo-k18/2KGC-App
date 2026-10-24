'use client';

import { useActionState, useState } from 'react';
import { deleteSignedInAccountAction, type DeleteState } from './actions';

/**
 * The two ways to confirm a deletion on the web.
 *
 * Signed in with a ticket on this site: type DELETE and confirm. Otherwise:
 * your address, a code we email to it, then type DELETE. The code is the same
 * one the app signs in with (`/api/auth/request-code`), and it is used up by
 * the deletion without signing anybody in.
 */
export function DeleteAccountForm({ signedInAs }: { signedInAs: string | null }) {
  if (signedInAs) return <SignedIn email={signedInAs} />;
  return <ByCode />;
}

function Done() {
  return (
    <p role="status">
      <strong>Your app account is deleted.</strong> The app signs you out the next time it checks, within
      an hour at most. Your ticket still works.
    </p>
  );
}

function ConfirmField() {
  return (
    <label style={{ display: 'block', margin: '14px 0 6px' }}>
      Type <strong>DELETE</strong> to confirm
      <input
        className="ticket-signin-input"
        name="confirm"
        autoComplete="off"
        autoCapitalize="characters"
        required
        style={{ display: 'block', marginTop: 6 }}
      />
    </label>
  );
}

function SignedIn({ email }: { email: string }) {
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteSignedInAccountAction, {});
  if (state.done) return <Done />;
  return (
    <form action={action} className="ticket-signin">
      <p>
        You are signed in as <strong>{email}</strong>. This deletes the app account for that address.
      </p>
      <ConfirmField />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Deleting…' : 'Delete my account'}
      </button>
      {state.error && (
        <p className="ticket-signin-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

function ByCode() {
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: unknown): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: res.ok, message: json.message };
    } catch {
      return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
    }
  }

  async function sendCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const typed = String(new FormData(e.currentTarget).get('email') ?? '').trim();
    setBusy(true);
    setError('');
    const res = await post('/api/auth/request-code', { email: typed });
    setBusy(false);
    if (!res.ok) return setError(res.message ?? 'Could not send a code.');
    setEmail(typed);
    setStep('code');
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (String(f.get('confirm') ?? '').trim().toUpperCase() !== 'DELETE') return setError('Type DELETE to confirm.');
    setBusy(true);
    setError('');
    const res = await post('/api/account/delete', { email, code: String(f.get('code') ?? '').replace(/\D/g, '') });
    setBusy(false);
    if (!res.ok) return setError(res.message ?? 'Your account could not be deleted.');
    setStep('done');
  }

  if (step === 'done') return <Done />;

  if (step === 'code') {
    return (
      <form onSubmit={confirm} className="ticket-signin">
        <p>
          We sent a six-digit code to <strong>{email}</strong>. It expires in 10 minutes.
        </p>
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
        <ConfirmField />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
        {error && (
          <p className="ticket-signin-error" role="alert">
            {error}
          </p>
        )}
        <p className="ticket-signin-foot">
          <button type="button" className="linkish" onClick={() => { setStep('email'); setError(''); }}>
            Use another address
          </button>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} className="ticket-signin">
      <p>Enter the email address you use in the app. We will email you a code to confirm it is you.</p>
      <div className="ticket-signin-row">
        <input
          className="ticket-signin-input"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="Email"
          aria-label="Email"
          defaultValue={email}
          required
        />
        <button type="submit" className="btn btn-outline" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a code'}
        </button>
      </div>
      {error && (
        <p className="ticket-signin-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
