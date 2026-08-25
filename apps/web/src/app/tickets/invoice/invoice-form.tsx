'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { formatPrice, type Tier } from '@/lib/tickets';
import { requestInvoice, type InvoiceState } from './actions';

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

export function InvoiceForm({ tiers }: { tiers: Tier[] }) {
  const [state, action] = useActionState<InvoiceState, FormData>(requestInvoice, {});

  const sellable = tiers.filter((t) => t.onSale);
  const defaultTier = sellable[0]?.id ?? tiers[0]?.id ?? '';

  // Controlled, because React resets an uncontrolled form once its action
  // settles — and re-typing eight colleagues' names after one validation error
  // is the point at which somebody emails us instead.
  const [seats, setSeats] = useState<Seat[]>([{ key: 1, name: '', email: '', tierId: defaultTier }]);
  const [nextKey, setNextKey] = useState(2);

  const priceOf = (id: string) => tiers.find((t) => t.id === id)?.priceCents ?? 0;
  const subtotal = seats.reduce((sum, s) => sum + priceOf(s.tierId), 0);
  const currency = tiers.find((t) => t.id === seats[0]?.tierId)?.currency ?? 'usd';

  function update(key: number, patch: Partial<Seat>) {
    setSeats((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  return (
    <form action={action} className="checkout" id="invoice">
      <h2 style={{ fontSize: '1.4rem' }}>Request an invoice</h2>

      {state.error && (
        <p className="notice bad" role="alert">
          {state.error}
        </p>
      )}

      <p className="hint" style={{ marginTop: 0 }}>
        We&rsquo;ll email a payable invoice to your finance contact, with a PO number on the PDF.
        Tickets are issued when the invoice is paid, not when it&rsquo;s raised.
      </p>

      <h3 style={{ fontSize: '1.05rem', marginTop: 22 }}>Who&rsquo;s coming</h3>

      {seats.map((seat, i) => (
        <div
          key={seat.key}
          style={{
            border: '1px solid rgba(0,0,0,.12)',
            borderRadius: 6,
            padding: '14px 14px 4px',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <strong style={{ fontSize: '.85rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Attendee {i + 1}
            </strong>
            {seats.length > 1 && (
              <button
                type="button"
                onClick={() => setSeats((prev) => prev.filter((s) => s.key !== seat.key))}
                style={{
                  background: 'none',
                  border: 0,
                  cursor: 'pointer',
                  color: '#a33',
                  fontSize: '.85rem',
                  padding: 4,
                }}
              >
                Remove
              </button>
            )}
          </div>

          <div className="field">
            <label htmlFor={`seatName-${seat.key}`}>Full name</label>
            <input
              id={`seatName-${seat.key}`}
              name="seatName"
              required
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
              placeholder="ada@company.com"
              value={seat.email}
              onChange={(e) => update(seat.key, { email: e.target.value })}
            />
            {/*
              Said here rather than once at the top, because this is the field
              people get wrong: a shared inbox looks like a reasonable answer
              until four badges collapse into one registration.
            */}
            <p className="hint">
              Their own address, not a shared inbox — it&rsquo;s how the app finds their ticket.
            </p>
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
                  {t.name} — {formatPrice(t.priceCents, t.currency)}
                  {t.onSale ? '' : ` (${t.unavailableReason ?? 'unavailable'})`}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}

      {seats.length < MAX_SEATS && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setSeats((prev) => [...prev, { key: nextKey, name: '', email: '', tierId: defaultTier }]);
            setNextKey((k) => k + 1);
          }}
          style={{ marginBottom: 20 }}
        >
          + Add another attendee
        </button>
      )}

      <h3 style={{ fontSize: '1.05rem', marginTop: 10 }}>Who pays</h3>

      <div className="field">
        <label htmlFor="company">Company name</label>
        <input id="company" name="company" required placeholder="Acme Corporation" />
        <p className="hint">Exactly as it should appear on the invoice.</p>
      </div>

      <div className="field">
        <label htmlFor="billingEmail">Billing email</label>
        <input
          id="billingEmail"
          name="billingEmail"
          type="email"
          required
          placeholder="accounts-payable@company.com"
        />
        <p className="hint">Where the invoice goes. Often accounts payable, not you.</p>
      </div>

      <div className="field">
        <label htmlFor="po">Purchase order number (optional)</label>
        <input id="po" name="po" placeholder="PO-2027-0481" maxLength={30} />
        {/*
          Nudged rather than merely offered. A missing PO number is the single
          commonest reason an accounts-payable system rejects an invoice, and
          the rejection arrives weeks later as silence.
        */}
        <p className="hint">
          If your finance team issues POs, add it — invoices without one are often bounced.
        </p>
      </div>

      <div className="field">
        <label htmlFor="netDays">Payment terms</label>
        <select id="netDays" name="netDays" defaultValue={30}>
          <option value={14}>Net 14 days</option>
          <option value={30}>Net 30 days</option>
          <option value={45}>Net 45 days</option>
          <option value={60}>Net 60 days</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="note">Note on the invoice (optional)</label>
        <input id="note" name="note" placeholder="VAT ID, cost centre, department…" />
      </div>

      <div className="summary">
        <span>
          {seats.length} {seats.length === 1 ? 'seat' : 'seats'}
        </span>
        <span>{formatPrice(subtotal, currency)}</span>
      </div>

      <SubmitButton />

      <p className="hint" style={{ marginTop: 12 }}>
        Tax is calculated by Stripe when the invoice is raised, so the final total may differ from
        the subtotal above. You&rsquo;ll be taken to the invoice to review it.
      </p>
    </form>
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
