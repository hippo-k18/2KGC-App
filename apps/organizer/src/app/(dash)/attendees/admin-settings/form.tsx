'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveAdminSettingsAction, type AdminSettingsState } from './actions';

/** Its own component because `useFormStatus` only reports the form above it. */
function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

export function AdminSettingsForm({
  attendeeListVisible,
  contactSharingEnabled,
  staffNote,
}: {
  attendeeListVisible: boolean;
  contactSharingEnabled: boolean;
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
        <p className="muted" style={{ fontSize: 12 }}>
          Recorded, and read back by this screen only. The app decides both of these for itself
          today — see the banner above before promising either to anybody.
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
          id="staffNote"
          name="staffNote"
          defaultValue={staffNote}
          maxLength={300}
          placeholder="Who is on the desk, and when"
          style={{ maxWidth: 520, width: '100%' }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          A note, not a permission. Anyone who can open this dashboard can already scan.
        </p>
      </div>

      <SaveButton />
    </form>
  );
}
