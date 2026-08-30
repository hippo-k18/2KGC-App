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
 * The purchase step: an order summary and the form that pays for it.
 *
 * ── What this collects, and what it refuses to ──────────────────────────────
 *
 * A name, an email and a tier id — nothing else, and in particular no price and
 * no card details. The price is looked up server-side from the tier id (see
 * `actions.ts`), and card details are collected by Stripe on their own domain.
 *
 * The email matters more than it looks: it is the join key. `registrationId` is
 * derived from it, and the attendee later signs into the mobile app with the
 * same address to claim the ticket. That is why the label says so.
 *
 * ── Why the summary lives in here rather than beside it on the page ─────────
 *
 * What used to sit next to this form was an essay: a four-step explainer and a
 * five-question FAQ, several hundred words of static prose competing with the
 * one thing on the page that takes money. Both of those are useful and neither
 * belongs at the moment of paying, so they moved — the steps to a strip above
 * this section, the questions to a band below it.
 *
 * What replaces them has to be the *order*, and an order summary cannot be a
 * server component: it changes when the buyer changes the tier picker, which is
 * a `useState` in this file. So the summary is a sibling of the `<form>` inside
 * one client component, and `page.tsx` drops the pair in as a unit.
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
    <div className="buy-layout">
      <OrderRail tier={selected} />

      <form action={action} className="checkout">
        <h2 className="checkout-title">Register</h2>

        {state.error && (
          <p className="notice bad" role="alert">
            {state.error}
          </p>
        )}

        {demo ? (
          <p className="notice warn">
            <strong>Demo.</strong> The card box below is for show — it is never submitted and no
            card is charged. Everything after the button is real: the registration, the order, the
            claim code, and the sale appearing on the organizer dashboard.
          </p>
        ) : !stripeReady ? (
          <p className="notice warn">
            <strong>Test mode.</strong> No payment processor is configured on this deployment, so
            the button below completes the registration without taking any money. Nothing is
            charged and no card details are collected.
          </p>
        ) : null}

        {/*
          The tier picker.

          A native `<select>` until now, which is the wrong control for this
          decision: four options, each carrying a price, chosen once and worth
          getting right. A radio group shows all four prices at once without
          opening anything, gives a sold-out tier somewhere to say so, and makes
          the "Choose All Access" links on the panels above land on something
          visibly selected rather than on a collapsed menu.

          Still one `name="tier"` posting one id, so `actions.ts` is unchanged
          and the server is still the only thing that turns that id into money.
        */}
        <fieldset className="tier-choice">
          <legend>Ticket</legend>
          {tiers.map((t) => (
            <label
              key={t.id}
              className={`tier-option${t.id === tier ? ' is-selected' : ''}${
                t.onSale ? '' : ' is-unavailable'
              }`}
            >
              <input
                type="radio"
                name="tier"
                value={t.id}
                checked={t.id === tier}
                disabled={!t.onSale}
                onChange={() => setTier(t.id)}
              />
              <span className="tier-option-name">{t.name}</span>
              <span className="tier-option-price">
                {t.onSale ? formatPrice(t.priceCents, t.currency) : (t.unavailableReason ?? 'Unavailable')}
              </span>
            </label>
          ))}
        </fieldset>

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
            Use the address the attendee will sign into the KGC app with — that is how the ticket
            finds them. You can add alternates later.
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

        {/*
          The credentials, directly under the card box they fill.

          They used to render in a panel fixed to the bottom of the viewport,
          which covered the pay button and stayed on screen for pages that had
          nothing to do with it. In the flow, beside the fields, it is a caption
          rather than an overlay.
        */}
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
      </form>
    </div>
  );
}

/**
 * What is being bought, restated beside the form that buys it.
 *
 * It updates with the tier picker, which is the reason it is here and not on
 * the server: a summary that disagrees with the radio button two inches to its
 * right is worse than no summary. Everything in it is derived from the tier —
 * there is no second source of truth for a price on this page, and the figure
 * shown is still not the figure charged (`actions.ts` re-reads it from
 * Firestore by id).
 */
function OrderRail({ tier }: { tier: Tier }) {
  return (
    <aside className="order-rail" aria-label="Your order">
      <div className="rail-card">
        <p className="rail-eyebrow">Your order</p>
        <h2 className="rail-tier">{tier.name}</h2>
        {tier.tagline ? <p className="rail-tagline">{tier.tagline}</p> : null}

        {tier.includes.length > 0 && (
          <>
            <p className="rail-heading">What it covers</p>
            <ul className="rail-list">
              {tier.includes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}

        <div className="rail-total">
          <span>Total</span>
          <span className="rail-amount">{formatPrice(tier.priceCents, tier.currency)}</span>
        </div>
        <p className="rail-note">
          One ticket, in {tier.currency.toUpperCase()}. Sales tax, where it applies, is added at
          payment.
        </p>
      </div>

      {/*
        Three lines, and only three.

        Each answers a question that otherwise stops a purchase dead: where the
        card number goes, whether the name can change, and whether a company that
        cannot pay by card has any route at all. The invoice link in particular
        used to be the last paragraph of a long FAQ — a company that cannot find
        it does not email to ask, it quietly does not come, which is the
        expensive failure this whole flow exists to prevent.
      */}
      <ul className="rail-trust">
        <li>
          <span className="rail-lock" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor" />
              <path
                d="M5.4 7V5.1a2.6 2.6 0 0 1 5.2 0V7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
          Card details are handled by Stripe and never touch this site.
        </li>
        <li>Names can be changed up to a week before the conference.</li>
        <li>
          Need a PO number? <a href="/tickets/invoice">Pay by invoice instead</a>.
        </li>
      </ul>
    </aside>
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
