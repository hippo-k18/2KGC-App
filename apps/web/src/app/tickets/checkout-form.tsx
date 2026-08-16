'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { formatPrice, TIERS, type TicketId } from '@/lib/tickets';
import { startCheckout, type CheckoutState } from './actions';

/**
 * The purchase form.
 *
 * It collects a name, an email and a tier id — nothing else, and in
 * particular no price and no card details. The price is looked up server-side
 * from the tier id (see `actions.ts`), and card details are collected by
 * Stripe on their own domain.
 *
 * The email matters more than it looks: it is the join key. `registrationId`
 * is derived from it, and the attendee later signs into the mobile app with
 * the same address to claim the ticket. That is why the label says so.
 */
export function CheckoutForm({ initialTier, stripeReady }: { initialTier: TicketId; stripeReady: boolean }) {
  const [state, action] = useActionState<CheckoutState, FormData>(startCheckout, {});
  const [tier, setTier] = useState<TicketId>(initialTier);
  // Controlled, not merely `defaultValue`: React resets an uncontrolled form
  // once its action settles, so a failed payment would blank the fields the
  // buyer just typed and make them do it again — at the exact moment they are
  // least inclined to.
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const selected = TIERS.find((t) => t.id === tier)!;

  return (
    <form action={action} className="checkout" id="buy">
      <h2 style={{ fontSize: '1.4rem' }}>Register</h2>

      {state.error && (
        <p className="notice bad" role="alert">
          {state.error}
        </p>
      )}

      {!stripeReady && (
        <p className="notice warn">
          <strong>Test mode.</strong> No payment processor is configured on this deployment, so the
          button below completes the registration without taking any money. Nothing is charged and
          no card details are collected.
        </p>
      )}

      <div className="field">
        <label htmlFor="tier">Ticket</label>
        <select id="tier" name="tier" value={tier} onChange={(e) => setTier(e.target.value as TicketId)}>
          {TIERS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {formatPrice(t.priceCents)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="name">Attendee name</label>
        <input
          id="name"
          name="name"
          autoComplete="name"
          required
          placeholder="Ada Nakamura"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="hint">This is what gets printed on the badge.</p>
      </div>

      <div className="field">
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="hint">
          Use the address the attendee will sign into the KGC app with — that is how the ticket finds
          them. You can add alternates later.
        </p>
      </div>

      <div className="summary">
        <span>{selected.name}</span>
        <span>{formatPrice(selected.priceCents)}</span>
      </div>

      <SubmitButton stripeReady={stripeReady} price={formatPrice(selected.priceCents)} />

      <p className="hint" style={{ marginTop: 12 }}>
        {stripeReady
          ? 'You will be taken to Stripe to pay. Card details never touch this site.'
          : 'No payment is taken. Your registration is written exactly as a paid one would be.'}
      </p>
    </form>
  );
}

/**
 * Split out because `useFormStatus` only reports the status of the form it is
 * rendered *inside*; called from the same component as `<form>` it always
 * returns `pending: false`. The redirect to Stripe takes a moment, and a
 * button that does not visibly change is a button people click twice.
 */
function SubmitButton({ stripeReady, price }: { stripeReady: boolean; price: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
      {pending
        ? 'Working…'
        : stripeReady
          ? `Pay ${price} with Stripe`
          : 'Complete test purchase (no payment taken)'}
    </button>
  );
}
