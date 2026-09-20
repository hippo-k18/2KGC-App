'use client';

import { useActionState, useEffect, useState } from 'react';
import { EVENT_TYPES, EVENT_TYPE_LABEL, type EventSettings, type EventType } from '@kgc/shared';
import {
  CheckboxField,
  Field,
  FormActions,
  FormBanner,
  FormGrid,
  Select,
  SubmitButton,
  type FormState,
} from '../../form';
import { saveBasicsAction } from './actions';

/**
 * The Basics form. `saved` is what is stored, `shown` is what every surface is
 * using right now, so an empty box can say what it falls back to.
 */
export function BasicsForm({
  saved,
  shown,
  sessionsInZone,
}: {
  saved: EventSettings;
  shown: { name: string; shortName: string; timeZone: string; venue: string; startDate: string; endDate: string; eventType: string };
  /** Sessions authored in the current event zone: what "move" would touch. */
  sessionsInZone: number;
}) {
  const [state, action] = useActionState<FormState, FormData>(saveBasicsAction, {});
  const [zone, setZone] = useState(saved.timeZone);
  /* Filled after mount: the server's zone list and the browser's differ, and a mismatch is a hydration error. */
  const [zoneList, setZoneList] = useState<string[]>([]);
  useEffect(() => setZoneList(zones()), []);
  const zoneChanged = (zone.trim() || shown.timeZone) !== shown.timeZone && zone.trim() !== '';

  return (
    <form action={action}>
      <FormBanner state={state} style={{ marginBottom: 12 }} />

      <FormGrid>
        <Field
          name="name"
          label="Event Name"
          defaultValue={saved.name}
          placeholder={shown.name}
          maxLength={120}
          width="xl"
          error={state.fieldErrors?.name}
        />
        <Field
          name="shortName"
          label="Short name"
          defaultValue={saved.shortName}
          placeholder={shown.shortName}
          maxLength={20}
          width="sm"
          error={state.fieldErrors?.shortName}
          hint="Used in page titles and in the app."
        />
      </FormGrid>

      <FormGrid>
        <Field
          name="startDate"
          label="Start Date"
          type="date"
          defaultValue={saved.startDate}
          width="sm"
          error={state.fieldErrors?.startDate}
        />
        <Field
          name="endDate"
          label="End Date"
          type="date"
          defaultValue={saved.endDate}
          width="sm"
          error={state.fieldErrors?.endDate}
        />
      </FormGrid>

      <Field
        name="timeZone"
        label="Time zone"
        value={zone}
        onChange={(e) => setZone(e.target.value)}
        placeholder={shown.timeZone}
        list="basics-zones"
        autoComplete="off"
        width="lg"
        error={state.fieldErrors?.timeZone}
        hint="Session times are entered in this zone. Use a name like America/New_York."
      />
      <datalist id="basics-zones">
        {zoneList.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>

      {zoneChanged && sessionsInZone > 0 ? (
        <CheckboxField
          name="moveSessions"
          label={`Move the ${sessionsInZone} existing session${sessionsInZone === 1 ? '' : 's'} to this time zone`}
          description="Each session keeps its clock time, for example 09:00, read in the new zone. Leave this off to change the zone for new sessions only."
        />
      ) : null}

      <Field
        name="venue"
        label="Location / Venue"
        defaultValue={saved.venue}
        placeholder={shown.venue}
        maxLength={200}
        width="xl"
        error={state.fieldErrors?.venue}
      />

      <Select
        name="eventType"
        label="Event type"
        width="sm"
        defaultValue={saved.eventType}
        placeholder={`Not set (${EVENT_TYPE_LABEL[shown.eventType as EventType] ?? shown.eventType})`}
        options={EVENT_TYPES.map((t) => ({ value: t, label: EVENT_TYPE_LABEL[t].replace(' event', '') }))}
        error={state.fieldErrors?.eventType}
      />

      <FormActions>
        <SubmitButton>Save</SubmitButton>
      </FormActions>
    </form>
  );
}

/** The browser's own zone list, where it has one. */
function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}
