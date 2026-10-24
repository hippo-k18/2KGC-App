'use client';

import { useActionState } from 'react';
import { Field, FormActions, FormBanner, FormGrid, Select, SubmitButton } from '../../../form';
import { addAttendeeAction, type AddAttendeeState } from './add-actions';

/**
 * One attendee, by hand.
 *
 * Three fields, because a registration has three things worth typing: the
 * address a claim code goes to, the name that goes on a badge, and which ticket
 * they are counted under. Everything else about an attendee — title, company,
 * interests, photo — belongs to the profile they create when they sign in, and
 * this form does not pretend to own it.
 *
 * The ticket type is a select over what the catalogue actually sells plus a
 * free-text fallback, rather than an open box: a typo here splits one ticket
 * type into two in every breakdown on Analytics & Exports, and nothing
 * downstream would flag it.
 */
export function AddAttendeeForm({ ticketTypes }: { ticketTypes: string[] }) {
  const [state, action] = useActionState<AddAttendeeState, FormData>(addAttendeeAction, {});

  return (
    <form action={action}>
      <FormBanner state={state} successFallback="Added." />

      <FormGrid>
        <Field
          label="Name"
          name="name"
          required
          placeholder="Ada Lovelace"
          autoComplete="off"
          hint="Printed on the badge."
        />
        <Field
          label="Email"
          name="email"
          type="email"
          required
          placeholder="ada@example.com"
          autoComplete="off"
          hint="Adding the same email again updates that attendee."
        />
        <Select
          label="Ticket type"
          name="ticketType"
          placeholder="Added by organizer…"
          options={ticketTypes.map((t) => ({ value: t, label: t }))}
          hint="No order or payment is recorded."
        />
      </FormGrid>

      <FormActions>
        <SubmitButton pendingLabel="Adding…">Add attendee</SubmitButton>
      </FormActions>
    </form>
  );
}
