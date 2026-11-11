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
export function CodeForm({
  tickets,
}: {
  tickets: { id: string; name: string; hidden: boolean }[];
}) {
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
          Letters, digits, hyphens and underscores. Buyers type this at checkout.
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
            {kind === 'percent' ? '% off the ticket' : 'US dollars off: enter whole dollars'}
          </span>
        </div>
      </div>

      <fieldset className="whova-form-row" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="whova-form-label">Applies to</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
          {tickets.map((t) => (
            <label key={t.id} style={{ alignItems: 'center', display: 'flex', gap: 6, fontSize: 13 }}>
              <input type="checkbox" name="tier" value={t.id} />
              {t.name}
              {t.hidden ? <span className="muted">(hidden)</span> : null}
            </label>
          ))}
        </div>
        {/*
          Leaving every box empty is the common case (a 20% student code), so
          it means every ticket rather than being an error.
        */}
        <p className="muted" style={{ fontSize: 12 }}>
          Leave all unticked for every ticket. Stripe takes the discount off the ticked tickets
          only.
        </p>
      </fieldset>

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
          Blank for unlimited. Set a limit on any code you share outside the team.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="expiresAt">
          Expires
        </label>
        <input id="expiresAt" name="expiresAt" type="datetime-local" />
        <p className="muted" style={{ fontSize: 12 }}>
          Blank means never.
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
