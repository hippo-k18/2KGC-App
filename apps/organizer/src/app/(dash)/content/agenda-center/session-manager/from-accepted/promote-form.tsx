'use client';

import { useActionState } from 'react';
import type { RoomOption } from '@/lib/data';
import {
  Field,
  FormActions,
  FormBanner,
  FormGrid,
  Select,
  SubmitButton,
  type FormState,
} from '../../../../form';
import { promoteAction } from './actions';

/**
 * The three decisions acceptance did not make.
 *
 * Defaults are deliberately absent rather than "the first free slot on day one".
 * A pre-filled time is a time somebody accepts without reading, and the point of
 * this screen is that a person chooses where the talk goes. The one thing it
 * does suggest is a duration, through the end field's hint, because a 45-minute
 * default that is silently applied is the same mistake one layer down.
 */
export function PromoteForm({
  submissionId,
  title,
  rooms,
}: {
  submissionId: string;
  title: string;
  rooms: RoomOption[];
}) {
  const [state, action] = useActionState<FormState, FormData>(promoteAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="submissionId" value={submissionId} />
      <FormBanner state={state} />

      <FormGrid>
        <Field
          label="Starts"
          name="startsAtLocal"
          type="datetime-local"
          required
          width="lg"
          hint="Local time in the event's timezone, exactly as Session Manager stores it."
        />
        <Field
          label="Ends"
          name="endsAtLocal"
          type="datetime-local"
          required
          width="lg"
          hint="Must be after the start. Nothing is defaulted."
        />
      </FormGrid>

      <Select
        label="Room"
        name="roomId"
        placeholder="No room yet…"
        width="lg"
        options={rooms.map((r) => ({ value: r.id, label: r.name }))}
        hint="Can be left empty. A session with no room shows as unscheduled on the agenda."
      />

      <FormActions>
        <SubmitButton pendingLabel="Adding…">Add “{title}” to the agenda</SubmitButton>
      </FormActions>
    </form>
  );
}
