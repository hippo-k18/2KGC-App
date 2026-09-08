'use client';

import { useActionState } from 'react';
import { Field, FormGrid, Select, SubmitButton } from '../../../form';
import { openRoomDoorAction, type RoomDoorState } from './actions';

/**
 * Pick a session, name the door, walk away with it.
 *
 * A select rather than a card per session, the same choice the Session card on
 * Check-in makes: seventy sessions cannot be seventy buttons, and the person
 * pressing this is standing outside one room with one session in mind. The
 * options carry the day, the time and the room because at 14:00 on day two
 * there are four sessions running and none of those three alone tells them
 * apart.
 */
export function RoomDoorForm({
  options,
  defaultValue,
  defaultStation,
}: {
  options: { value: string; label: string }[];
  defaultValue?: string;
  defaultStation?: string;
}) {
  const [state, action] = useActionState<RoomDoorState, FormData>(openRoomDoorAction, {});

  if (options.length === 0) {
    return (
      <p className="body-2" style={{ marginBottom: 0 }}>
        No sessions in the programme yet, so there is no room to put a door on.
      </p>
    );
  }

  return (
    <form action={action}>
      <FormGrid>
        <Select
          label="Session"
          name="sessionId"
          defaultValue={defaultValue}
          options={options}
          placeholder="Pick a session…"
          required
          hint="Pressing this twice opens one door, not two. The list id is derived from the session."
        />
        <Field
          label="Station name"
          name="station"
          defaultValue={defaultStation}
          autoComplete="off"
          width="sm"
          hint="What a duplicate scan will name. The room, usually."
        />
      </FormGrid>
      {state.error ? <p className="whova-form-error-message">{state.error}</p> : null}
      <SubmitButton pendingLabel="Opening…">Open the room door</SubmitButton>
    </form>
  );
}
