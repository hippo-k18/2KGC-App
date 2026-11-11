'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { MerchItem } from '@kgc/shared';
import { MerchPicker } from '@/components/merch-picker';
import { formatPrice } from '@/lib/tickets';
import { startMerchCheckout, type MerchCheckoutState } from './actions';

export function MerchForm({ items, token, stripeReady }: { items: MerchItem[]; token: string; stripeReady: boolean }) {
  const [state, action] = useActionState<MerchCheckoutState, FormData>(startMerchCheckout, {});
  const [cents, setCents] = useState(0);
  const currency = items[0]?.currency ?? 'usd';
  return (
    <form action={action} className="checkout">
      {state.error && (
        <p className="notice bad" role="alert">
          {state.error}
        </p>
      )}
      <input type="hidden" name="t" value={token} />
      <MerchPicker items={items} onTotalChange={setCents} title={null} />
      <div className="summary">
        <span>Total</span>
        <span>{formatPrice(cents, currency)}</span>
      </div>
      <Pay disabled={!stripeReady || cents === 0} price={formatPrice(cents, currency)} />
      <p className="hint" style={{ marginTop: 12 }}>
        You pay on Stripe. Sales tax, where it applies, is added there.
      </p>
    </form>
  );
}

function Pay({ disabled, price }: { disabled: boolean; price: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary btn-block" disabled={disabled || pending}>
      {pending ? 'Taking you to payment…' : `Pay ${price}`}
    </button>
  );
}
