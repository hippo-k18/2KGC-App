'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createDiscountCodeAction, type CodeState } from './actions';

/**
 * Create one discount code.
 *
 * Stripe splits this into a coupon (the discount) and a promotion code (the
 * string people type). That split is a Stripe implementation detail and is
 * deliberately not exposed here — the action creates both.
 */
export function CodeForm() {
  const [state, action] = useActionState<CodeState, FormData>(createDiscountCodeAction, {});
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [code, setCode] = useState('');

  return (
    <form action={action}>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="code">
          Code
        </label>
        <input
          id="code"
          name="code"
          required
          value={code}
          // Upper-cased as you type, because Stripe upper-cases it anyway and a
          // code that looks different here from what the buyer is told to type
          // generates support email.
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="SPEAKER25"
          maxLength={40}
          style={{ maxWidth: 260, fontFamily: 'ui-monospace, Menlo, monospace' }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          Letters, digits, hyphens and underscores. This is what people type at checkout, so make it
          something you can read out on a call.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="value">
          Discount
        </label>
        <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'percent' | 'amount')}
            style={{ maxWidth: 150 }}
          >
            <option value="percent">Percentage off</option>
            <option value="amount">Fixed amount off</option>
          </select>
          <input
            id="value"
            name="value"
            required
            inputMode="decimal"
            placeholder={kind === 'percent' ? '25' : '200'}
            style={{ maxWidth: 120 }}
          />
          <span className="muted" style={{ fontSize: 13 }}>
            {kind === 'percent' ? '% off the ticket' : 'US dollars off — enter whole dollars'}
          </span>
        </div>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="maxRedemptions">
          Redemption limit
        </label>
        <input
          id="maxRedemptions"
          name="maxRedemptions"
          type="number"
          min={1}
          placeholder="Unlimited"
          style={{ maxWidth: 160 }}
        />
        {/*
          The single most useful field on this form. A sponsor allocation with no
          cap is a discount code circulating on the internet, and the first sign
          of it is a revenue figure that does not add up.
        */}
        <p className="muted" style={{ fontSize: 12 }}>
          Blank for unlimited. Set it for anything you hand to a third party — an uncapped code that
          escapes is a discount for everyone.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="expiresAt">
          Expires
        </label>
        <input id="expiresAt" name="expiresAt" type="datetime-local" />
        <p className="muted" style={{ fontSize: 12 }}>
          Blank means never. Early-bird codes want a date here.
        </p>
      </div>

      <CreateButton />
    </form>
  );
}

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Creating in Stripe…' : 'Create code'}
    </button>
  );
}
