'use client';

import { useActionState } from 'react';
import { Field, FormActions, FormBanner, SubmitButton } from '../../../form';
import { adjustSoldCountAction, type TicketState } from './actions';

/**
 * The one control in the product that rewrites what has already been sold.
 *
 * ── Why it exists ───────────────────────────────────────────────────────────
 *
 * `quantitySold` only ever goes up: it is incremented at fulfilment and never
 * decremented on refund. So a capped tier's usable inventory shrinks
 * permanently with every refund, and the workaround an organizer would
 * otherwise reach for — raising the cap — makes every "12 / 16 sold" readout on
 * the dashboard wrong instead.
 *
 * ── The ledger's figure is offered, not imposed ─────────────────────────────
 *
 * The box is prefilled with the count recomputed from `orders`, which is the
 * number this almost always wants to be. It is prefilled rather than applied,
 * because the ledger does not know about a seat sold outside this system, and
 * an organizer who has one should be able to say so. `npm run reconcile:sold`
 * is the same arithmetic across the whole catalogue for when the drift is not
 * about one tier.
 *
 * A `<details>` rather than a modal or a bare field, for the reason
 * `ConfirmButton` documents: a disclosure cannot be dismissed by a stray click,
 * so a half-typed correction does not silently vanish. It is not
 * `ConfirmButton` itself because this needs to report back what it did — the
 * new count against the cap is the whole point — and that needs
 * `useActionState`, which `ConfirmButton`'s plain `<form action>` has not got.
 */
export function SoldCountForm({
  id,
  name,
  stored,
  ledger,
}: {
  id: string;
  name: string;
  /** What the tier document currently claims. */
  stored: number;
  /** What the `orders` ledger says, through the shared fold. */
  ledger: number;
}) {
  const [state, action] = useActionState<TicketState, FormData>(adjustSoldCountAction, {});
  const drift = ledger - stored;

  return (
    <details style={{ marginTop: 16 }}>
      <summary className="linkish" style={{ cursor: 'pointer' }}>
        Correct the sold count
        {drift !== 0 ? ` — the ledger says ${ledger}, not ${stored}` : ''}
      </summary>

      <form
        action={action}
        style={{
          background: 'var(--surface-alt)',
          border: '1px solid var(--hairline)',
          borderRadius: 4,
          marginTop: 8,
          maxWidth: 560,
          padding: 16,
        }}
      >
        <input type="hidden" name="id" value={id} />

        <FormBanner state={state} />

        <p style={{ fontSize: 12, lineHeight: 1.6, marginTop: 0 }}>
          <strong>{name}</strong> records <strong>{stored}</strong> sold.{' '}
          {drift === 0 ? (
            <>The orders ledger agrees, so there is probably nothing to correct here.</>
          ) : (
            <>
              Counting paid and partially-refunded orders gives <strong>{ledger}</strong> —{' '}
              {drift < 0 ? (
                <>
                  {-drift} {-drift === 1 ? 'seat is' : 'seats are'} held by refunds that were never
                  given back to the tier.
                </>
              ) : (
                <>
                  {drift} {drift === 1 ? 'seat was' : 'seats were'} sold without the counter moving —
                  an increment that failed and was logged rather than retried.
                </>
              )}
            </>
          )}
        </p>

        <Field
          name="sold"
          label="Sold"
          type="number"
          min={0}
          defaultValue={ledger}
          width="sm"
          required
          hint="Prefilled from the orders ledger. Change it only if seats were sold outside this system."
        />

        <Field
          name="reason"
          label="Why"
          required
          maxLength={200}
          width="lg"
          placeholder="Six refunds from the cancelled workshop day"
          hint="Recorded in the audit log with your name. It is the only record this correction happened."
        />

        <FormActions>
          <SubmitButton variant="danger" small pendingLabel="Correcting…">
            Correct the count
          </SubmitButton>
        </FormActions>
      </form>
    </details>
  );
}
