'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveAccessSettingsAction, type AccessState } from './actions';

/** Shared submit button — `useFormStatus` only reports its own form. */
function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

export function PostEventForm({
  postEventDays,
  postEventReadOnly,
}: {
  postEventDays: number;
  postEventReadOnly: boolean;
}) {
  const [state, action] = useActionState<AccessState, FormData>(saveAccessSettingsAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="which" value="post-event" />
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="postEventDays">
          Days of access after the event
        </label>
        <input
          id="postEventDays"
          name="postEventDays"
          type="number"
          min={0}
          max={3650}
          defaultValue={postEventDays}
          style={{ maxWidth: 140 }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          0 means access ends when the event does. Whova&rsquo;s default is 30.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label">Options</label>
        <label style={{ display: 'block' }}>
          <input type="checkbox" name="postEventReadOnly" defaultChecked={postEventReadOnly} />{' '}
          Read-only afterwards — no new posts, messages or questions
        </label>
      </div>

      <SaveButton />
    </form>
  );
}

export function CodeAccessForm({
  eventCode,
  codeRequired,
}: {
  eventCode: string;
  codeRequired: boolean;
}) {
  const [state, action] = useActionState<AccessState, FormData>(saveAccessSettingsAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="which" value="code" />
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="eventCode">
          Event code
        </label>
        <input
          id="eventCode"
          name="eventCode"
          defaultValue={eventCode}
          placeholder="KGC2027"
          maxLength={32}
          style={{ maxWidth: 240, fontFamily: 'ui-monospace, Menlo, monospace' }}
        />
        {/*
          Letters, digits and hyphens only, because this gets read out from a
          stage to a room of a thousand people. A code with an underscore in it
          is a code half the room types wrong.
        */}
        <p className="muted" style={{ fontSize: 12 }}>
          4–32 letters, digits or hyphens. It gets read out loud, so keep it sayable.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label">Options</label>
        <label style={{ display: 'block' }}>
          <input type="checkbox" name="codeRequired" defaultChecked={codeRequired} /> Require the
          code to join the event
        </label>
      </div>

      <SaveButton />
    </form>
  );
}
