'use client';

import { useActionState } from 'react';
import { Select, SubmitButton } from '../../../form';
import {
  startDayScopeAction,
  startSessionScopeAction,
  type ScopeState,
} from './actions';

/**
 * The Day and Session cards on Whova's check-in landing, with working Start
 * buttons.
 *
 * Both were `disabled title="Not built — see below"`, which is the failure
 * `ui.tsx` argues against: a greyed button is a promise that the feature exists
 * and is merely unavailable, and it renders to a demo audience regardless of
 * `SHOW_GAP_NOTES`.
 *
 * ── Why a select and not a card per session ─────────────────────────────────
 *
 * Whova's card says "Check in attendees for a specific session" and opens a
 * picker. Seventy sessions cannot be seventy buttons on the landing screen, and
 * the person pressing this is standing at a door with one session in mind. The
 * option list is pre-sorted by start time and shows the room, because at 14:00
 * on day two there are four sessions running and the room is what distinguishes
 * them.
 *
 * The select defaults to whatever the page decided is happening now, so the
 * common case is Start with no other interaction — which is the whole point of
 * stamping `opensAt` / `closesAt` on the list.
 */
export function SessionScopeForm({
  options,
  defaultValue,
}: {
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  const [state, action] = useActionState<ScopeState, FormData>(startSessionScopeAction, {});

  if (options.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
        No sessions in the programme yet.
      </p>
    );
  }

  return (
    <form action={action}>
      <Select
        name="sessionId"
        aria-label="Session"
        defaultValue={defaultValue}
        options={options}
        placeholder="— pick a session —"
        required
        groupStyle={{ marginBottom: 8 }}
      />
      {state.error ? <p className="whova-form-error-message">{state.error}</p> : null}
      <SubmitButton small pendingLabel="Opening…">
        Start
      </SubmitButton>
    </form>
  );
}

export function DayScopeForm({
  options,
  defaultValue,
}: {
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  const [state, action] = useActionState<ScopeState, FormData>(startDayScopeAction, {});

  if (options.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
        No programme days yet — a day comes from the sessions scheduled on it.
      </p>
    );
  }

  return (
    <form action={action}>
      <Select
        name="day"
        aria-label="Day"
        defaultValue={defaultValue}
        options={options}
        placeholder="— pick a day —"
        required
        groupStyle={{ marginBottom: 8 }}
      />
      {state.error ? <p className="whova-form-error-message">{state.error}</p> : null}
      <SubmitButton small pendingLabel="Opening…">
        Start
      </SubmitButton>
    </form>
  );
}
