"use client";

import { useActionState } from "react";
import { STREAM_PROVIDERS, providerLabel } from "@kgc/shared";
import type { RecordingRow, StreamRow } from "@/lib/streaming";
import {
  CheckboxField,
  ConfirmButton,
  Field,
  FieldSet,
  FormActions,
  FormBanner,
  FormGrid,
  Select,
  SubmitButton,
} from "../../../form";
import {
  removeRecordingAction,
  removeStreamAction,
  saveRecordingAction,
  saveStreamAction,
  type WatchState,
} from "./watch-actions";

/**
 * The stream and the recording for one session.
 *
 * Two forms rather than one, because they are two documents with two lives: the
 * stream is set up the week before and switched off afterwards, the recording
 * is attached days later. One form would make saving a recording touch the
 * stream, and the first thing anybody would do with it is accidentally clear
 * one while editing the other.
 *
 * Both are keyed on the stored document so a save re-renders with what
 * Firestore actually holds — the same trick and the same reason as
 * `SessionFormValues.version`: React keeps an uncontrolled input's DOM node and
 * ignores a new `defaultValue`, so without the key the form goes on showing the
 * old link beside a green "Saved".
 */

const PROVIDER_OPTIONS = STREAM_PROVIDERS.map((p) => ({
  value: p,
  label: providerLabel(p),
}));

function TicketTypes({
  legend,
  hint,
  names,
  selected,
}: {
  legend: string;
  hint: string;
  names: string[];
  selected: string[];
}) {
  return (
    <FieldSet legend={legend} hint={hint}>
      {names.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          No ticket types have been entered, so there is nothing to restrict
          this to yet.
        </p>
      ) : (
        names.map((name) => (
          <CheckboxField
            key={name}
            name="allowedTicketTypes"
            value={name}
            label={name}
            defaultChecked={selected.includes(name)}
          />
        ))
      )}
    </FieldSet>
  );
}

export function StreamForm({
  sessionId,
  existing,
  ticketTypeNames,
}: {
  sessionId: string;
  existing: StreamRow | null;
  ticketTypeNames: string[];
}) {
  const bound = saveStreamAction.bind(null, sessionId);
  const [state, action] = useActionState<WatchState, FormData>(bound, {});
  const errors = state.fieldErrors ?? {};
  const version = existing ? existing.watchUrl + existing.state : "none";

  return (
    <>
      <form action={action}>
        <FormBanner state={state} />

        <FormGrid>
          <Select
            key={`provider-${version}`}
            name="provider"
            label="Where it is hosted"
            defaultValue={existing?.provider ?? "youtube"}
            width="sm"
            options={PROVIDER_OPTIONS}
            hint="Zoom opens outside the app. The others play inside it."
          />
          <Select
            key={`state-${version}`}
            name="state"
            label="Right now"
            defaultValue={existing?.state ?? "scheduled"}
            width="sm"
            options={[
              { value: "scheduled", label: "Starting later" },
              { value: "live", label: "On now" },
              { value: "ended", label: "Finished" },
            ]}
            hint="This is what the agenda shows. Nothing changes it automatically."
          />
        </FormGrid>

        <Field
          key={`source-${version}`}
          name="source"
          label="Link"
          required
          defaultValue={existing?.source ?? ""}
          error={errors.source}
          placeholder="https://…"
          width="xl"
          hint="Paste the link to the video or the meeting. It is checked before it is saved."
        />

        <TicketTypes
          legend="Who can watch"
          hint="Tick nothing for everybody with a ticket. Ticking a tier hides the link from everyone else."
          names={ticketTypeNames}
          selected={existing?.allowedTicketTypes ?? []}
        />

        <FormActions>
          <SubmitButton pendingLabel="Saving…">
            {existing ? "Save stream" : "Add stream"}
          </SubmitButton>
        </FormActions>
      </form>

      {/*
        Outside the form above, not inside it. `ConfirmButton` is itself a
        `<form>`, and a nested one is invalid HTML that React reports as a
        hydration error and browsers resolve by dropping the inner element —
        so the remove button would have submitted the save action instead.
      */}
      {existing ? (
        <div style={{ marginTop: 4 }}>
          <ConfirmButton
            action={removeStreamAction.bind(null, sessionId)}
            label="Remove the stream"
            confirmLabel="Remove it"
            width={260}
          >
            The link comes off this session and the agenda stops showing it as
            streaming. The recording, if there is one, stays.
          </ConfirmButton>
        </div>
      ) : null}
    </>
  );
}

export function RecordingForm({
  sessionId,
  sessionTitle,
  existing,
  ticketTypeNames,
  videoLibraryNames,
}: {
  sessionId: string;
  sessionTitle: string;
  existing: RecordingRow | null;
  ticketTypeNames: string[];
  /** Tiers whose bullets promise a video library. Always kept in. */
  videoLibraryNames: string[];
}) {
  const bound = saveRecordingAction.bind(null, sessionId);
  const [state, action] = useActionState<WatchState, FormData>(bound, {});
  const errors = state.fieldErrors ?? {};
  const version = existing ? existing.watchUrl + existing.title : "none";

  return (
    <>
      <form action={action}>
        <FormBanner state={state} />

        <FormGrid>
          <Select
            key={`rprovider-${version}`}
            name="provider"
            label="Where it is hosted"
            defaultValue={existing?.provider ?? "youtube"}
            width="sm"
            options={PROVIDER_OPTIONS}
          />
          <Field
            key={`rduration-${version}`}
            name="duration"
            label="Length"
            defaultValue={existing?.duration ?? ""}
            error={errors.duration}
            placeholder="45:30"
            width="sm"
            hint="Optional. 45, 45:30 or 1:05:30."
          />
        </FormGrid>

        <Field
          key={`rsource-${version}`}
          name="source"
          label="Link"
          required
          defaultValue={existing?.source ?? ""}
          error={errors.source}
          placeholder="https://…"
          width="xl"
          hint="Paste the link to the recording."
        />

        <Field
          key={`rtitle-${version}`}
          name="title"
          label="Title"
          defaultValue={existing?.title ?? ""}
          placeholder={sessionTitle}
          width="xl"
          maxLength={200}
          hint="What the library lists it as. Leave it blank to use the session title."
        />

        {/*
        Both dates are UTC, and the labels say so. An availability window is a
        contractual date rather than a moment in the room — "the library closes
        on 31 December" — so it must not depend on where the dashboard runs.
      */}
        <FormGrid>
          <Field
            key={`rfrom-${version}`}
            name="availableFromLocal"
            label="Available from (UTC)"
            type="datetime-local"
            defaultValue={existing?.availableFromLocal ?? ""}
            error={errors.availableFromLocal}
            width="sm"
            hint="Blank means as soon as it is saved."
          />
          <Field
            key={`runtil-${version}`}
            name="availableUntilLocal"
            label="Available until (UTC)"
            type="datetime-local"
            defaultValue={existing?.availableUntilLocal ?? ""}
            error={errors.availableUntilLocal}
            width="sm"
            hint="Blank means it stays up."
          />
        </FormGrid>

        <TicketTypes
          legend="Who can watch"
          hint={
            videoLibraryNames.length
              ? `Tick nothing for everybody with a ticket. ${videoLibraryNames.join(" and ")} ${videoLibraryNames.length === 1 ? "was" : "were"} sold a video library, so ${videoLibraryNames.length === 1 ? "it stays" : "they stay"} in whatever you tick.`
              : "Tick nothing for everybody with a ticket. Ticking a tier hides the recording from everyone else."
          }
          names={ticketTypeNames}
          selected={existing?.allowedTicketTypes ?? []}
        />

        <FormActions>
          <SubmitButton pendingLabel="Saving…">
            {existing ? "Save recording" : "Add recording"}
          </SubmitButton>
        </FormActions>
      </form>

      {existing ? (
        <div style={{ marginTop: 4 }}>
          <ConfirmButton
            action={removeRecordingAction.bind(null, sessionId)}
            label="Remove the recording"
            confirmLabel="Remove it"
            width={260}
          >
            The recording comes off this session. The stream, if there is one,
            stays.
          </ConfirmButton>
        </div>
      ) : null}
    </>
  );
}
