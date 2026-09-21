'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveAdminSettingsAction, type AdminSettingsState } from './actions';

/** Its own component because `useFormStatus` only reports the form above it. */
function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main primary" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

export function AdminSettingsForm({
  attendeeListVisible,
  contactSharingEnabled,
  attendeeMessagingEnabled,
  staffNote,
}: {
  attendeeListVisible: boolean;
  contactSharingEnabled: boolean;
  attendeeMessagingEnabled: boolean;
  staffNote: string;
}) {
  const [state, action] = useActionState<AdminSettingsState, FormData>(saveAdminSettingsAction, {});

  return (
    <form action={action}>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-row">
        <label className="whova-form-label">Attendee-facing</label>
        <label style={{ display: 'block' }}>
          <input
            type="checkbox"
            name="attendeeListVisible"
            defaultChecked={attendeeListVisible}
          />{' '}
          Attendees can browse the attendee list
        </label>
        <label style={{ display: 'block' }}>
          <input
            type="checkbox"
            name="contactSharingEnabled"
            defaultChecked={contactSharingEnabled}
          />{' '}
          Attendees can share contact details with each other
        </label>
        <label style={{ display: 'block' }}>
          <input
            type="checkbox"
            name="attendeeMessagingEnabled"
            defaultChecked={attendeeMessagingEnabled}
          />{' '}
          Attendees can message each other
        </label>
        {/*
          The third box is the only one of the three with an effect, and the
          note says which is which rather than covering all three with one
          sentence. Hiding the attendee list would have to overrule each
          attendee's own directory choice, which is a decision nobody has
          taken; refusing a message is a rule about one collection, so it is
          one the rules can hold.
        */}
        <p className="muted" style={{ fontSize: 12 }}>
          Messaging takes effect in the app straight away. The first two are saved and do not
          change what attendees see yet.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="staffNote">
          Check-in staff
        </label>
        {/*
          Free text rather than a picker. There is no staff role to pick from —
          console access is an env var — and a dropdown listing people it cannot
          actually grant anything to would imply a permission system that does
          not exist.
        */}
        <input
          className="whova-text-input"
          id="staffNote"
          name="staffNote"
          defaultValue={staffNote}
          maxLength={300}
          placeholder="Who is on the desk, and when"
          style={{ maxWidth: 520, width: '100%' }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          Shown at the top of Attendee Check-in.
        </p>
      </div>

      <SaveButton />
    </form>
  );
}
