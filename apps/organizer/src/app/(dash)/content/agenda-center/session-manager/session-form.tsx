'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { RoomOption, SpeakerOption, TrackOption } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import {
  DateTimeField,
  Field,
  FormActions,
  FormBanner,
  FormGrid,
  Select,
  SubmitButton,
  Textarea,
} from '../../../form';
import { createSessionAction, saveSessionAction, type SessionState } from './actions';
import { OrderedPicker } from './ordered-picker';
import { SESSION_FORMATS, SESSION_STATUSES, SKILL_LEVELS } from './session-core';

export interface SessionFormValues {
  /** Absent in create mode. */
  id?: string;
  title: string;
  description: string;
  roomId: string;
  startsAtLocal: string;
  endsAtLocal: string;
  status: string;
  format: string;
  skillLevel: string;
  /** A string because it is an `<input>` value; blank means uncapped. */
  capacity: string;
  speakerIds: string[];
  trackIds: string[];
  timeZone: string;
  /**
   * `updatedAt` in millis, and 0 in create mode. Used as the `key` on every
   * field.
   *
   * Without it the form lies to you. A server action revalidates the route, so
   * the page re-renders with the saved document — but React keeps the DOM node
   * of an uncontrolled input and ignores the new `defaultValue`, so the room
   * dropdown carries on displaying the old room next to a green "Saved." The
   * organizer reads that as a failed save and tries again. Re-keying on the
   * document version remounts the fields with the values Firestore actually
   * holds, and because only the fields remount, the result message survives.
   *
   * It matters twice over for the two pickers below, which hold their rows in
   * `useState` — without a remount those would go on showing the pre-save
   * speaker order for ever.
   */
  version: number;
}

/**
 * Whova's Edit Session modal, as a page, and now also as a create page.
 *
 * The field order and the labels are Whova's: Title, Date, Time (two inputs with
 * a literal `TO` between them), Location, Description, Tracks, Speakers. Ours
 * collapses Date and Time into two `datetime-local` inputs because that
 * control's value format is exactly the `YYYY-MM-DDTHH:mm` wall clock the model
 * already stores, so nothing is parsed or reformatted on the way in or out and
 * the browser's own timezone never enters it. `startsAt`, `endsAt` and `day`
 * are derived from these strings **on the server**, by the same `deriveTimes()`
 * the seed and the importer use; no control here can set them.
 *
 * A page rather than a modal because a session edit is the one thing in this
 * console that is worth a URL — "look at this session" is a message people send
 * each other on the morning of the conference.
 *
 * ── Which fields exist, and which deliberately do not ───────────────────────
 *
 * Every control here has a reader on the other side: `format` is a pill on the
 * agenda card and the public agenda and decides whether Conflict Check expects a
 * speaker; `skillLevel` is a tag on the public agenda; `capacity` is what
 * Attendees › Session Cap compares against the room and what raises the
 * over-capacity warning; `speakerIds` and `trackIds` drive the app's speaker
 * sheet and its track filter chips.
 *
 * `tags`, `slidesUrl` and `seriesId` get no control, and that is the same test
 * applied honestly: nothing in the app, the website or this dashboard reads any
 * of the three. A box that saves a value nobody will ever render is a box that
 * lies about what it does.
 */
export function SessionForm({
  values,
  rooms,
  tracks,
  speakers,
}: {
  values: SessionFormValues;
  rooms: RoomOption[];
  tracks: TrackOption[];
  speakers: SpeakerOption[];
}) {
  const creating = !values.id;
  const bound = creating ? createSessionAction : saveSessionAction.bind(null, values.id!);
  const [state, action] = useActionState<SessionState, FormData>(bound, {});
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action}>
      <FormBanner state={state} />

      {state.createdId ? (
        <p style={{ fontSize: 14 }}>
          <Link href={`${ROUTES.sessionManager}/${state.createdId}`}>
            Open “{values.title || 'the new session'}” →
          </Link>{' '}
          <span className="muted">
            Anything else it needs — Q&amp;A and polls, a longer description — is on that page.
          </span>
        </p>
      ) : null}

      <Field
        key={`title-${values.version}`}
        name="title"
        label="Title"
        required
        defaultValue={values.title}
        error={errors.title}
        width="xl"
        maxLength={200}
        hint={
          creating
            ? 'The id is derived from the title and the start time, so a re-import of the same programme updates this session rather than duplicating it.'
            : undefined
        }
      />

      {/*
        `DateTimeField` rather than a bare `Field`, for the trimming: the control
        renders **blank** for any value that is not exactly `YYYY-MM-DDTHH:mm`
        and says nothing about it, which is how an editor ends up showing an
        empty date over a document that has one.
      */}
      <FormGrid>
        <DateTimeField
          key={`starts-${values.version}`}
          name="startsAtLocal"
          label="Starts"
          required
          defaultValue={values.startsAtLocal}
          error={errors.startsAtLocal}
          timeZoneNote={values.timeZone}
        />
        <DateTimeField
          key={`ends-${values.version}`}
          name="endsAtLocal"
          label="Ends"
          required
          defaultValue={values.endsAtLocal}
          error={errors.endsAtLocal}
          timeZoneNote={values.timeZone}
        />
      </FormGrid>

      <Select
        key={`room-${values.version}`}
        name="roomId"
        label="Location"
        defaultValue={values.roomId}
        placeholder="— no room —"
        width="lg"
        options={rooms.map((r) => ({ value: r.id, label: r.name }))}
        hint={
          <>
            ⚠️ The attendee app cannot read the <code>rooms</code> collection — there is no rules
            block for it — so the room <em>name</em> copied onto this session is the only thing
            telling somebody which door to walk to. Leaving this blank leaves them with nothing.
          </>
        }
      />

      <OrderedPicker
        key={`tracks-${values.version}`}
        name="trackIds"
        legend="Tracks"
        options={tracks.map((t) => ({ value: t.id, label: t.name }))}
        defaultValue={values.trackIds}
        addLabel="Add a track"
        firstBadge="primary"
        emptyNote="Not in any track. It will still appear on the agenda, without a coloured tag."
        hint={
          <>
            A talk can be cross-listed, but only the <strong>first</strong> track is shown on the
            agenda card — its name and colour are copied onto this session when you save.
          </>
        }
      />

      <OrderedPicker
        key={`speakers-${values.version}`}
        name="speakerIds"
        legend="Speakers"
        options={speakers.map((s) => ({
          value: s.id,
          label: s.company ? `${s.name} — ${s.company}` : s.name,
        }))}
        defaultValue={values.speakerIds}
        addLabel="Add a speaker"
        emptyNote="Nobody assigned yet."
        hint="In billing order — first author first. The order you set here is the order printed on the agenda and read out on the phone, so it is not sorted for you."
      />

      <FormGrid>
        <Select
          key={`format-${values.version}`}
          name="format"
          label="Format"
          required
          defaultValue={values.format}
          error={errors.format}
          width="sm"
          options={SESSION_FORMATS.map((f) => ({ value: f, label: f }))}
          hint="Shown as a pill on the agenda. Conflict Check expects a speaker on everything except a social."
        />
        <Select
          key={`skill-${values.version}`}
          name="skillLevel"
          label="Level"
          defaultValue={values.skillLevel}
          error={errors.skillLevel}
          placeholder="— not stated —"
          width="sm"
          options={SKILL_LEVELS.map((s) => ({ value: s, label: s }))}
          hint="A tag on the public agenda."
        />
        <Field
          key={`capacity-${values.version}`}
          name="capacity"
          label="Capacity"
          type="number"
          min={1}
          defaultValue={values.capacity}
          error={errors.capacity}
          placeholder="Uncapped"
          width="sm"
          hint={
            <>
              ⚠️ A <strong>stated intent, not a limit</strong>. Nothing counts attendees into a
              session and nothing turns anyone away — saving one to your schedule is a private
              bookmark. It feeds the over-capacity warning on Conflict Check and the comparison on
              Attendees › Session Cap, and that is all it does.
            </>
          }
        />
      </FormGrid>

      <Select
        key={`status-${values.version}`}
        name="status"
        label="Status"
        required
        defaultValue={values.status}
        error={errors.status}
        width="lg"
        options={SESSION_STATUSES.map((s) => ({
          value: s,
          label:
            s === 'draft'
              ? 'draft — hidden from attendees'
              : s === 'cancelled'
                ? 'cancelled — still visible, marked cancelled'
                : 'published',
        }))}
        hint="There is no delete. Attendees have this saved and Firestore has no cascade, so removing a session from the programme is a status change."
      />

      <Textarea
        key={`description-${values.version}`}
        name="description"
        label="Description"
        rows={8}
        defaultValue={values.description}
      />

      {state.pushNote ? <p className="whova-form-description">{state.pushNote}</p> : null}

      <FormActions>
        <Link className="whova-btn-main secondary" href={ROUTES.sessionManager}>
          Cancel
        </Link>
        <SubmitButton pendingLabel={creating ? 'Creating…' : 'Saving…'}>
          {creating ? 'Create session' : 'Save'}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
