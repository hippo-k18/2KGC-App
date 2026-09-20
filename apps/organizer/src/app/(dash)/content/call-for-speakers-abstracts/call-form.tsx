'use client';

import { useActionState } from 'react';
import type { TrackOption } from '@/lib/data';
import type { CallRow } from '@/lib/calls';
import {
  CheckboxField,
  Field,
  FieldSet,
  FormActions,
  FormBanner,
  FormGrid,
  Select,
  SubmitButton,
  Textarea,
  dateTimeValue,
  type FormState,
} from '../../form';
import { saveCallAction } from './actions';

/**
 * Setting up a call for abstracts.
 *
 * ── The two dates are the only fields here that enforce anything ────────────
 *
 * Everything else on this form is copy or configuration. `opensAtLocal` and
 * `closesAtLocal` decide who is allowed to submit, and they do it in the public
 * portal's server action rather than in a rule — `calls` and `submissions` have
 * no `match` block in `firestore.rules`, so there is nothing underneath to
 * catch a write the screen let through. The hint under the closing date says so
 * in the organizer's terms: moving it forward closes the call for everybody
 * immediately, including somebody who has the form open.
 *
 * ── Blind review defaults to single-blind, and the schema does not assume it ─
 *
 * `CFA-PLAN.md` §1.1. KGC is an applied-industry conference where affiliation is
 * often load-bearing, so hiding it by default would make the reviewing worse —
 * but the author lives in `submissions/{id}/identity` whichever mode is chosen,
 * so turning the blind up later is a decision about which document a screen
 * loads rather than a migration of every submission ever written.
 */
export function CallForm({
  existing,
  tracks,
}: {
  existing?: CallRow;
  tracks: TrackOption[];
}) {
  const [state, action] = useActionState<FormState, FormData>(saveCallAction, {});

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <FormBanner state={state} />

      <Field
        label="Title"
        name="title"
        required
        maxLength={120}
        defaultValue={existing?.title}
        placeholder="Call for talks and posters. KGC 2027"
        hint="What people read at the top of the public page, and what the acknowledgement email calls it."
        width="xl"
      />

      <Textarea
        label="Instructions"
        name="instructions"
        rows={8}
        defaultValue={existing?.instructions}
        placeholder={
          'What are you asking for, and what will happen to it?\n\nBlank lines separate paragraphs. Plain text only.'
        }
        hint="Plain text; blank lines separate paragraphs. Say how long an abstract should be and how many reviewers will read it."
      />

      <FormGrid>
        <Field
          label="Opens"
          name="opensAtLocal"
          type="datetime-local"
          required
          defaultValue={dateTimeValue(existing?.opensAtLocal)}
          hint="Local time in the event's timezone."
          width="lg"
        />
        <Field
          label="Closes"
          name="closesAtLocal"
          type="datetime-local"
          required
          defaultValue={dateTimeValue(existing?.closesAtLocal)}
          hint="Moving the deadline back closes the call for everybody the moment you save."
          width="lg"
        />
      </FormGrid>

      <FormGrid>
        <Select
          label="Status"
          name="status"
          defaultValue={existing?.status ?? 'draft'}
          width="lg"
          options={[
            { value: 'draft', label: 'Draft: the public page 404s' },
            { value: 'published', label: 'Published: open between the dates above' },
            { value: 'cancelled', label: 'Cancelled: withdrawn, refuses everything' },
          ]}
          hint="A draft call has no public page, so its address can be shared before it opens."
        />
        <Select
          label="What reviewers see"
          name="blindReview"
          defaultValue={existing?.blindReview ?? 'single-blind'}
          width="lg"
          options={[
            { value: 'open', label: 'Open: reviewer and author both named' },
            { value: 'single-blind', label: 'Single-blind: reviewers see the author' },
            { value: 'double-blind', label: 'Double-blind: the author is hidden' },
          ]}
          hint="Decides what reviewers see. It can be changed later."
        />
      </FormGrid>

      <FieldSet
        legend="Session types"
        hint="What a submitter can offer the work as. An accepted submission carries this onto the agenda."
        inline
      >
        {(['keynote', 'talk', 'panel', 'workshop', 'poster', 'social'] as const).map((f) => (
          <CheckboxField
            key={f}
            name="sessionTypes"
            value={f}
            label={f}
            defaultChecked={existing ? existing.sessionTypes.includes(f) : f === 'talk' || f === 'poster'}
          />
        ))}
      </FieldSet>

      <FieldSet
        legend="Tracks"
        hint={
          tracks.length === 0
            ? 'No tracks have been entered for this event yet, so a submitter cannot be asked to choose one. Add them in Track Manager.'
            : 'Offered to the submitter, and what reviewer assignment by topic matches on.'
        }
        inline
      >
        {tracks.map((t) => (
          <CheckboxField
            key={t.id}
            name="trackIds"
            value={t.id}
            label={t.name}
            defaultChecked={existing?.trackIds.includes(t.id) ?? false}
          />
        ))}
      </FieldSet>

      <FormGrid>
        <Field
          label="Reviews per submission"
          name="reviewsPerSubmission"
          type="number"
          min={1}
          max={10}
          defaultValue={existing?.reviewsPerSubmission ?? 3}
          hint="The target assignment by track aims at. Three is the usual answer."
          width="sm"
        />
        <Field
          label="Nudge incomplete submitters at"
          name="reminderDaysBefore"
          defaultValue={(existing?.reminderDaysBefore ?? [14, 7, 3]).join(', ')}
          placeholder="14, 7, 3"
          hint="Days before the deadline. Reminders are not sent on their own. On these days the dashboard offers you a send button."
          width="lg"
        />
      </FormGrid>

      <Textarea
        label="Tell these addresses about each submission"
        name="notifyEmails"
        rows={3}
        defaultValue={(existing?.notifyEmails ?? []).join('\n')}
        placeholder={'programme@knowledgegraph.tech\nchair@knowledgegraph.tech'}
        hint="One per line, or separated by commas. Empty means nobody is told."
      />

      <FormActions>
        <SubmitButton>{existing ? 'Save call' : 'Create call'}</SubmitButton>
      </FormActions>
    </form>
  );
}
