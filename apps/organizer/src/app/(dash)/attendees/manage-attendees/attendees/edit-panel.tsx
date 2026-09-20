'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import type { AttendeeCategoryDef } from '@kgc/shared';
import { Field, FormActions, FormBanner, FormGrid, Select, SubmitButton, type FormState } from '../../../form';
import { assignCategoryAction } from '../../categories/actions';
import {
  cancelAttendeeAction,
  changeTicketTypeAction,
  reinstateAttendeeAction,
  resendConfirmationAction,
  transferAttendeeAction,
  updateAttendeeAction,
  type AttendeeEditState,
} from './edit-actions';

/**
 * One attendee, opened from their row.
 *
 * Four things an organizer does to a registration once it exists, each its own
 * form so that saving a name can never also cancel a ticket. They sit in the
 * order they are reached for: a correction most days, a ticket change now and
 * then, a transfer when somebody's colleague comes instead, a cancellation last
 * and behind a disclosure.
 *
 * A changed email and a transfer both land on a new registration, because the
 * id is derived from the address. The panel does not follow it by itself. It
 * reloads on the old one, which now reads "transferred" and links across, so
 * the organizer sees both ends of what they just did. The page keys this
 * component by registration, so following that link starts with no banners.
 */

export interface EditPanelAttendee {
  registrationId: string;
  name: string;
  email: string;
  title: string;
  company: string;
  ticketType: string;
  status: 'active' | 'cancelled' | 'transferred';
  transferredTo?: string;
  hasPaidOrder: boolean;
  categoryId: string;
}

const hidden = (rid: string) => <input type="hidden" name="registrationId" value={rid} />;

const section = { borderTop: '1px solid var(--hairline)', marginTop: 20, paddingTop: 16 };

export function EditPanel({
  attendee: a,
  ticketTypes,
  categories,
  emailReady,
}: {
  attendee: EditPanelAttendee;
  ticketTypes: string[];
  categories: AttendeeCategoryDef[];
  emailReady: boolean;
}) {
  const [saved, save] = useActionState<AttendeeEditState, FormData>(updateAttendeeAction, {});
  const [typed, changeType] = useActionState<AttendeeEditState, FormData>(changeTicketTypeAction, {});
  const [moved, transfer] = useActionState<AttendeeEditState, FormData>(transferAttendeeAction, {});
  const [ended, cancel] = useActionState<AttendeeEditState, FormData>(cancelAttendeeAction, {});
  const [restored, reinstate] = useActionState<AttendeeEditState, FormData>(reinstateAttendeeAction, {});
  const [labelled, label] = useActionState<FormState, FormData>(assignCategoryAction, {});
  const [sent, resend] = useActionState<AttendeeEditState, FormData>(resendConfirmationAction, {});

  // The row menu links straight to `#transfer` and `#cancel`. A closed
  // `<details>` does not open for a fragment that names it, so this does.
  const [jump, setJump] = useState('');
  useEffect(() => {
    const read = () => setJump(window.location.hash.slice(1));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [a.registrationId]);

  if (a.status === 'transferred') {
    return (
      <>
        <FormBanner state={moved.ok ? moved : saved} />
        <p className="body-2" style={{ marginBottom: 0 }}>
          This ticket was moved to another email. This badge no longer scans.{' '}
          {a.transferredTo ? <Link href={`?edit=${a.transferredTo}`}>Open the current holder</Link> : null}
        </p>
      </>
    );
  }

  if (a.status === 'cancelled') {
    return (
      <>
        <FormBanner state={ended.ok ? ended : restored} />
        <p className="body-2">
          This registration is cancelled. The badge does not scan and {a.email} cannot sign into the
          app.
        </p>
        <form action={reinstate}>
          {hidden(a.registrationId)}
          <SubmitButton pendingLabel="Reinstating…">Reinstate</SubmitButton>
        </form>
      </>
    );
  }

  return (
    <>
      <form action={save}>
        {hidden(a.registrationId)}
        <FormBanner state={restored.ok && !saved.ok && !saved.error ? restored : saved} />
        <FormGrid>
          <Field
            label="Name"
            name="name"
            required
            defaultValue={a.name}
            autoComplete="off"
            error={saved.fieldErrors?.name}
            hint="Printed on the badge."
          />
          <Field
            label="Email"
            name="email"
            type="email"
            required
            defaultValue={a.email}
            autoComplete="off"
            error={saved.fieldErrors?.email}
            hint="Changing it keeps the same badge and sends the confirmation to the new address."
          />
          <Field
            label="Title"
            name="title"
            defaultValue={a.title}
            autoComplete="off"
            error={saved.fieldErrors?.title}
          />
          <Field
            label="Company"
            name="company"
            defaultValue={a.company}
            autoComplete="off"
            error={saved.fieldErrors?.company}
          />
        </FormGrid>
        <FormActions>
          <SubmitButton>Save</SubmitButton>
        </FormActions>
      </form>

      <form action={changeType} style={section}>
        {hidden(a.registrationId)}
        <FormBanner state={typed} />
        <FormGrid>
          <Select
            label="Ticket type"
            name="ticketType"
            defaultValue={a.ticketType}
            options={ticketTypes.map((t) => ({ value: t, label: t }))}
            hint="No payment or refund is made."
          />
        </FormGrid>
        <FormActions>
          <SubmitButton variant="secondary" pendingLabel="Changing…">
            Change ticket type
          </SubmitButton>
        </FormActions>
      </form>

      {/* Keyed on the saved value: a form reset after the action would otherwise
          put the select back to what it showed before the save. */}
      <form key={a.categoryId} id="category" action={label} style={section}>
        <input type="hidden" name="rid" value={a.registrationId} />
        <FormBanner state={labelled} />
        <FormGrid>
          <Select
            label="Category"
            name="categoryId"
            defaultValue={a.categoryId}
            options={[{ value: '', label: 'No category' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            hint="Printed on the badge and shown on their profile in the app."
          />
        </FormGrid>
        <FormActions>
          <SubmitButton variant="secondary">Set category</SubmitButton>
        </FormActions>
      </form>

      <form action={resend} style={section}>
        {hidden(a.registrationId)}
        <FormBanner state={sent} />
        <p className="body-2">
          The confirmation email has their claim code and a link to their badge.
          {emailReady ? '' : ' Email is not set up yet, so it will not be sent.'}
        </p>
        <SubmitButton variant="secondary" pendingLabel="Sending…" disabled={!emailReady}>
          Send confirmation again
        </SubmitButton>
      </form>

      <details id="transfer" style={section} open={jump === 'transfer' || undefined}>
        <summary className="linkish" style={{ cursor: 'pointer' }}>
          Transfer to someone else
        </summary>
        <form action={transfer} style={{ marginTop: 12 }}>
          {hidden(a.registrationId)}
          <FormBanner state={moved} />
          <p className="body-2">
            The new person gets this {a.ticketType || 'ticket'}, a new badge and a confirmation
            email. {a.name || a.email} loses the ticket and their badge stops scanning.
          </p>
          <FormGrid>
            <Field
              label="New attendee name"
              name="name"
              required
              autoComplete="off"
              error={moved.fieldErrors?.name}
            />
            <Field
              label="New attendee email"
              name="email"
              type="email"
              required
              autoComplete="off"
              error={moved.fieldErrors?.email}
            />
            <Field label="Title" name="title" autoComplete="off" error={moved.fieldErrors?.title} />
            <Field
              label="Company"
              name="company"
              autoComplete="off"
              error={moved.fieldErrors?.company}
            />
          </FormGrid>
          <FormActions>
            <SubmitButton pendingLabel="Transferring…">Transfer ticket</SubmitButton>
          </FormActions>
        </form>
      </details>

      <details id="cancel" style={section} open={jump === 'cancel' || undefined}>
        <summary className="linkish" style={{ color: 'var(--danger)', cursor: 'pointer' }}>
          Cancel registration
        </summary>
        <form action={cancel} style={{ marginTop: 12 }}>
          {hidden(a.registrationId)}
          <FormBanner state={ended} />
          <p className="body-2">
            The badge stops scanning and {a.email} can no longer sign into the app.
            {a.hasPaidOrder
              ? ' The seat goes back on sale. No money is refunded here. Refund the order from Attendee Orders.'
              : ''}{' '}
            You can reinstate them later.
          </p>
          <SubmitButton variant="danger" pendingLabel="Cancelling…">
            Cancel registration
          </SubmitButton>
        </form>
      </details>
    </>
  );
}
