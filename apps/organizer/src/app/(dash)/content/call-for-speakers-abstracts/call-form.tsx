'use client';

import { useState, type FormEvent } from 'react';
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
import { AGENDA_SESSION_TYPES, CFP_SESSION_TYPES, typeLabel } from '@kgc/scripts/src/lib/cfp-core';
import { saveCallAction } from './actions';
import { InstructionsEditor } from './instructions-editor';
import { callTextFromPlain } from '@kgc/shared';

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
  const [state, setState] = useState<FormState>({});
  const [pending, setPending] = useState(false);

  /*
   * ── Why this form does not use `useActionState` (T284) ─────────────────────
   *
   * With `<form action>`, "Saving…" and the result banner are part of the same
   * React transition as the page the server sends back after `revalidatePath`.
   * That re-render reads RSC chunks that are still being decoded, and in React
   * 19.2 (as bundled by Next 15.5) one ordering loses the retry: the chunk
   * resolves synchronously inside React's ping listener while the render is in
   * its "suspended with delay" state, the ping is dropped, and the transition
   * never commits. The save itself had worked, but the button said "Saving…"
   * for ever. It happened on about a third of saves that changed "Show on
   * website", more often when link prefetches were in flight at the click.
   *
   * So the result is set here, outside any transition, as soon as the action
   * returns. The server still revalidates, and the refreshed page commits on
   * its own when React gets to it; nothing on this form waits for it. Without
   * an `action` prop React also no longer resets the form after a save, so the
   * fields keep what was just saved rather than the defaults they loaded with.
   */
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    setPending(true);
    try {
      const result = await saveCallAction({}, new FormData(form));
      setState(result);
      // A new call: clear the form, as the reset after a form action used to.
      if (result.ok && !existing) form.reset();
    } catch (err) {
      // A redirect (an expired session) is the router's to follow.
      if (String((err as { digest?: unknown })?.digest ?? '').startsWith('NEXT_REDIRECT')) throw err;
      setState({ error: 'Could not save the call. Check your connection and try again.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <FormBanner state={state} />

      <Field
        label="Title"
        name="title"
        required
        maxLength={120}
        defaultValue={existing?.title}
        hint="What people read at the top of the public page, and what the acknowledgement email calls it."
        width="xl"
      />

      <InstructionsEditor
        initial={existing?.instructionsDoc ?? callTextFromPlain('')}
        hint="What people read above the form. Use the toolbar for headings, bold, italics, lists and links. [CLOSE DATE] and [DECISION DATE] are filled in from the call's dates."
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

      <ShowOnWebsite existing={existing} />

      {/*
        A call for speakers offers the owner's six types (T276); any other call
        offers the agenda's own formats, as before.
      */}
      <FieldSet
        legend="Session types"
        hint="What a submitter can offer the work as. An accepted submission carries this onto the agenda."
        inline
      >
        {(existing?.isCfp
          ? CFP_SESSION_TYPES.map((t) => ({ id: t.id, label: t.label }))
          : AGENDA_SESSION_TYPES.map((f) => ({ id: f, label: typeLabel(f) }))
        ).map((t) => (
          <CheckboxField
            key={t.id}
            name="sessionTypes"
            value={t.id}
            label={t.label}
            defaultChecked={existing ? existing.sessionTypes.includes(t.id) : t.id === 'talk' || t.id === 'poster'}
          />
        ))}
      </FieldSet>

      {existing?.isCfp && (
        <FieldSet legend="Questions on the form" inline>
          <input type="hidden" name="cfpSwitches" value="1" />
          <CheckboxField name="askTrack" value="1" label="Ask for a track" defaultChecked={existing.askTrack} />
          <CheckboxField
            name="askTalkLength"
            value="1"
            label="Ask talk length"
            defaultChecked={existing.askTalkLength}
          />
        </FieldSet>
      )}

      <FieldSet
        legend="Tracks"
        hint={
          tracks.length === 0
            ? 'No tracks have been entered for this event yet. Add them in Track Manager, or tick Other so submitters can type a topic.'
            : 'Offered to the submitter, and what reviewer assignment by topic matches on. Other lets them type a topic of their own.'
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
        <CheckboxField
          name="allowOtherTrack"
          value="1"
          label="Other"
          defaultChecked={existing?.allowOtherTrack ?? false}
        />
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
        hint="One per line, or separated by commas. Empty means nobody is told."
      />

      <FormActions>
        <SubmitButton pending={pending}>{existing ? 'Save call' : 'Create call'}</SubmitButton>
      </FormActions>
    </form>
  );
}

/**
 * "Show on website" (T277): the Apply to speak button in the site header,
 * beside Register now. Separate from Status so a call can be published and
 * shared by link before it is promoted on every page.
 */
function ShowOnWebsite({ existing }: { existing?: CallRow }) {
  return (
    <FieldSet
      legend="Website"
      hint="Adds an Apply to speak button next to Register now in the website header, and points the footer's Speak at KGC link here. Shown only while the call is published and has not closed. One call at a time: turning this on turns it off for any other call."
    >
      <CheckboxField
        name="showOnWebsite"
        value="1"
        label="Show on website"
        defaultChecked={existing?.showOnWebsite ?? false}
      />
    </FieldSet>
  );
}
