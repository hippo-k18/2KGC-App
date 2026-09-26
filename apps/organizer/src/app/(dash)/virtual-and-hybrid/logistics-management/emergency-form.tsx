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
        defaultValue={plan.emergencyNumber}
        placeholder="911"
        width={200}
      />
      <Field
        name="venueSecurity"
        label="Venue security"
        defaultValue={plan.venueSecurity}
        placeholder="Name and phone"
      />
      <Field
        name="medicalPoint"
        label="First aid point"
        defaultValue={plan.medicalPoint}
        placeholder="Where the kit is"
      />
      <Field
        name="assemblyPoint"
        label="Evacuation assembly point"
        defaultValue={plan.assemblyPoint}
        placeholder="Where to gather outside"
      />
      <Field
        name="onSiteLead"
        label="On-site lead"
        defaultValue={plan.onSiteLead}
        placeholder="Name, role"
      />
      <Field
        name="onSiteLeadPhone"
        label="On-site lead: phone"
        defaultValue={plan.onSiteLeadPhone}
        placeholder="Mobile"
        width={260}
      />

      <div className="whova-form-group">
        <label className="whova-form-label" htmlFor="incidentProcedure">
          What to do
        </label>
        <p className="whova-form-helper-text">
          Short steps to read during an incident: who to tell and who speaks to press.
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
        <label className="whova-checkbox-label">
          <input
            className="whova-checkbox-input"
            type="checkbox"
            name="planReady"
            defaultChecked={plan.planReady}
          />
          <span>This plan has been reviewed and is ready for the event</span>
        </label>
      </div>

      <SaveButton />
    </form>
  );
}
