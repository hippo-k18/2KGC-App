'use client';

import { useState } from 'react';
import { sendConfirmCodeAction } from '@/app/login/confirm-actions';

/**
 * The code that confirms an action which cannot be taken back. It replaced the
 * "dashboard passphrase" box on six screens: the field is still posted as
 * `passphrase`, and `reauthenticate()` checks it as an emailed code.
 *
 * `whova` lays it out like the dashboard's own form rows; `compact` fits the
 * small panels on the orders table.
 */
export function ConfirmCodeField({ id = 'confirm-code', variant = 'whova' }: { id?: string; variant?: 'whova' | 'compact' }) {
  const [state, setState] = useState<{ busy?: boolean; text?: string; error?: boolean }>({});

  const send = async () => {
    setState({ busy: true });
    const res = await sendConfirmCodeAction();
    setState(res.ok ? { text: `Code sent to ${res.email}.` } : { text: res.error, error: true });
  };

  const input = (
    <input
      id={id}
      name="passphrase"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={7}
      placeholder="6-digit code"
      className={variant === 'whova' ? 'whova-text-input' : undefined}
      style={variant === 'whova' ? { maxWidth: 160, letterSpacing: '0.2em' } : { width: 130, letterSpacing: '0.2em' }}
    />
  );
  const button = (
    <button type="button" className="whova-btn-main secondary" onClick={send} disabled={state.busy} style={{ whiteSpace: 'nowrap' }}>
      {state.busy ? 'Sending…' : state.text && !state.error ? 'Send another' : 'Email me a code'}
    </button>
  );

  return (
    <div className={variant === 'whova' ? 'whova-form-group' : undefined} style={{ marginBottom: variant === 'whova' ? 12 : 8 }}>
      <label htmlFor={id} className={variant === 'whova' ? 'whova-form-label' : undefined} style={variant === 'compact' ? { display: 'block', fontSize: 12, marginBottom: 4 } : undefined}>
        Confirmation code
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {input}
        {button}
      </div>
      {state.text && (
        <p className={state.error ? 'whova-form-error-message' : 'muted'} style={{ fontSize: 12, margin: '4px 0 0' }}>
          {state.text}
        </p>
      )}
    </div>
  );
}
