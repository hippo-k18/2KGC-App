"use client";

import { useActionState } from "react";
import { STREAM_PROVIDERS, andList, providerLabel } from "@kgc/shared";
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

/**
 * The sentence naming the tiers that cannot be excluded, and why.
 *
 * Written on the form rather than only in the save message, because the moment
 * an organizer needs it is while they are deciding, not after the decision has
 * been quietly widened underneath them.
 */
function promiseHint(kind: "stream" | "recording", names: string[]): string {
  const thing = kind === "stream" ? "the live stream" : "the recording";
  const base = `Tick nothing for everybody with a ticket. Ticking a tier hides ${thing} from everyone else.`;
  if (names.length === 0) return base;
  const sold = kind === "stream" ? "live streams" : "recordings";
  return `${base} ${andList(names)} ${names.length === 1 ? "is" : "are"} sold ${sold}, so ${names.length === 1 ? "it stays" : "they stay"} in whatever you tick.`;
}

/**
 * What the organizer had typed, carried back through a failed save.
 *
 * ── The bug this exists to stop ─────────────────────────────────────────────
 *
 * React 19 resets an uncontrolled form after a form action runs, so every
 * `defaultValue` below was reapplied when a save was refused — and those come
 * from `existing`, which is either null or the last *stored* value. On a new
 * recording a validation error blanked the link, the length and every ticket
 * tick; on a saved stream it put the stored link back, so a red "that is not a
 * YouTube video link" sat above a box visibly showing a valid YouTube link.
 * Either way the error named something no longer on screen, and the work was
 * gone.
 *
 * Kept on the client rather than returned from the server action. This wrapper
 * runs in the browser, reads the `FormData` it is about to send, and puts it
 * back into the form state only when the save failed — so the action itself is
 * unchanged and nothing that was refused is ever written anywhere.
 *
 * ⚠️ `attempt` is not decoration either. React keeps an uncontrolled input's
 * DOM node across a re-render and ignores a new `defaultValue`, which is the
 * same reason the `version` key exists; a failed save does not change
 * `existing`, so without a counter in the key the fields would keep the values
 * they were reset to.
 */
interface Typed {
  provider?: string;
  state?: string;
  source?: string;
  title?: string;
  duration?: string;
  availableFromLocal?: string;
  availableUntilLocal?: string;
  allowedTicketTypes: string[];
}

type WatchFormState = WatchState & { typed?: Typed; attempt?: number };

function readTyped(data: FormData): Typed {
  const one = (name: string) => {
    const v = data.get(name);
    return typeof v === "string" ? v : undefined;
  };
  return {
    provider: one("provider"),
    state: one("state"),
    source: one("source"),
    title: one("title"),
    duration: one("duration"),
    availableFromLocal: one("availableFromLocal"),
    availableUntilLocal: one("availableUntilLocal"),
    allowedTicketTypes: data
      .getAll("allowedTicketTypes")
      .filter((v): v is string => typeof v === "string"),
  };
}

function keepTyped(save: (prev: WatchState, data: FormData) => Promise<WatchState>) {
  return async (prev: WatchFormState, data: FormData): Promise<WatchFormState> => {
    const typed = readTyped(data);
    const result = await save(prev, data);
    if (result.ok) return result;
    return { ...result, typed, attempt: (prev.attempt ?? 0) + 1 };
  };
}

function TicketTypes({
  legend,
  hint,
  names,
  selected,
  promised,
}: {
  legend: string;
  hint: string;
  names: string[];
  selected: string[];
  /** Tiers that are put back whatever is ticked. Marked on the row too. */
  promised: string[];
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
            label={promised.includes(name) ? `${name} · always included` : name}
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
  promisedNames,
}: {
  sessionId: string;
  existing: StreamRow | null;
  ticketTypeNames: string[];
  /** Tiers whose copy sells a live stream. Always kept in. */
  promisedNames: string[];
}) {
  const bound = saveStreamAction.bind(null, sessionId);
  const [state, action] = useActionState<WatchFormState, FormData>(keepTyped(bound), {});
  const errors = state.fieldErrors ?? {};
  const typed = state.typed;
  const version = `${existing ? existing.watchUrl + existing.state : "none"}-${state.attempt ?? 0}`;

  return (
    <>
      <form action={action}>
        <FormBanner state={state} />

        <FormGrid>
          <Select
            key={`provider-${version}`}
            name="provider"
            label="Where it is hosted"
            defaultValue={typed?.provider ?? existing?.provider ?? "youtube"}
            width="sm"
            options={PROVIDER_OPTIONS}
            hint="Zoom opens outside the app. The others play inside it."
          />
          <Select
            key={`state-${version}`}
            name="state"
            label="Right now"
            defaultValue={typed?.state ?? existing?.state ?? "scheduled"}
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
          defaultValue={typed?.source ?? existing?.source ?? ""}
          error={errors.source}
          placeholder="https://…"
          width="xl"
          hint="Paste the link to the video or the meeting. It is checked before it is saved."
        />

        <TicketTypes
          legend="Who can watch"
          hint={promiseHint("stream", promisedNames)}
          names={ticketTypeNames}
          selected={typed?.allowedTicketTypes ?? existing?.allowedTicketTypes ?? []}
          promised={promisedNames}
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
  promisedNames,
}: {
  sessionId: string;
  sessionTitle: string;
  existing: RecordingRow | null;
  ticketTypeNames: string[];
  /** Tiers whose copy or video-library flag sells replays. Always kept in. */
  promisedNames: string[];
}) {
  const bound = saveRecordingAction.bind(null, sessionId);
  const [state, action] = useActionState<WatchFormState, FormData>(keepTyped(bound), {});
  const errors = state.fieldErrors ?? {};
  const typed = state.typed;
  const version = `${existing ? existing.watchUrl + existing.title : "none"}-${state.attempt ?? 0}`;

  return (
    <>
      <form action={action}>
        <FormBanner state={state} />

        <FormGrid>
          <Select
            key={`rprovider-${version}`}
            name="provider"
            label="Where it is hosted"
            defaultValue={typed?.provider ?? existing?.provider ?? "youtube"}
            width="sm"
            options={PROVIDER_OPTIONS}
          />
          <Field
            key={`rduration-${version}`}
            name="duration"
            label="Length"
            defaultValue={typed?.duration ?? existing?.duration ?? ""}
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
          defaultValue={typed?.source ?? existing?.source ?? ""}
          error={errors.source}
          placeholder="https://…"
          width="xl"
          hint="Paste the link to the recording."
        />

        <Field
          key={`rtitle-${version}`}
          name="title"
          label="Title"
          defaultValue={typed?.title ?? existing?.title ?? ""}
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
            defaultValue={typed?.availableFromLocal ?? existing?.availableFromLocal ?? ""}
            error={errors.availableFromLocal}
            width="sm"
            hint="Blank means as soon as it is saved. Set in UTC, so the date is the same wherever it is read."
          />
          <Field
            key={`runtil-${version}`}
            name="availableUntilLocal"
            label="Available until (UTC)"
            type="datetime-local"
            defaultValue={typed?.availableUntilLocal ?? existing?.availableUntilLocal ?? ""}
            error={errors.availableUntilLocal}
            width="sm"
            hint="Blank means it stays up. Set in UTC, so the date is the same wherever it is read."
          />
        </FormGrid>

        <TicketTypes
          legend="Who can watch"
          hint={promiseHint("recording", promisedNames)}
          names={ticketTypeNames}
          selected={typed?.allowedTicketTypes ?? existing?.allowedTicketTypes ?? []}
          promised={promisedNames}
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
