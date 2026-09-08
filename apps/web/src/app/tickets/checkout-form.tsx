'use client';

import Link from 'next/link';
import { useActionState, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { QuestionFieldDef } from '@kgc/shared';
import { formatPrice, type Tier, type TicketId } from '@/lib/tickets';
import { completeDemoCheckout, startCheckout, type CheckoutState } from './actions';
import { Questions } from './questions';
import { MAX_SEATS } from './seats-core';

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
 * ── Why a quantity brings a form with it ────────────────────────────────────
 *
 * Because a registration is keyed by email address. Three seats on one address
 * are one registration and one badge, so "3" on its own would take three
 * payments and issue one ticket — which is why this used to be one seat per
 * purchase and why the fix is not a number input on its own.
 *
 * Choosing a quantity therefore reveals a name and an address per extra seat,
 * in the same three fields — `seatName`, `seatEmail`, `seatTier` — that
 * `/tickets/invoice` has always posted, read by the same parser. Each extra
 * seat keeps its own ticket picker, so a booth plus two extra passes is one
 * purchase rather than three; seats sharing a tier become one Stripe line item
 * with a real quantity.
 *
 * ⚠️ **The registration questions are asked once, of the buyer.** They are
 * stored on the buyer's registration and nowhere else; the other seats'
 * dietary and accessibility answers are collected by the organizer afterwards.
 * Asking three people three sets of questions on this form is a real
 * improvement and a separate one.
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
/**
 * One extra attendee on the buyer's card. `key` is React's, not the server's —
 * nothing is posted under it.
 */
interface ExtraSeat {
  key: number;
  name: string;
  email: string;
  tierId: TicketId;
}

export function CheckoutForm({
  tiers,
  initialTier,
  stripeReady,
  demoReady = false,
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
  /**
   * Whether `STRIPE_SECRET_KEY` is set on the server, passed down because
   * `stripeEnabled()` is `server-only` and this component runs in the browser.
   *
   * False means the site cannot sell: `startCheckout` refuses before it reads a
   * tier. The form says so up front and disables its own button rather than
   * letting somebody fill four fields to earn an error.
   */
  stripeReady: boolean;
  /**
   * Whether this request may skip payment — true only on a localhost dev
   * server, decided server-side by `demoCheckoutAllowed()` and passed down
   * because that function reads request headers and this runs in the browser.
   *
   * ⚠️ Not a security boundary. `completeDemoCheckout` re-checks it on the
   * server, because a prop is a thing the browser can lie about; this only
   * decides whether the button is drawn.
   */
  demoReady?: boolean;
  /**
   * The organizer's registration questions, or none.
   *
   * Passed as props like the tiers, and for the same reason: this is a client
   * component with no Admin SDK, and it must not gain one.
   */
  questions?: QuestionFieldDef[];
}) {
  const [state, action] = useActionState<CheckoutState, FormData>(startCheckout, {});
  /**
   * The rehearsal button gets its own state because it is a second action on
   * the same form. `shown` picks whichever one last had something to say —
   * only one of them can be running, so the newer error is always the relevant
   * one, and the alternative was two error banners stacked on one form.
   */
  const [demoState, demoAction] = useActionState<CheckoutState, FormData>(
    completeDemoCheckout,
    {},
  );
  const shown: CheckoutState = demoState.error || demoState.fieldErrors ? demoState : state;
  const [tier, setTier] = useState<TicketId>(initialTier);
  // Controlled, not merely `defaultValue`: React resets an uncontrolled form
  // once its action settles, so a failed payment would blank the fields the
  // buyer just typed and make them do it again — at the exact moment they are
  // least inclined to.
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  /**
   * The extra seats, seat two onward. Seat one is the buyer, whose name and
   * address are the two fields above — kept out of this list because moving
   * them into it would rename the inputs the questions, the Stripe customer
   * record and every existing test all read.
   *
   * Controlled for the same reason the buyer's fields are: React resets an
   * uncontrolled form once its action settles, and re-typing three colleagues'
   * addresses after one validation error is the point at which somebody gives
   * up and emails us instead.
   */
  const [extras, setExtras] = useState<ExtraSeat[]>([]);
  /**
   * A key source, not a count. React needs a stable key per row, and the array
   * index is not one — lowering the quantity from four to two and raising it
   * again would reuse keys 2 and 3 for different rows and carry the old typing
   * into them. A ref rather than state because changing it must not re-render.
   */
  const nextKey = useRef(1);
  /*
   * ── There is no card box here, deliberately ────────────────────────────────
   *
   * Card number, expiry and CVC inputs used to sit between the questions and
   * the total. They were survivors of demo mode, kept at the owner's request,
   * and they collected nothing: no `name` attribute, so the browser never
   * serialised them into the FormData the server action receives, and nothing
   * read the state they were bound to. Removed on 2026-08-31 at the owner's
   * request.
   *
   * They were worse than decorative. A form that asks for a card number and
   * then hands the buyer to `checkout.stripe.com` to type it again reads as
   * either a bug or a phishing page, and a field that looks like it takes a PAN
   * is a field somebody eventually wires up — which is how a card number ends
   * up in a server log.
   *
   * The real card entry is hosted Stripe Checkout, after the button.
   * BUILD-PLAN 1.6 / D-2 is what would put card entry back on this page for
   * real: a Stripe Payment Element bound to a PaymentIntent, which needs a
   * publishable key this repo does not have. Anything short of that belongs
   * nowhere near this form.
   */
  // `?? tiers[0]` rather than a non-null assertion: the preselected id comes
  // from a query string, and a tier hidden in the dashboard between page load
  // and this render would otherwise crash the whole form.
  const selected = tiers.find((t) => t.id === tier) ?? tiers[0];

  /**
   * The running total, which is a courtesy and not the charge.
   *
   * `startCheckout` re-reads every price from Firestore by id and Stripe adds
   * tax and any promotion code on its own page, so this figure can be right and
   * still not be what lands on the card. It exists because a quantity control
   * with no total beside it is a control people are afraid to touch.
   */
  const priceOf = (id: TicketId) => tiers.find((t) => t.id === id)?.priceCents ?? 0;
  const quantity = extras.length + 1;
  const totalCents = priceOf(tier) + extras.reduce((sum, e) => sum + priceOf(e.tierId), 0);

  /**
   * Growing and shrinking the seat list from one number.
   *
   * Shrinking truncates rather than clearing, so a buyer who overshoots to five
   * and comes back to three keeps the three they had already typed. Growing
   * defaults each new seat to the tier the buyer chose, which is what "three of
   * these, please" means — and the per-seat picker is there for the case where
   * it is not.
   */
  function setQuantity(next: number) {
    const wanted = Math.max(1, Math.min(MAX_SEATS, next)) - 1;
    setExtras((prev) => {
      if (wanted <= prev.length) return prev.slice(0, wanted);
      const grown = [...prev];
      while (grown.length < wanted) {
        nextKey.current += 1;
        grown.push({ key: nextKey.current, name: '', email: '', tierId: tier });
      }
      return grown;
    });
  }

  const updateExtra = (key: number, patch: Partial<ExtraSeat>) =>
    setExtras((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  return (
    <div className="buy-layout">
      <OrderRail tier={selected} quantity={quantity} totalCents={totalCents} />

      <form action={action} className="checkout">
        <h2 className="checkout-title">Register</h2>

        {shown.error && (
          <p className="notice bad" role="alert">
            {shown.error}
          </p>
        )}

        {/*
          Fail closed, and say which variable. This is the same refusal
          `startCheckout` returns if the form is posted anyway — stated here so
          it is read before the typing rather than after it.
        */}
        {!stripeReady ? (
          <p className="notice bad" role="alert">
            <strong>Ticket sales are not configured on this deployment.</strong>{' '}
            <code>STRIPE_SECRET_KEY</code> is not set, so no payment can be taken and no ticket can
            be issued. Nothing below will complete a purchase.
          </p>
        ) : null}

        {/*
          How many, and then who — in that order.

          This dropdown used to sit *below* the buyer's own name and email and
          above the extra seats, which put the one control that changes the
          form's length in the middle of the list it changes. Seat one was two
          loose fields above the dropdown, seats two onward were bordered cards
          below it, and nothing on the page said the first pair of fields was a
          seat at all — so buying three tickets read as a rendering fault.

          A `<select>` rather than a number input because the range is one to
          ten and every value has a consequence on the page below it — a spinner
          invites typing "25" and earning an error, and a free-text number is a
          field that arrives as "3 " or "three".
        */}
        <div className="field">
          <label htmlFor="quantity">How many tickets?</label>
          <select
            id="quantity"
            // No `name`: this is not posted. The seat rows below are the data,
            // and a quantity that could disagree with the number of rows is a
            // quantity the server would have to arbitrate.
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          >
            {Array.from({ length: MAX_SEATS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? '1 ticket' : `${n} tickets`}
              </option>
            ))}
          </select>
        </div>

        {/*
          Every seat in one list, the buyer's own included.

          `SeatCard` draws the box and the "Attendee n" heading only when there
          is more than one seat, so a single buyer sees exactly the fields they
          always saw and a buyer of three sees three identical cards rather than
          one loose pair of fields and two boxes below a dropdown.
        */}
        <div className="seats">
          <SeatCard label={quantity > 1 ? 'Attendee 1 · you' : null}>
            {/*
              The tier picker, which is seat one's ticket and only seat one's.

              A radio group rather than the `<select>` it used to be: four
              options, each carrying a price, chosen once and worth getting
              right. All four figures are visible without opening anything, a
              sold-out tier has somewhere to say so, and the "Choose All Access"
              links on the panels above land on something visibly selected
              rather than on a collapsed menu.

              Inside seat one's card because that is whose ticket it is. Still
              one `name="tier"` posting one id — extra seats post their own
              `seatTier`, and the server is still the only thing that turns any
              of those ids into money.
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
                    {t.onSale
                      ? formatPrice(t.priceCents, t.currency)
                      : (t.unavailableReason ?? 'Unavailable')}
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
              <p className="hint">Printed on the badge.</p>
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
                The address they will sign into the KGC app with. Alternates can be added later.
              </p>
            </div>
          </SeatCard>

          {/*
            One card per extra attendee, in the same shape as `/tickets/invoice`.

            Deliberately identical, down to the field names, because the two
            forms post to the same parser. A second layout for the same three
            fields is a second thing to keep in step with the first.
          */}
          {extras.map((seat, i) => (
            <SeatCard key={seat.key} label={`Attendee ${i + 2}`}>
              {/*
                Ticket first, then who — the same order as seat one's card
                above, which leads with the tier picker. A card that asked for a
                name, an address and *then* the ticket beside a card that asked
                for the ticket first read as two different forms stacked.

                Per seat rather than one tier for the whole purchase, because the
                mixed cart is the case that used to need three separate
                checkouts: a booth and two extra passes, or a colleague on the
                cheaper ticket.
              */}
              <div className="field">
                <label htmlFor={`seatTier-${seat.key}`}>Ticket</label>
                <select
                  id={`seatTier-${seat.key}`}
                  name="seatTier"
                  value={seat.tierId}
                  onChange={(e) => updateExtra(seat.key, { tierId: e.target.value })}
                >
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id} disabled={!t.onSale}>
                      {t.name} · {formatPrice(t.priceCents, t.currency)}
                      {t.onSale ? '' : ` (${t.unavailableReason ?? 'unavailable'})`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor={`seatName-${seat.key}`}>Full name</label>
                <input
                  id={`seatName-${seat.key}`}
                  name="seatName"
                  required
                  placeholder="Ada Nakamura"
                  value={seat.name}
                  onChange={(e) => updateExtra(seat.key, { name: e.target.value })}
                />
              </div>

              <div className="field">
                <label htmlFor={`seatEmail-${seat.key}`}>Email address</label>
                <input
                  id={`seatEmail-${seat.key}`}
                  name="seatEmail"
                  type="email"
                  required
                  placeholder="ada@company.com"
                  value={seat.email}
                  onChange={(e) => updateExtra(seat.key, { email: e.target.value })}
                />
                {/*
                  Said on the field people get wrong: a shared inbox looks like a
                  reasonable answer right up until three badges collapse into one
                  registration.
                */}
                <p className="hint">Their own address, not a shared inbox.</p>
              </div>
            </SeatCard>
          ))}
        </div>

        {/*
          The organizer's questions, between the buyer's details and the total.
          Above the price rather than below it, because a question appearing after
          somebody has read the amount reads as a hurdle placed in front of paying.
        */}
        <Questions fields={questions} ticketTypeId={tier} errors={shown.fieldErrors} />

        <div className="summary">
          <span>
            {quantity === 1 ? selected.name : `${quantity} tickets`}
          </span>
          <span>{formatPrice(totalCents, selected.currency)}</span>
        </div>

        <SubmitButton stripeReady={stripeReady} price={formatPrice(totalCents, selected.currency)} />

        {/*
          The rehearsal button, drawn only on a localhost dev server.

          Inside the same `<form>` and posting through `formAction`, so it sends
          the *identical* fields the pay button sends — every seat, every
          question, the tier. A separate form would have been a second thing to
          keep in step with this one, and the first demo after they diverged
          would be the one that fails.
        */}
        {demoReady && (
          <DemoButton action={demoAction} price={formatPrice(totalCents, selected.currency)} />
        )}

        <p className="hint" style={{ marginTop: 12 }}>
          {stripeReady
            ? 'You pay on Stripe. Card details never touch this site.'
            : 'No ticket can be bought until a payment processor is configured.'}
        </p>
      </form>
    </div>
  );
}

/**
 * One seat's fields, boxed and numbered — but only when there is more than one.
 *
 * The box is what makes a three-ticket purchase read as three tickets. Without
 * it the buyer's own name and email were bare fields and every other attendee
 * was a bordered card, so the form looked like one thing followed by a list of
 * a different thing.
 *
 * `label === null` renders the children with no wrapper at all rather than an
 * unstyled `<div>`: a single buyer should see the form exactly as it has always
 * looked, and a border drawn around one lone pair of fields is chrome that
 * explains nothing. Toggling the label remounts the children, which is safe —
 * every value in here is controlled state held above this component, and the
 * only control that can change the quantity is the dropdown, not a field
 * somebody is mid-way through typing into.
 */
function SeatCard({ label, children }: { label: string | null; children: ReactNode }) {
  if (label === null) return <>{children}</>;
  return (
    <section className="seat-card">
      <h3 className="seat-card-title">{label}</h3>
      {children}
    </section>
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
function OrderRail({
  tier,
  quantity,
  totalCents,
}: {
  tier: Tier;
  /** Seats on this purchase, the buyer included. */
  quantity: number;
  /**
   * The whole cart, not `tier.priceCents × quantity` — extra seats can be on
   * different tiers, and a rail that multiplied one price would quietly
   * disagree with the button two inches below it.
   */
  totalCents: number;
}) {
  return (
    <aside className="order-rail" aria-label="Your order">
      <div className="rail-card">
        <p className="rail-eyebrow">Your order</p>
        <h2 className="rail-tier">{tier.name}</h2>
        {tier.tagline ? <p className="rail-tagline">{tier.tagline}</p> : null}
        {quantity > 1 ? (
          /*
            Named rather than implied. The rail describes the buyer's own tier —
            what it covers, what it costs — and on a mixed cart that is one seat
            out of several. Saying so is cheaper than a rail that silently
            describes a third of the purchase.
          */
          <p className="rail-tagline">
            Plus {quantity - 1} more {quantity - 1 === 1 ? 'attendee' : 'attendees'} on this
            purchase. Each seat&rsquo;s own ticket is chosen in the form.
          </p>
        ) : null}

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
          <span className="rail-amount">{formatPrice(totalCents, tier.currency)}</span>
        </div>
        <p className="rail-note">
          {quantity === 1 ? 'One ticket' : `${quantity} tickets`}, in{' '}
          {tier.currency.toUpperCase()}. Sales tax, where it applies, is added at payment.
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
          Need a PO number? <Link href="/tickets/invoice">Pay by invoice instead</Link>.
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
/**
 * Skip the payment and issue the ticket anyway — localhost only.
 *
 * Deliberately styled as a secondary button and labelled with what it actually
 * does. A demo affordance that looks like the primary action is one somebody
 * clicks by mistake while presenting, and "Skip payment" is the only honest
 * name for it.
 *
 * `formAction` rather than its own form: it posts the fields the pay button
 * posts. `useFormStatus` reads the enclosing form's pending state, so this
 * disables while the Stripe button is mid-redirect too — which is correct, as
 * both are one purchase and neither should be startable twice.
 */
function DemoButton({
  action,
  price,
}: {
  action: (formData: FormData) => void;
  price: string;
}) {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit"
        formAction={action}
        className="btn btn-secondary btn-block"
        style={{ marginTop: 10 }}
        disabled={pending}
      >
        {pending ? 'Working…' : `Skip payment and register (demo)`}
      </button>
      <p className="hint" style={{ marginTop: 8 }}>
        Localhost only. Issues a real ticket for {price} without charging: registration, order,
        app account, entitlements, sold count and confirmation email, exactly as a paid purchase
        does. The order is marked <code>demo</code>, so{' '}
        <code>scripts/ops/reset-demo-sales.mjs</code> undoes it.
      </p>
    </>
  );
}

function SubmitButton({ stripeReady, price }: { stripeReady: boolean; price: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn-primary btn-block"
      // Disabled rather than hidden: the button is the thing that explains what
      // the page is for, and a checkout with no pay button reads as a broken
      // render rather than as an unconfigured deployment.
      disabled={pending || !stripeReady}
    >
      {pending ? 'Redirecting…' : stripeReady ? `Pay ${price} with Stripe` : 'Payments unavailable'}
    </button>
  );
}
