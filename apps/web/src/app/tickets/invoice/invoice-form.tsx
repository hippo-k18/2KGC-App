'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { postalCodeRequired, regionRequired } from '@/lib/invoice-core';
import { SITE } from '@/lib/site';
import { formatPrice, type Tier } from '@/lib/tickets';
import { MAX_EMAIL, MAX_NAME } from '../seats-core';
import { requestInvoice, type InvoiceState } from './actions';
import s from './invoice.module.css';

/**
 * The corporate invoice request form.
 *
 * Shaped around how a company actually buys: **one person fills this in for
 * other people.** The billing contact is usually not an attendee — an office
 * manager, or finance — so "who is coming" and "who pays" are separate
 * sections rather than one form with an assumption baked in.
 *
 * No prices are posted. Each seat posts a tier id and the server prices it, the
 * same rule Checkout follows. The running total shown here is a courtesy, and
 * the invoice Stripe raises is the authority — which is also why the form
 * redirects to Stripe's hosted invoice page rather than printing a total of its
 * own that could disagree with it.
 */

interface Seat {
  key: number;
  name: string;
  email: string;
  tierId: string;
}

const MAX_SEATS = 10;

export function InvoiceForm({
  tiers,
  countries,
  termsPublished = false,
}: {
  tiers: Tier[];
  /**
   * The country picker, named on the server. Built here instead, the names came
   * from two different ICU builds (Node's and the browser's), which disagree on
   * a few, and the mismatch failed hydration.
   */
  countries: { code: string; name: string }[];
  /** Show the consent line naming the terms. Off until they are approved; see `lib/terms-core.ts`. */
  termsPublished?: boolean;
}) {
  const [state, action] = useActionState<InvoiceState, FormData>(requestInvoice, {});

  const sellable = tiers.filter((t) => t.onSale);
  const defaultTier = sellable[0]?.id ?? tiers[0]?.id ?? '';

  // Controlled, because React resets an uncontrolled form once its action
  // settles — and re-typing eight colleagues' names after one validation error
  // is the point at which somebody emails us instead.
  const [seats, setSeats] = useState<Seat[]>([{ key: 1, name: '', email: '', tierId: defaultTier }]);
  const [nextKey, setNextKey] = useState(2);
  // The payer's fields too, for the same reason. The seats were controlled and
  // these were not, so one mistake cleared the company name and billing email.
  const [payer, setPayer] = useState({
    company: '',
    billingEmail: '',
    country: 'US',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    po: '',
    netDays: '30',
    note: '',
  });
  const bind = (field: keyof typeof payer) => ({
    value: payer[field],
    onChange: (e: { target: { value: string } }) => setPayer((p) => ({ ...p, [field]: e.target.value })),
  });

  const priceOf = (id: string) => tiers.find((t) => t.id === id)?.priceCents ?? 0;
  const subtotal = seats.reduce((sum, s) => sum + priceOf(s.tierId), 0);
  const currency = tiers.find((t) => t.id === seats[0]?.tierId)?.currency ?? 'usd';

  function update(key: number, patch: Partial<Seat>) {
    setSeats((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  // Shown in the review list, so the buyer can check each seat before sending.
  const tierOf = (id: string) => tiers.find((t) => t.id === id);

  return (
    <form action={action} className={s.layout} id="invoice">
      <div className={s.main}>
        {state.error && (
          <p className="notice bad" role="alert" style={{ overflowWrap: 'anywhere' }}>
            {state.contact ? <WithContactLink text={state.error} /> : state.error}
          </p>
        )}

        <section className={s.section} aria-labelledby="sec-company">
          <h2 id="sec-company" className={s.sectionTitle}>
            <span className={s.step} aria-hidden="true">1</span>
            Company and billing contact
          </h2>

          <div className={s.grid2}>
            <div className="field">
              <label htmlFor="company">Company name</label>
              <input
                id="company"
                name="company"
                required
                maxLength={MAX_NAME}
                placeholder="Acme Corporation"
                {...bind('company')}
              />
              <p className="hint">Exactly as it should appear on the invoice.</p>
            </div>

            <div className="field">
              <label htmlFor="billingEmail">Billing email</label>
              <input
                id="billingEmail"
                name="billingEmail"
                type="email"
                required
                maxLength={MAX_EMAIL}
                placeholder="ap@company.com"
                {...bind('billingEmail')}
              />
              <p className="hint">Where the invoice goes. Often accounts payable, not you.</p>
            </div>
          </div>

          <h3 className={s.subTitle}>Billing address</h3>
          <p className={`hint ${s.subHint}`}>
            Printed on the invoice. Stripe also uses it to work out the tax.
          </p>

          <div className={s.grid2}>
            <div className="field">
              <label htmlFor="country">Country</label>
              <select id="country" name="country" autoComplete="billing country" {...bind('country')}>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={s.spacer} aria-hidden="true" />

            <div className="field">
              <label htmlFor="addressLine1">Street address</label>
              <input
                id="addressLine1"
                name="addressLine1"
                required
                maxLength={200}
                autoComplete="billing address-line1"
                {...bind('addressLine1')}
              />
            </div>

            <div className="field">
              <label htmlFor="addressLine2">Suite, floor or building (optional)</label>
              <input
                id="addressLine2"
                name="addressLine2"
                maxLength={200}
                autoComplete="billing address-line2"
                {...bind('addressLine2')}
              />
            </div>
          </div>

          <div className={s.grid3}>
            <div className="field">
              <label htmlFor="city">City</label>
              <input
                id="city"
                name="city"
                required
                maxLength={200}
                autoComplete="billing address-level2"
                {...bind('city')}
              />
            </div>

            <div className="field">
              <label htmlFor="state">{regionLabel(payer.country)}</label>
              <input
                id="state"
                name="state"
                required={regionRequired(payer.country)}
                maxLength={200}
                autoComplete="billing address-level1"
                {...bind('state')}
              />
            </div>

            <div className="field">
              <label htmlFor="postalCode">
                {payer.country === 'US' ? 'ZIP code' : 'Postal code'}
                {postalCodeRequired(payer.country) ? '' : ' (optional)'}
              </label>
              <input
                id="postalCode"
                name="postalCode"
                required={postalCodeRequired(payer.country)}
                maxLength={12}
                autoComplete="billing postal-code"
                {...bind('postalCode')}
              />
            </div>
          </div>
        </section>

        <section className={s.section} aria-labelledby="sec-terms">
          <h2 id="sec-terms" className={s.sectionTitle}>
            <span className={s.step} aria-hidden="true">2</span>
            PO and payment terms
          </h2>

          <div className={s.grid2}>
            <div className="field">
              <label htmlFor="po">PO number (optional)</label>
              <input id="po" name="po" placeholder="PO-2027-0481" maxLength={30} {...bind('po')} />
              {/*
                Nudged rather than merely offered. A missing PO number is the
                single commonest reason an accounts-payable system rejects an
                invoice, and the rejection arrives weeks later as silence.
              */}
              <p className="hint">Invoices without a PO number are often bounced.</p>
            </div>

            <div className="field">
              <label htmlFor="netDays">Payment terms</label>
              <select id="netDays" name="netDays" {...bind('netDays')}>
                <option value={14}>Net 14 days</option>
                <option value={30}>Net 30 days</option>
                <option value={45}>Net 45 days</option>
                <option value={60}>Net 60 days</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="note">Note on the invoice (optional)</label>
            <input id="note" name="note" placeholder="VAT ID or cost centre" {...bind('note')} />
          </div>
        </section>

        <section className={s.section} aria-labelledby="sec-attendees">
          <div className={s.sectionHead}>
            <h2 id="sec-attendees" className={s.sectionTitle}>
              <span className={s.step} aria-hidden="true">3</span>
              Attendees
            </h2>
            <p className={s.count}>
              {seats.length} of {MAX_SEATS}
            </p>
          </div>
          <p className={`hint ${s.subHint}`}>
            More than ten, or a sponsor allocation? Email{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
          </p>

          <ol className={s.seats}>
            {seats.map((seat, i) => (
              <li key={seat.key} className={s.seat}>
                <div className={s.seatHead}>
                  <h3 className={s.seatTitle}>Attendee {i + 1}</h3>
                  {seats.length > 1 && (
                    <button
                      type="button"
                      className={s.remove}
                      onClick={() => setSeats((prev) => prev.filter((x) => x.key !== seat.key))}
                    >
                      Remove<span className="sr-only"> attendee {i + 1}</span>
                    </button>
                  )}
                </div>

                <div className={s.grid2}>
                  <div className="field">
                    <label htmlFor={`seatName-${seat.key}`}>Full name</label>
                    <input
                      id={`seatName-${seat.key}`}
                      name="seatName"
                      required
                      maxLength={MAX_NAME}
                      placeholder="Ada Nakamura"
                      value={seat.name}
                      onChange={(e) => update(seat.key, { name: e.target.value })}
                    />
                  </div>

                  <div className="field">
                    <label htmlFor={`seatEmail-${seat.key}`}>Email address</label>
                    <input
                      id={`seatEmail-${seat.key}`}
                      name="seatEmail"
                      type="email"
                      required
                      maxLength={MAX_EMAIL}
                      placeholder="ada@company.com"
                      value={seat.email}
                      onChange={(e) => update(seat.key, { email: e.target.value })}
                    />
                    {/*
                      Said here rather than once at the top, because this is the
                      field people get wrong: a shared inbox looks like a
                      reasonable answer until four badges collapse into one
                      registration.
                    */}
                    <p className="hint">Their own address, not a shared inbox.</p>
                  </div>

                  <div className="field">
                    <label htmlFor={`seatTier-${seat.key}`}>Ticket</label>
                    <select
                      id={`seatTier-${seat.key}`}
                      name="seatTier"
                      value={seat.tierId}
                      onChange={(e) => update(seat.key, { tierId: e.target.value })}
                    >
                      {tiers.map((t) => (
                        <option key={t.id} value={t.id} disabled={!t.onSale}>
                          {t.name} · {formatPrice(t.priceCents, t.currency)}
                          {t.onSale ? '' : ` (${t.unavailableReason ?? 'unavailable'})`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {seats.length < MAX_SEATS ? (
            <button
              type="button"
              className={s.addSeat}
              onClick={() => {
                setSeats((prev) => [...prev, { key: nextKey, name: '', email: '', tierId: defaultTier }]);
                setNextKey((k) => k + 1);
              }}
            >
              + Add attendee
            </button>
          ) : null}
        </section>
      </div>

      {/*
        Review and submit. In the form, so the button submits it. On a laptop
        it stays in view beside the sections, so it is kept short enough to fit
        a 900px window; on a phone it is simply the last section.
      */}
      <aside className={s.rail} aria-labelledby="sec-review">
        <div className={s.review}>
          <h2 id="sec-review" className={s.sectionTitle}>
            <span className={s.step} aria-hidden="true">4</span>
            Review and submit
          </h2>

          <ul className={s.lines}>
            {seats.map((seat, i) => {
              const t = tierOf(seat.tierId);
              return (
                <li key={seat.key}>
                  <span className={s.lineWho}>
                    {seat.name.trim() || `Attendee ${i + 1}`}
                    <span className={s.lineTier}>{t?.name ?? 'Ticket'}</span>
                  </span>
                  <span className={s.linePrice}>{formatPrice(priceOf(seat.tierId), t?.currency ?? currency)}</span>
                </li>
              );
            })}
          </ul>

          <div className={`summary ${s.total}`}>
            <span>Subtotal</span>
            <span className={s.totalAmount}>{formatPrice(subtotal, currency)}</span>
          </div>
          <p className={s.taxNote}>
            Stripe adds tax when the invoice is raised, so the final total may differ.
          </p>

          {/*
            The same statement checkout makes, drawn only once the terms are
            published: before then there are no terms to agree to.
          */}
          {termsPublished && (
            <p className={s.consent}>
              By requesting an invoice you agree to the <Link href="/terms">terms</Link> and the{' '}
              <Link href="/code-of-conduct">code of conduct</Link>, and to how your details are
              handled, set out in the <Link href="/privacy">privacy notice</Link>.
            </p>
          )}

          <SubmitButton />

          {/*
            Stated plainly rather than buried, because it is the one thing that
            surprises people, and the surprise otherwise happens at the
            registration desk.
          */}
          <p className={s.issued}>
            <strong>Tickets are issued when the invoice is paid</strong>, not when it&rsquo;s
            raised. If your finance team needs longer than the event allows, email us.
          </p>
        </div>

      </aside>
    </form>
  );
}

function regionLabel(country: string): string {
  if (country === 'US') return 'State';
  if (country === 'CA') return 'Province';
  return 'State or region (optional)';
}

/** The error text with the contact address in it made into a link. */
function WithContactLink({ text }: { text: string }) {
  const at = text.indexOf(SITE.contactEmail);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
      {text.slice(at + SITE.contactEmail.length)}
    </>
  );
}

/**
 * Split out because `useFormStatus` only reports the status of the form it is
 * rendered *inside*. Raising an invoice makes several Stripe calls in sequence
 * and is visibly slower than checkout, so an unchanged button is a button
 * somebody clicks again — and a second click is a second invoice.
 */
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
      {pending ? 'Raising the invoice…' : 'Request invoice'}
    </button>
  );
}
