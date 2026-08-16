'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { RoomOption } from '@/lib/data';
import { saveSessionAction, type SaveState } from './actions';

export interface SessionFormValues {
  id: string;
  title: string;
  description: string;
  roomId: string;
  startsAtLocal: string;
  endsAtLocal: string;
  status: string;
  timeZone: string;
  day: string;
  sequence: number;
  /**
   * `updatedAt` in millis. Used as the `key` on every field.
   *
   * Without it the console lies to you. A server action revalidates the route,
   * so the page re-renders with the saved document — but React keeps the DOM
   * node of an uncontrolled input and ignores the new `defaultValue`, so the
   * room dropdown carries on displaying the old room next to a green "Saved."
   * The organizer reads that as a failed save and tries again. Re-keying on the
   * document version remounts the fields with the values Firestore actually
   * holds, and because only the fields remount, the result message survives.
   */
  version: number;
}

/**
 * The only client component that matters. It holds no Firebase anything — it
 * posts a `FormData` to a server action and renders what comes back.
 *
 * The time inputs are `datetime-local`, whose value format is exactly the
 * `YYYY-MM-DDTHH:mm` wall clock the model stores, so nothing is parsed or
 * reformatted on the way in or out. The browser's own timezone never enters it;
 * `startsAt`, `endsAt` and `day` are derived from these strings on the server.
 */
export function SessionForm({ values, rooms }: { values: SessionFormValues; rooms: RoomOption[] }) {
  const save = saveSessionAction.bind(null, values.id);
  const [state, action, pending] = useActionState<SaveState, FormData>(save, {});

  return (
    <form action={action}>
      <label htmlFor="title">Title</label>
      <input key={values.version} id="title" name="title" defaultValue={values.title} required />

      <label htmlFor="roomId">Room</label>
      <select key={values.version} id="roomId" name="roomId" defaultValue={values.roomId}>
        <option value="">— no room —</option>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>

      <label htmlFor="startsAtLocal">Starts ({values.timeZone} wall clock)</label>
      <input
        key={values.version}
        id="startsAtLocal"
        name="startsAtLocal"
        type="datetime-local"
        defaultValue={values.startsAtLocal}
        required
      />

      <label htmlFor="endsAtLocal">Ends</label>
      <input
        key={values.version}
        id="endsAtLocal"
        name="endsAtLocal"
        type="datetime-local"
        defaultValue={values.endsAtLocal}
        required
      />

      <label htmlFor="status">Status</label>
      <select key={values.version} id="status" name="status" defaultValue={values.status}>
        <option value="draft">draft — hidden from attendees</option>
        <option value="published">published</option>
        <option value="cancelled">cancelled — still visible, marked cancelled</option>
      </select>
      <p className="muted">
        There is no delete. Attendees have this saved and Firestore has no cascade, so removing a
        session from the programme is a status change.
      </p>

      <label htmlFor="description">Description</label>
      <textarea
        key={values.version}
        id="description"
        name="description"
        rows={8}
        defaultValue={values.description}
      />

      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </button>{' '}
      <Link href="/sessions">Back to sessions</Link>

      {state.error ? <p className="error">{state.error}</p> : null}
      {state.ok ? <p className="ok">{state.message}</p> : null}
      {state.pushNote ? <p className="muted">{state.pushNote}</p> : null}
    </form>
  );
}
