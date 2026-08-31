'use client';

import { useActionState } from 'react';
import { createListAction, type CreateListState } from './actions';

/**
 * Another list: day two's door, a workshop, a dinner.
 *
 * `kind` is the model's, not ours — `event | session | meal | workshop`.
 *
 * This is the hand-named list: a dinner, a shuttle, day two's second door. A
 * *session* door is not created here — Start on the session card above derives
 * its id from the session so that two people pressing it produce one list — and
 * creating a `session`-kind list from this form gives it a generated id with no
 * `sessionId`, which the attendance report cannot join to a session and will
 * not count. The option is kept because the model has it and because a
 * standalone workshop door is a legitimate thing to want; the note under it
 * says which one to use.
 */
export function CreateListForm() {
  const [state, action, pending] = useActionState<CreateListState, FormData>(createListAction, {});

  return (
    <form action={action}>
      <div className="form-row">
        <div className="whova-form-group">
          <div className="whova-form-label">
            <label htmlFor="list-name">Name</label>
            <span className="whova-form-label-suffix">*</span>
          </div>
          <input
            id="list-name"
            name="name"
            className="whova-text-input"
            placeholder="Day 2 door"
            autoComplete="off"
            required
          />
        </div>

        <div className="whova-form-group">
          <div className="whova-form-label">
            <label htmlFor="list-kind">Kind</label>
          </div>
          <select id="list-kind" name="kind" className="whova-text-input" defaultValue="event">
            <option value="event">event — the door</option>
            <option value="session">session</option>
            <option value="workshop">workshop</option>
            <option value="meal">meal</option>
          </select>
        </div>
      </div>

      <p className="whova-form-description">
        For a session, use <strong>Start</strong> on the session card at the top instead — that
        derives the list id from the session, so the attendance report can join the two and two
        organizers pressing it cannot open two doors into the same room.
      </p>

      {state.error ? <p className="whova-form-error-message">{state.error}</p> : null}
      {state.message ? (
        <p style={{ color: 'var(--success)', fontSize: 14 }}>{state.message}</p>
      ) : null}

      <button type="submit" className="whova-btn-main primary" disabled={pending}>
        {pending ? 'Creating…' : 'Create list'}
      </button>
    </form>
  );
}
