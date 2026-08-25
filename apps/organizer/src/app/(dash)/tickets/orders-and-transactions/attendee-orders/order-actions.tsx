'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  markInvoicePaidAction,
  refundOrderAction,
  type MarkPaidState,
  type RefundState,
} from './actions';

/**
 * The two dangerous buttons on the orders table, and the dialogs that guard
 * them.
 *
 * Both are `<details>` rather than a modal. A modal needs focus trapping, an
 * escape handler and a scroll lock to be usable with a keyboard, and all three
 * are easy to get subtly wrong; a disclosure is native, accessible for free,
 * and — the part that matters here — **cannot be dismissed by clicking
 * somewhere else**, so a half-typed refund confirmation does not silently
 * vanish under a stray click.
 */

export function RefundButton({
  orderId,
  amountLabel,
  email,
  needsPassphrase,
  live,
}: {
  orderId: string;
  amountLabel: string;
  email: string;
  needsPassphrase: boolean;
  live: boolean;
}) {
  const [state, action] = useActionState<RefundState, FormData>(refundOrderAction, {});
  const [typed, setTyped] = useState('');

  if (state.ok) {
    return (
      <span className="ok" style={{ fontSize: 12 }}>
        {state.message}
      </span>
    );
  }

  return (
    <details style={{ display: 'inline-block' }}>
      <summary
        style={{
          color: 'var(--danger, #b3352c)',
          cursor: 'pointer',
          fontSize: 12,
          listStyle: 'none',
        }}
      >
        Refund
      </summary>

      <form
        action={action}
        style={{
          background: 'var(--surface-alt)',
          border: '1px solid var(--hairline)',
          borderRadius: 4,
          marginTop: 8,
          padding: 12,
          width: 320,
        }}
      >
        <input type="hidden" name="orderId" value={orderId} />

        <p style={{ fontSize: 12, lineHeight: 1.5, marginTop: 0 }}>
          {/*
            The consequences are spelled out in full rather than summarised.
            This is the one action in the product that cannot be undone from
            inside the product, and the moment to say so is before the click.
          */}
          Refunding <strong>{amountLabel}</strong> to <strong>{email}</strong> will cancel their
          registration, so their badge stops scanning at the door. They&rsquo;ll be emailed
          automatically. <strong>This cannot be undone from here</strong> — reversing it means
          asking them to buy again at today&rsquo;s price.
        </p>

        {live && (
          <p className="error" style={{ fontSize: 12, fontWeight: 600 }}>
            This is a live Stripe account. Real money will leave it.
          </p>
        )}

        {state.error && (
          <p className="error" style={{ fontSize: 12 }} role="alert">
            {state.error}
          </p>
        )}

        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          Type <code>{amountLabel}</code> to confirm
        </label>
        {/*
          A typed amount rather than a checkbox, deliberately. A checkbox
          becomes muscle memory after the third refund; typing the figure
          requires reading which row you are on, which is the mistake this is
          actually defending against.
        */}
        <input
          name="confirmAmount"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          placeholder={amountLabel}
          style={{ marginBottom: 8, width: '100%' }}
        />

        {needsPassphrase && (
          <>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
              Dashboard passphrase
            </label>
            <input
              name="passphrase"
              type="password"
              autoComplete="off"
              style={{ marginBottom: 8, width: '100%' }}
            />
          </>
        )}

        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          Reason (goes on the audit record)
        </label>
        <input
          name="reason"
          placeholder="Cannot attend, requested 12 Mar"
          style={{ marginBottom: 10, width: '100%' }}
        />

        <SubmitButton label={`Refund ${amountLabel}`} danger />
      </form>
    </details>
  );
}

export function MarkPaidButton({
  orderId,
  amountLabel,
  companyName,
  seatCount,
  needsPassphrase,
}: {
  orderId: string;
  amountLabel: string;
  companyName: string;
  seatCount: number;
  needsPassphrase: boolean;
}) {
  const [state, action] = useActionState<MarkPaidState, FormData>(markInvoicePaidAction, {});

  if (state.ok) {
    return (
      <span className="ok" style={{ fontSize: 12 }}>
        {state.message}
      </span>
    );
  }

  return (
    <details style={{ display: 'inline-block' }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, listStyle: 'none' }}>
        Mark paid
      </summary>

      <form
        action={action}
        style={{
          background: 'var(--surface-alt)',
          border: '1px solid var(--hairline)',
          borderRadius: 4,
          marginTop: 8,
          padding: 12,
          width: 320,
        }}
      >
        <input type="hidden" name="orderId" value={orderId} />

        <p style={{ fontSize: 12, lineHeight: 1.5, marginTop: 0 }}>
          This issues <strong>{seatCount} {seatCount === 1 ? 'ticket' : 'tickets'}</strong> to{' '}
          <strong>{companyName}</strong> and emails every attendee their claim code —{' '}
          <strong>before the {amountLabel} has arrived</strong>. Use it when a purchase order is
          good enough and finance will pay after the event.
        </p>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
          The Stripe invoice stays open, so it keeps showing as outstanding there. Your name is
          recorded on the order.
        </p>

        {state.error && (
          <p className="error" style={{ fontSize: 12 }} role="alert">
            {state.error}
          </p>
        )}

        {needsPassphrase && (
          <>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
              Dashboard passphrase
            </label>
            <input
              name="passphrase"
              type="password"
              autoComplete="off"
              style={{ marginBottom: 8, width: '100%' }}
            />
          </>
        )}

        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          Why — PO number, or who authorised it
        </label>
        <input
          name="note"
          required
          placeholder="PO-2027-0481, approved by Ana"
          style={{ marginBottom: 10, width: '100%' }}
        />

        <SubmitButton label="Issue tickets now" />
      </form>
    </details>
  );
}

/**
 * Split out because `useFormStatus` only reports the status of the form it is
 * rendered inside. A refund makes a network round trip to Stripe and is
 * visibly slow; an unchanged button is a button somebody clicks twice, and the
 * second click on *this* button is a second refund.
 */
function SubmitButton({ label, danger }: { label: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={danger ? 'whova-btn-main danger' : 'whova-btn-main'}
      disabled={pending}
      style={{ width: '100%' }}
    >
      {pending ? 'Working…' : label}
    </button>
  );
}
