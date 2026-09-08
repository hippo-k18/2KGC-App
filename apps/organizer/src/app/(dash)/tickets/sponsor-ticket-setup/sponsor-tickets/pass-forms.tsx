'use client';

import { useActionState, useState } from 'react';
import type { PassGrantingTier } from '@/lib/comp-passes';
import {
  CheckboxField,
  Field,
  FormActions,
  FormBanner,
  FormGrid,
  Select,
  SubmitButton,
  type FormState,
} from '../../../form';
import { issuePassAction, renamePassAction, setPassCountAction } from './actions';

/**
 * The three complimentary-pass forms.
 *
 * They are `'use client'` because each needs its own `useActionState` result
 * banner — an organizer filling four seats one at a time needs to see which
 * one just landed, and a page-level redirect would lose that.
 */

/**
 * How many passes a package includes.
 *
 * A `<select>` over the real catalogue and a number box, rather than a free
 * text field parsed for a digit. The number *is* the entitlement now: what the
 * bullet list says about passes is copy, and this is what mints them.
 */
export function PassCountForm({ tiers }: { tiers: PassGrantingTier[] }) {
  const [state, action] = useActionState<FormState, FormData>(setPassCountAction, {});
  const [selected, setSelected] = useState(tiers[0]?.id ?? '');

  const current = tiers.find((t) => t.id === selected);

  return (
    <form action={action}>
      <FormBanner state={state} />

      <FormGrid>
        <Select
          name="ticketTypeId"
          label="Package"
          width="lg"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          options={tiers.map((t) => ({
            value: t.id,
            label: `${t.name} — ${t.complimentaryPasses || 'no'} ${
              t.complimentaryPasses === 1 ? 'pass' : 'passes'
            }`,
          }))}
        />

        <Field
          name="passes"
          label="Complimentary passes"
          type="number"
          min={0}
          max={100}
          step={1}
          width="sm"
          // Keyed on the selection so the box reloads when the package changes;
          // an uncontrolled input would keep the previous package's number and
          // read as if it applied to the new one.
          key={selected}
          defaultValue={current?.complimentaryPasses ?? 0}
          hint="Per unit sold. Two Gold sponsorships on one order are owed twice this."
        />
      </FormGrid>

      <FormActions>
        <SubmitButton>Save pass count</SubmitButton>
      </FormActions>
    </form>
  );
}

/** Name the next attendee on a sponsorship. */
export function IssuePassForm({
  orderId,
  remaining,
}: {
  orderId: string;
  remaining: number;
}) {
  const [state, action] = useActionState<FormState, FormData>(issuePassAction, {});

  if (remaining === 0) {
    return (
      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
        Every complimentary pass on this sponsorship has been named. Raising the package&rsquo;s
        pass count is the only thing that adds another.
      </p>
    );
  }

  return (
    <form action={action}>
      <FormBanner state={state} />
      <input type="hidden" name="orderId" value={orderId} />

      <FormGrid>
        <Field name="name" label="Attendee name" required width="lg" autoComplete="off" />
        <Field
          name="email"
          label="Email address"
          type="email"
          required
          width="lg"
          autoComplete="off"
          hint="The ticket is keyed to this address, and it cannot be changed afterwards."
        />
      </FormGrid>

      <CheckboxField
        name="notify"
        label="Email them their ticket"
        description="The same confirmation a buyer gets, at zero. It carries the claim code that signs them into the app."
        defaultChecked
      />

      <FormActions>
        <SubmitButton pendingLabel="Issuing…">
          Issue pass ({remaining} left)
        </SubmitButton>
      </FormActions>
    </form>
  );
}

/**
 * Correct the name on a pass already issued.
 *
 * Name only. The address is what the registration is keyed to, so changing it
 * would leave the old registration active and admitted — a spare ticket nobody
 * is tracking. The badge is untouched: `ensureRegistration` leaves `qrSecret`
 * and `claimCode` alone on a registration that already exists.
 */
export function RenamePassForm({
  orderId,
  seat,
  name,
}: {
  orderId: string;
  seat: number;
  name: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(renamePassAction, {});

  return (
    <form action={action} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="seat" value={seat} />
      <Field
        name="name"
        // Every row renders this control, so the id cannot fall back to the
        // field name — four inputs called `name` would share one id and a
        // click on any label would focus the first.
        id={`pass-name-${seat}`}
        aria-label={`Name on seat ${seat}`}
        defaultValue={name}
        required
        width="sm"
        groupStyle={{ marginBottom: 0 }}
        error={state.error}
        hint={state.ok ? state.message : undefined}
      />
      <SubmitButton small variant="secondary">
        Save
      </SubmitButton>
    </form>
  );
}
