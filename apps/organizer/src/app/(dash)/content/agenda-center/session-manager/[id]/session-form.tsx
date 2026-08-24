'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { RoomOption } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
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
   * Without it the form lies to you. A server action revalidates the route, so
   * the page re-renders with the saved document — but React keeps the DOM node
   * of an uncontrolled input and ignores the new `defaultValue`, so the room
   * dropdown carries on displaying the old room next to a green "Saved." The
   * organizer reads that as a failed save and tries again. Re-keying on the
   * document version remounts the fields with the values Firestore actually
   * holds, and because only the fields remount, the result message survives.
   */
  version: number;
}

/**
 * Whova's Edit Session modal, as a page.
 *
 * The field order and the labels are Whova's: Title, Date, Time (two inputs
 * with a literal `TO` between them), Location, Description, Tracks, Speakers.
 * Ours collapses Date and Time into two `datetime-local` inputs because that
 * control's value format is exactly the `YYYY-MM-DDTHH:mm` wall clock the model
 * already stores, so nothing is parsed or reformatted on the way in or out and
 * the browser's own timezone never enters it. `startsAt`, `endsAt` and `day`
 * are derived from these strings on the server.
 *
 * A page rather than a modal because a session edit is the one thing in this
 * console that is worth a URL — "look at this session" is a message people send
 * each other on the morning of the conference.
 */
export function SessionForm({ values, rooms }: { values: SessionFormValues; rooms: RoomOption[] }) {
  const save = saveSessionAction.bind(null, values.id);
  const [state, action, pending] = useActionState<SaveState, FormData>(save, {});

  return (
    <form action={action}>
      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="title">Title</label>
          <span className="whova-form-label-suffix">*</span>
        </div>
        <input
          key={values.version}
          id="title"
          name="title"
          className="whova-text-input"
          defaultValue={values.title}
          required
        />
      </div>

      <div className="form-row">
        <div className="whova-form-group">
          <div className="whova-form-label">
            <label htmlFor="startsAtLocal">Starts</label>
            <span className="whova-form-label-suffix">*</span>
          </div>
          <input
            key={values.version}
            id="startsAtLocal"
            name="startsAtLocal"
            type="datetime-local"
            className="whova-text-input"
            defaultValue={values.startsAtLocal}
            required
          />
          <p className="whova-form-description">Wall clock in {values.timeZone}.</p>
        </div>

        <div className="whova-form-group">
          <div className="whova-form-label">
            <label htmlFor="endsAtLocal">Ends</label>
            <span className="whova-form-label-suffix">*</span>
          </div>
          <input
            key={values.version}
            id="endsAtLocal"
            name="endsAtLocal"
            type="datetime-local"
            className="whova-text-input"
            defaultValue={values.endsAtLocal}
            required
          />
        </div>
      </div>

      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="roomId">Location</label>
        </div>
        <select
          key={values.version}
          id="roomId"
          name="roomId"
          className="whova-text-input"
          defaultValue={values.roomId}
        >
          <option value="">— no room —</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="status">Status</label>
        </div>
        <select
          key={values.version}
          id="status"
          name="status"
          className="whova-text-input"
          defaultValue={values.status}
        >
          <option value="draft">draft — hidden from attendees</option>
          <option value="published">published</option>
          <option value="cancelled">cancelled — still visible, marked cancelled</option>
        </select>
        <p className="whova-form-description">
          There is no delete. Attendees have this saved and Firestore has no cascade, so removing a
          session from the programme is a status change.
        </p>
      </div>

      <div className="whova-form-group">
        <div className="whova-form-label">
          <label htmlFor="description">Description</label>
        </div>
        <textarea
          key={values.version}
          id="description"
          name="description"
          className="whova-text-input"
          rows={8}
          defaultValue={values.description}
        />
      </div>

      {state.error ? <p className="whova-form-error-message">{state.error}</p> : null}
      {state.ok ? (
        <p style={{ color: 'var(--success)', fontSize: 14 }}>{state.message}</p>
      ) : null}
      {state.pushNote ? <p className="whova-form-description">{state.pushNote}</p> : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Link className="whova-btn-main secondary" href={ROUTES.sessionManager}>
          Cancel
        </Link>
        <button type="submit" className="whova-btn-main primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
