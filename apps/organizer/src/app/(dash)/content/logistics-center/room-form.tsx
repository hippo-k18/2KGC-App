'use client';

import { useActionState } from 'react';
import { Field, FormActions, FormBanner, FormGrid, SubmitButton } from '../../form';
import { saveRoomAction, type RoomState } from './actions';

export interface EditableRoom {
  id: string;
  name: string;
  building?: string;
  floor?: string;
  capacity?: number;
  /** Sessions scheduled here — the blast radius of a rename. */
  sessionCount: number;
}

/**
 * Create or edit one room.
 *
 * ── The name is wayfinding, not a label ─────────────────────────────────────
 *
 * The attendee app cannot read the `rooms` collection at all — there is no
 * rules block for it, so it is default-denied — and what a phone displays is
 * the `roomName` copied onto each session. This field is therefore the only
 * instruction anybody gets about which door to walk through, which is why the
 * hint says how many sessions a rename will rewrite before it is typed, and why
 * the action reports what it actually rewrote afterwards.
 *
 * It should match the sign on the door rather than the name in the contract.
 * "Bloomberg 165" and "Lecture Hall 2" being the same room is a fact the venue
 * knows and an attendee standing in a corridor does not.
 */
export function RoomForm({ existing }: { existing?: EditableRoom }) {
  const [state, action] = useActionState<RoomState, FormData>(saveRoomAction, {});

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}

      <FormBanner state={state} />

      {state.fanOut && (
        <p
          className={state.fanOutOk ? 'muted' : undefined}
          role={state.fanOutOk ? undefined : 'alert'}
          style={{
            fontSize: 13,
            marginTop: -8,
            ...(state.fanOutOk ? null : { color: 'var(--danger)', fontWeight: 600 }),
          }}
        >
          Agenda caches: {state.fanOut}
          {state.fanOutOk
            ? null
            : ' Those sessions still show the old room name to attendees — repair them from the agenda cache check on Track Manager.'}
        </p>
      )}

      <Field
        name="name"
        label="Room"
        required
        defaultValue={existing?.name}
        error={state.fieldErrors?.name}
        maxLength={60}
        width="lg"
        hint={
          existing ? (
            <>
              As signposted at the venue — this is the only wayfinding an attendee gets. Renaming
              rewrites the room shown on{' '}
              {existing.sessionCount === 0
                ? 'no sessions; nothing is scheduled here yet'
                : `${existing.sessionCount} session${existing.sessionCount === 1 ? '' : 's'}`}
              . Id <code>{existing.id}</code> never changes — sessions point at it.
            </>
          ) : (
            'As signposted at the venue, not as named in the contract. It is the only wayfinding an attendee gets.'
          )
        }
      />

      <FormGrid>
        <Field
          name="building"
          label="Building"
          defaultValue={existing?.building}
          placeholder="Bloomberg Center"
          maxLength={60}
        />
        <Field name="floor" label="Floor" defaultValue={existing?.floor} placeholder="2" maxLength={20} />
        <Field
          name="capacity"
          label="Seats"
          type="number"
          min={1}
          defaultValue={existing?.capacity ?? ''}
          error={state.fieldErrors?.capacity}
          placeholder="Not known"
          hint="Used by Conflict Check to flag a session capped above what the room holds."
        />
      </FormGrid>

      <p className="muted" style={{ fontSize: 12 }}>
        Building and floor are organizer-side only: the app shows the room name and nothing else,
        because it cannot read this collection. They are worth filling in for the printed signage
        and for whoever is directing people in the lobby.
      </p>

      <FormActions>
        <SubmitButton pendingLabel="Saving…">
          {existing ? 'Save changes' : 'Add room'}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
