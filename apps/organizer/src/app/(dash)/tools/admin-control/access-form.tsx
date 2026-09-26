'use client';

import { useActionState } from 'react';
import { CheckboxField, Field, FormBanner, SubmitButton } from '../../form';
import { saveAccessSettingsAction, type AccessState } from './actions';

/**
 * The two Admin Control forms — the event code, and how long the app stays open.
 *
 * ── `version` ───────────────────────────────────────────────────────────────
 *
 * `settings/access.updatedAt` in milliseconds, and 0 before the document has
 * ever been written. It is the `key` on every control, for the reason
 * `session-form.tsx` documents at length: the action revalidates the route and
 * the page re-renders with what Firestore now holds, but React keeps the DOM
 * node of an uncontrolled input and ignores the new `defaultValue`. Without it
 * the box goes on showing the previous code next to a banner naming the new
 * one, and — the part that does damage — a second Save posts the stale value
 * back over the one that was just stored.
 *
 * Both forms write the same settings document, so both re-key off the same
 * number. Only the controls remount, so the banner above them survives.
 *
 * ── The controls ────────────────────────────────────────────────────────────
 *
 * `Field` / `CheckboxField` / `SubmitButton` from `form.tsx`, not bare inputs.
 * These were hand-rolled `<input>`s with a local class, which rendered the
 * browser's default border where every other screen in the dashboard has the
 * Whova box, and a 13px checkbox against the 16px one used everywhere else.
 */

export function PostEventForm({
  postEventDays,
  postEventReadOnly,
  version,
}: {
  postEventDays: number;
  postEventReadOnly: boolean;
  version: number;
}) {
  const [state, action] = useActionState<AccessState, FormData>(saveAccessSettingsAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="which" value="post-event" />
      <FormBanner state={state} />

      <Field
        key={`postEventDays-${version}`}
        id="postEventDays"
        name="postEventDays"
        label="Days of access after the event"
        type="number"
        min={0}
        max={3650}
        defaultValue={postEventDays}
        width="sm"
        hint="0 means access ends when the event does."
      />

      <CheckboxField
        key={`postEventReadOnly-${version}`}
        name="postEventReadOnly"
        label="Read-only afterwards, no new posts, messages or questions"
        defaultChecked={postEventReadOnly}
      />

      <div style={{ marginTop: 16 }}>
        <SubmitButton>Save</SubmitButton>
      </div>
    </form>
  );
}

export function CodeAccessForm({
  eventCode,
  codeRequired,
  version,
}: {
  eventCode: string;
  codeRequired: boolean;
  version: number;
}) {
  const [state, action] = useActionState<AccessState, FormData>(saveAccessSettingsAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="which" value="code" />
      <FormBanner state={state} />

      {/*
        Letters, digits and hyphens only, because this gets read out from a
        stage to a room of a thousand people. A code with an underscore in it
        is a code half the room types wrong.
      */}
      <Field
        key={`eventCode-${version}`}
        id="eventCode"
        name="eventCode"
        label="Event code"
        defaultValue={eventCode}
        placeholder="KGC2027"
        maxLength={32}
        width="sm"
        style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}
        hint="4–32 letters, digits or hyphens. It gets read out loud, so keep it sayable."
      />

      <CheckboxField
        key={`codeRequired-${version}`}
        name="codeRequired"
        label="Require the code to join the event"
        defaultChecked={codeRequired}
      />

      <div style={{ marginTop: 16 }}>
        <SubmitButton>Save</SubmitButton>
      </div>
    </form>
  );
}
