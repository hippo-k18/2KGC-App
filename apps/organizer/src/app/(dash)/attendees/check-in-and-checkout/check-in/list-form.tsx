'use client';

import { useActionState } from 'react';
import { createListAction, type CreateListState } from './actions';

/**
 * Another list: day two's door, a workshop, a dinner.
 *
 * `kind` is the model's, not ours — `event | session | meal | workshop`. Only
 * `event` is wired to anything today; the other three write a perfectly valid
 * list that this screen will happily scan against, which is exactly how session
 * check-in gets built later without a data migration.
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
