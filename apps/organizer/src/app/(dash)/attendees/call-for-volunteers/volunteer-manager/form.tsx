'use client';

import { useActionState } from 'react';
import { Field, FormActions, FormBanner, FormGrid, Select, SubmitButton, Textarea } from '../../../form';
import { saveVolunteerAction, type VolunteerState } from './actions';

/**
 * One volunteer and one shift.
 *
 * The shift is three plain fields — a day, a start and an end — rather than two
 * `datetime-local` controls. They are wall clock in the event's timezone, which
 * is the authoring truth everywhere else in this project (`SessionDoc`
 * `startsAtLocal` + `day`), and a `datetime-local` on an organizer's laptop in
 * another timezone is exactly how a 07:00 desk shift becomes a 02:00 one.
 *
 * All three are optional, deliberately. Half a roster is built before the times
 * are settled — "Ada has said yes, I do not know to what yet" — and a form that
 * refuses that forces the organizer to invent a time, which is worse data than
 * a blank.
 */
export function VolunteerForm({ days }: { days: string[] }) {
  const [state, action] = useActionState<VolunteerState, FormData>(saveVolunteerAction, {});

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
          hint="Who you will be looking for at the door."
        />
        <Field
          label="Email"
          name="email"
          type="email"
          required
          placeholder="ada@example.com"
          autoComplete="off"
          hint="The join key: a waiver signed at this address shows against this row."
        />
        <Field
          label="Phone"
          name="phone"
          autoComplete="off"
          placeholder="+44 …"
          hint="Optional. The only number that matters at 07:05 on day one."
        />
      </FormGrid>

      <FormGrid>
        <Field
          label="Role"
          name="role"
          required
          placeholder="Registration desk"
          autoComplete="off"
          hint="Free text. It is what goes on the roster, not a permission."
        />
        <Select
          label="Status"
          name="status"
          defaultValue="invited"
          options={[
            { value: 'invited', label: 'Invited: waiting on an answer' },
            { value: 'confirmed', label: 'Confirmed' },
            { value: 'declined', label: 'Declined' },
          ]}
          hint="Start at invited. The roster counts confirmed and outstanding separately."
        />
      </FormGrid>

      <FormGrid>
        <Field
          label="Day"
          name="day"
          type="date"
          list={days.length > 0 ? 'volunteer-days' : undefined}
          hint="The event's own calendar day, YYYY-MM-DD."
          width="sm"
        />
        <Field label="Starts" name="startsAtLocal" type="time" width="sm" hint="Local wall clock." />
        <Field label="Ends" name="endsAtLocal" type="time" width="sm" hint="Local wall clock." />
      </FormGrid>

      {days.length > 0 ? (
        <datalist id="volunteer-days">
          {days.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      ) : null}

      <Textarea
        label="Notes"
        name="notes"
        rows={2}
        placeholder="Has done this before; needs the radio."
        hint="Optional."
      />

      <FormActions>
        <SubmitButton pendingLabel="Adding…">Add to roster</SubmitButton>
      </FormActions>
    </form>
  );
}
