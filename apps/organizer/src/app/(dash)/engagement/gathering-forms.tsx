'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { GatheringDoc } from '@kgc/shared';
import type { GatheringRow } from '@/lib/gatherings';
import {
  placeAttendeeAction,
  saveGatheringAction,
  type GatheringState,
} from './gathering-actions';

function Submit({ idle, busy, secondary }: { idle: string; busy: string; secondary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`whova-btn-main${secondary ? ' secondary' : ''}`}
      disabled={pending}
    >
      {pending ? busy : idle}
    </button>
  );
}

/**
 * Create a round table or a meeting slot.
 *
 * The room is a `<select>` carrying `id|Name`, so the denormalised room name
 * comes from the same choice as the id. Looking the name up separately on the
 * server is a second chance for the two to disagree, and the symptom of that is
 * a table card printed with the wrong room on it.
 */
export function GatheringForm({
  kind,
  editing,
  rooms,
  days,
  capacityHint,
  titleLabel,
  titlePlaceholder,
  hostLabel,
  defaultCapacity,
}: {
  kind: GatheringDoc['kind'];
  editing?: GatheringRow;
  rooms: { id: string; name: string }[];
  days: string[];
  capacityHint: string;
  titleLabel: string;
  titlePlaceholder: string;
  hostLabel: string;
  defaultCapacity: number;
}) {
  const [state, action] = useActionState<GatheringState, FormData>(saveGatheringAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="kind" value={kind} />
      {editing && <input type="hidden" name="id" value={editing.id} />}

      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="title">
          {titleLabel}
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={120}
          defaultValue={editing?.title}
          placeholder={titlePlaceholder}
        />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="host">
          {hostLabel}
        </label>
        <input
          id="host"
          name="host"
          maxLength={80}
          defaultValue={editing?.host}
          placeholder="optional"
          style={{ maxWidth: 300 }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          Free text. Most of the people who host a table are speakers or partners who hold no
          account here, and requiring one would exclude exactly them.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="roomId">
          Room
        </label>
        <select
          id="roomId"
          name="roomId"
          defaultValue={editing?.roomId ? `${editing.roomId}|${editing.roomName}` : ''}
          style={{ maxWidth: 300 }}
        >
          <option value="">— not decided —</option>
          {rooms.map((r) => (
            <option key={r.id} value={`${r.id}|${r.name}`}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="day">
          Day
        </label>
        <select id="day" name="day" defaultValue={editing?.day ?? ''} style={{ maxWidth: 220 }}>
          <option value="">— not decided —</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="startsAtLocal">
          Time
        </label>
        <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
          <input
            id="startsAtLocal"
            name="startsAtLocal"
            placeholder="14:00"
            defaultValue={editing?.startsAtLocal}
            style={{ maxWidth: 100 }}
          />
          <span className="muted">to</span>
          <input
            name="endsAtLocal"
            placeholder="15:00"
            defaultValue={editing?.endsAtLocal}
            style={{ maxWidth: 100 }}
          />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Local wall time at the venue, 24-hour. The same convention the agenda uses, so a room
          clash between a session and a table is comparable.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="capacity">
          Capacity
        </label>
        <input
          id="capacity"
          name="capacity"
          type="number"
          min={1}
          max={200}
          required
          defaultValue={editing?.capacity ?? defaultCapacity}
          style={{ maxWidth: 120 }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          {capacityHint}
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="notes">
          Notes
        </label>
        <input
          id="notes"
          name="notes"
          maxLength={200}
          defaultValue={editing?.notes}
          placeholder="optional — AV needed, catering, anything the desk should know"
        />
      </div>

      <Submit idle={editing ? 'Save' : 'Add'} busy="Saving…" />
    </form>
  );
}

/**
 * Place one person.
 *
 * A form per row rather than one form with a picker, because the question an
 * organizer is answering is "who else is at *this* table" and a shared form
 * makes them choose the table twice.
 */
export function PlaceForm({
  kind,
  gathering,
}: {
  kind: GatheringDoc['kind'];
  gathering: GatheringRow;
}) {
  const [state, action] = useActionState<GatheringState, FormData>(placeAttendeeAction, {});

  if (gathering.full) {
    return (
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Full at {gathering.capacity}. Raise the capacity to add anybody else — the cap is refused
        rather than exceeded, because somebody sent to a table with no chair is worse than a number
        being wrong.
      </p>
    );
  }

  return (
    <form action={action} style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={gathering.id} />
      <input name="name" placeholder="Name" maxLength={80} required style={{ maxWidth: 220 }} />
      <Submit idle={`Add (${gathering.spare} left)`} busy="Adding…" secondary />
      {state.error && (
        <span className="error" role="alert" style={{ fontSize: 12 }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
