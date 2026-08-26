'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { ManualOrderState } from './manual-order-actions';
import { recordManualOrderAction } from './manual-order-actions';

/**
 * Recording a payment Stripe never saw.
 *
 * Shared by 2.6 Offline Payment and Pre-paid Exhibitors, which are the same
 * write with a different reason attached — a cheque versus a contract signed
 * before the ticketing existed. The screens differ in what they explain; the
 * form does not.
 *
 * ── The amount is not defaulted to the list price ───────────────────────────
 *
 * It is prefilled from the selected package, and it is prefilled rather than
 * fixed because the reason this path exists is that the figure is usually
 * *not* list — a negotiated sponsorship, a partner rate, a comp at zero. A
 * read-only amount would push the organizer straight back to the spreadsheet
 * this screen is trying to replace.
 *
 * ── The note is required, and that is the point ─────────────────────────────
 *
 * This issues a ticket against money the system cannot verify. The note is the
 * only evidence that the money is real, so an empty one is refused server-side
 * as well as here.
 */
export function ManualOrderForm({
  packages,
  audienceNoun,
  notePlaceholder,
  compHint,
}: {
  packages: { id: string; name: string; priceCents: number; currency: string }[];
  /** "exhibitor", "sponsor", "attendee" — for the labels. */
  audienceNoun: string;
  notePlaceholder: string;
  compHint: string;
}) {
  const [state, action] = useActionState<ManualOrderState, FormData>(recordManualOrderAction, {});

  if (packages.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        No {audienceNoun} package exists to record a payment against. Price one first — an order
        pointing at no ticket type cannot produce a badge.
      </p>
    );
  }

  return (
    <form action={action}>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="ok">
          {state.message}
          {state.claimCode ? (
            <>
              {' '}
              Claim code <code>{state.claimCode}</code>.
            </>
          ) : null}
        </p>
      )}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="ticketTypeId">
          Package
        </label>
        <select
          id="ticketTypeId"
          name="ticketTypeId"
          required
          style={{ maxWidth: 340 }}
          onChange={(e) => {
            const amount = e.currentTarget.form?.elements.namedItem('amount');
            const cents = Number(e.currentTarget.selectedOptions[0]?.dataset.cents ?? '0');
            if (amount instanceof HTMLInputElement) amount.value = String(cents / 100);
          }}
        >
          {packages.map((p) => (
            <option key={p.id} value={p.id} data-cents={p.priceCents}>
              {p.name} — {(p.priceCents / 100).toLocaleString('en-US', {
                style: 'currency',
                currency: p.currency.toUpperCase(),
                maximumFractionDigits: 0,
              })}
            </option>
          ))}
        </select>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="name">
          Name
        </label>
        <input id="name" name="name" required maxLength={80} placeholder="Ada Lovelace" />
        <p className="muted" style={{ fontSize: 12 }}>
          Whoever holds the badge, not whoever signed the cheque. This prints at the door.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" required placeholder="ada@example.com" />
        <p className="muted" style={{ fontSize: 12 }}>
          The join key. The registration id is derived from it, and it is the address they sign in
          with — recording the same address twice updates one registration rather than making two.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="companyName">
          Company
        </label>
        <input id="companyName" name="companyName" maxLength={120} placeholder="optional" />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="amount">
          Amount received
        </label>
        <input
          id="amount"
          name="amount"
          required
          inputMode="decimal"
          defaultValue={String(packages[0].priceCents / 100)}
          style={{ maxWidth: 180 }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          In whole currency units, not cents. {compHint}
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="poNumber">
          PO number
        </label>
        <input id="poNumber" name="poNumber" maxLength={60} placeholder="optional" style={{ maxWidth: 240 }} />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="note">
          Why
        </label>
        <input id="note" name="note" required maxLength={200} placeholder={notePlaceholder} />
        <p className="muted" style={{ fontSize: 12 }}>
          Required. This order is paid on your word, and this is the record of what your word was
          based on. It is stored on the order itself, not only in the audit log.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="silent">
          Email
        </label>
        <label style={{ fontSize: 13 }}>
          <input id="silent" type="checkbox" name="silent" /> Do not send a confirmation — they have
          already been told
        </label>
        <p className="muted" style={{ fontSize: 12 }}>
          Leave this off for a live recording. The confirmation carries the claim code, which is how
          they get into the app; skipping it means telling them another way.
        </p>
      </div>

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Recording…' : 'Record payment'}
    </button>
  );
}
