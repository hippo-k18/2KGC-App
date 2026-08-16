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
      <label htmlFor="list-name">Name</label>
      <input id="list-name" name="name" placeholder="Day 2 door" autoComplete="off" required />

      <label htmlFor="list-kind">Kind</label>
      <select id="list-kind" name="kind" defaultValue="event">
        <option value="event">event — the door</option>
        <option value="session">session</option>
        <option value="workshop">workshop</option>
        <option value="meal">meal</option>
      </select>

      <button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create list'}
      </button>

      {state.error ? <p className="error">{state.error}</p> : null}
      {state.message ? <p className="ok">{state.message}</p> : null}
    </form>
  );
}
