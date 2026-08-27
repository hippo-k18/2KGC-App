'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { QuestionFieldDef } from '@kgc/shared';
import { formatPrice, type Tier, type TicketId } from '@/lib/tickets';
import { startCheckout, type CheckoutState } from './actions';
import { Questions } from './questions';
import { DemoPanel } from '@/components/demo-panel';
import { DEMO_BUYER } from '@/lib/demo-credentials';

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
export function CheckoutForm({
  tiers,
  initialTier,
  stripeReady,
  demo = false,
  questions = [],
}: {
  /**
   * The catalogue, passed in rather than imported.
   *
   * Tiers live in Firestore now, and this is a client component — it has no
   * Admin SDK and must not gain one. Props are the boundary that keeps a
   * service-account credential out of a browser chunk.
   */
  tiers: Tier[];
  initialTier: TicketId;
  stripeReady: boolean;
  /**
   * Demo mode, passed down rather than read here: `demoMode()` is `server-only`
   * and this component runs in the browser.
   */
  demo?: boolean;
  /**
   * The organizer's registration questions, or none.
   *
   * Passed as props like the tiers, and for the same reason: this is a client
   * component with no Admin SDK, and it must not gain one.
   */
  questions?: QuestionFieldDef[];
}) {
  const [state, action] = useActionState<CheckoutState, FormData>(startCheckout, {});
  const [tier, setTier] = useState<TicketId>(initialTier);
  // Controlled, not merely `defaultValue`: React resets an uncontrolled form
  // once its action settles, so a failed payment would blank the fields the
  // buyer just typed and make them do it again — at the exact moment they are
  // least inclined to.
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  /**
   * The card box, in demo mode only.
   *
   * These three values are held in React state and rendered into inputs that
   * carry **no `name` attribute**, so the browser never serialises them into the
   * FormData the server action receives. That is the whole safety property: a
   * payment form that looks like one, that cannot transmit a card number even by
   * accident. Nothing validates them and nothing reads them.
   */
  const [card, setCard] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  // `?? tiers[0]` rather than a non-null assertion: the preselected id comes
  // from a query string, and a tier hidden in the dashboard between page load
  // and this render would otherwise crash the whole form.
  const selected = tiers.find((t) => t.id === tier) ?? tiers[0];

  return (
    <form action={action} className="checkout" id="buy">
      <h2 style={{ fontSize: '1.4rem' }}>Register</h2>

      {state.error && (
        <p className="notice bad" role="alert">
          {state.error}
        </p>
      )}

      {demo ? (
        <p className="notice warn">
          <strong>Demo.</strong> The card box below is for show — it is never submitted and no card
          is charged. Everything after the button is real: the registration, the order, the claim
          code, and the sale appearing on the organizer dashboard.
        </p>
      ) : !stripeReady ? (
        <p className="notice warn">
          <strong>Test mode.</strong> No payment processor is configured on this deployment, so the
          button below completes the registration without taking any money. Nothing is charged and
          no card details are collected.
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="tier">Ticket</label>
        <select id="tier" name="tier" value={tier} onChange={(e) => setTier(e.target.value as TicketId)}>
          {tiers.map((t) => (
            <option key={t.id} value={t.id} disabled={!t.onSale}>
              {t.name} — {formatPrice(t.priceCents, t.currency)}
              {t.onSale ? '' : ` (${t.unavailableReason ?? 'unavailable'})`}
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

      {/*
        The organizer's questions, between the buyer's details and the total.
        Above the price rather than below it, because a question appearing after
        somebody has read the amount reads as a hurdle placed in front of paying.
      */}
      <Questions fields={questions} ticketTypeId={tier} errors={state.fieldErrors} />

      {demo ? (
        <fieldset className="demo-card">
          <legend>Card</legend>
          <div className="demo-card-grid">
            <input
              aria-label="Card number"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Card number"
              value={card}
              onChange={(e) => setCard(e.target.value)}
            />
            <input
              aria-label="Expiry"
              autoComplete="off"
              placeholder="MM / YY"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
            <input
              aria-label="CVC"
              autoComplete="off"
              placeholder="CVC"
              value={cvc}
              onChange={(e) => setCvc(e.target.value)}
            />
          </div>
        </fieldset>
      ) : null}

      <div className="summary">
        <span>{selected.name}</span>
        <span>{formatPrice(selected.priceCents, selected.currency)}</span>
      </div>

      <SubmitButton
        stripeReady={stripeReady}
        demo={demo}
        price={formatPrice(selected.priceCents, selected.currency)}
      />

      <p className="hint" style={{ marginTop: 12 }}>
        {demo
          ? 'Approved on the spot. The order is recorded as a real sale and marked `demo` so it can never be counted as revenue.'
          : stripeReady
            ? 'You will be taken to Stripe to pay. Card details never touch this site.'
            : 'No payment is taken. Your registration is written exactly as a paid one would be.'}
      </p>

      {demo ? (
        <DemoPanel
          title="Buy a ticket"
          note="Click any value to copy it, or fill the whole form at once."
          rows={[
            { label: 'Name', value: DEMO_BUYER.name },
            { label: 'Email', value: DEMO_BUYER.email },
            { label: 'Card', value: DEMO_BUYER.card, mono: true },
            { label: 'Expiry', value: DEMO_BUYER.expiry, mono: true },
            { label: 'CVC', value: DEMO_BUYER.cvc, mono: true },
          ]}
          onFill={() => {
            setName(DEMO_BUYER.name);
            setEmail(DEMO_BUYER.email);
            setCard(DEMO_BUYER.card);
            setExpiry(DEMO_BUYER.expiry);
            setCvc(DEMO_BUYER.cvc);
          }}
        />
      ) : null}
    </form>
  );
}

/**
 * Split out because `useFormStatus` only reports the status of the form it is
 * rendered *inside*; called from the same component as `<form>` it always
 * returns `pending: false`. The redirect to Stripe takes a moment, and a
 * button that does not visibly change is a button people click twice.
 */
function SubmitButton({
  stripeReady,
  demo,
  price,
}: {
  stripeReady: boolean;
  demo: boolean;
  price: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
      {pending
        ? 'Approving…'
        : demo
          ? `Pay ${price}`
          : stripeReady
            ? `Pay ${price} with Stripe`
            : 'Register — no payment taken'}
    </button>
  );
}
