'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveEmergencyPlanAction, type EmergencyState } from './actions';

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

function Field({
  name,
  label,
  help,
  defaultValue,
  placeholder,
  width = 420,
}: {
  name: string;
  label: string;
  help?: string;
  defaultValue: string;
  placeholder?: string;
  width?: number;
}) {
  return (
    <div className="whova-form-group">
      <label className="whova-form-label" htmlFor={name}>
        {label}
      </label>
      {help ? <p className="whova-form-helper-text">{help}</p> : null}
      <input
        id={name}
        name={name}
        className="whova-text-input"
        defaultValue={defaultValue}
        placeholder={placeholder}
        style={{ maxWidth: width }}
      />
    </div>
  );
}

export interface EmergencyPlan {
  emergencyNumber: string;
  venueSecurity: string;
  medicalPoint: string;
  assemblyPoint: string;
  onSiteLead: string;
  onSiteLeadPhone: string;
  incidentProcedure: string;
  planReady: boolean;
}

export function EmergencyForm({ plan }: { plan: EmergencyPlan }) {
  const [state, action] = useActionState<EmergencyState, FormData>(saveEmergencyPlanAction, {});

  return (
    <form action={action}>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      <Field
        name="emergencyNumber"
        label="Emergency services"
        help="The number anyone on the team should call first. New York City is 911."
        defaultValue={plan.emergencyNumber}
        placeholder="911"
        width={200}
      />
      <Field
        name="venueSecurity"
        label="Venue security"
        help="Cornell Tech campus security — the people who can unlock a door or meet an ambulance at the right entrance."
        defaultValue={plan.venueSecurity}
        placeholder="Cornell Tech security — (607) 000-0000"
      />
      <Field
        name="medicalPoint"
        label="First aid point"
        help="Where the kit is and who is trained. Written as a place a stranger could find."
        defaultValue={plan.medicalPoint}
        placeholder="Registration desk, Bloomberg Center ground floor"
      />
      <Field
        name="assemblyPoint"
        label="Evacuation assembly point"
        help="Where everyone goes if the building is evacuated. This is the single most useful line on the card."
        defaultValue={plan.assemblyPoint}
        placeholder="The lawn outside the Tata Innovation Center"
      />
      <Field
        name="onSiteLead"
        label="On-site lead"
        help="One named person who decides. Not a team address."
        defaultValue={plan.onSiteLead}
        placeholder="Name, role"
      />
      <Field
        name="onSiteLeadPhone"
        label="On-site lead — phone"
        defaultValue={plan.onSiteLeadPhone}
        placeholder="Mobile, reachable during sessions"
        width={260}
      />

      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="incidentProcedure">
          What to do
        </label>
        <p className="whova-form-helper-text">
          The short version somebody reads while something is happening: who to tell, what not to
          say to press, where the code of conduct escalation goes.
        </p>
        <textarea
          id="incidentProcedure"
          name="incidentProcedure"
          className="whova-text-input"
          rows={7}
          defaultValue={plan.incidentProcedure}
          style={{ maxWidth: 680 }}
        />
      </div>

      <div className="whova-form-group">
        <label style={{ display: 'block' }}>
          <input type="checkbox" name="planReady" defaultChecked={plan.planReady} /> This plan has
          been reviewed and is ready for the event
        </label>
      </div>

      <SaveButton />
    </form>
  );
}
