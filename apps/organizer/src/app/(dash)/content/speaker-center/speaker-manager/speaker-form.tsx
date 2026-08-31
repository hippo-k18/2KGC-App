'use client';

import { useActionState } from 'react';
import { ImageField } from '@/components/image-field';
import {
  Field,
  FormActions,
  FormBanner,
  FormGrid,
  SubmitButton,
  Textarea,
} from '../../../form';
import { saveSpeakerAction, type SpeakerState } from './actions';

/**
 * One speaker's programme record, as a plain object.
 *
 * `getSpeaker` returns Firestore `Timestamp`s on `createdAt` / `updatedAt`, and
 * a Server Component may only hand a client component plain values. So the page
 * maps to this and the two fields nothing on this form edits never cross the
 * boundary at all.
 */
export interface EditableSpeaker {
  id: string;
  name: string;
  title?: string;
  company?: string;
  bio?: string;
  contactEmail?: string;
  photoURL?: string;
  linkedin?: string;
  x?: string;
  website?: string;
  /** Read-only here, and shown for exactly that reason. */
  userId?: string;
  sessionCount: number;
}

/**
 * Create or edit one speaker.
 *
 * ── The name field is the one with consequences ─────────────────────────────
 *
 * Every other field on this form changes one document. The name changes this
 * document *and* the cached `speakerNames` on every session the speaker
 * presents, because the agenda list renders those without reading a speaker at
 * all. `saveSpeakerAction` fans that out and reports what it touched, which is
 * why this form has a second status line under the banner: "saved" and "and
 * fourteen sessions rewritten" are two different facts and an organizer
 * renaming a keynote wants both.
 *
 * ── `userId` is displayed and never submitted ───────────────────────────────
 *
 * A speaker who also bought a ticket is joined to their attendee account by
 * `SpeakerDoc.userId`. Nothing here writes it — see the action's header — but
 * an organizer editing the name of somebody with an account should be able to
 * see that is what they are doing, so it is on the form as text.
 */
export function SpeakerForm({ existing }: { existing?: EditableSpeaker }) {
  const [state, action] = useActionState<SpeakerState, FormData>(saveSpeakerAction, {});

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}

      <FormBanner state={state} />

      {state.fanOut && (
        <p
          className={state.fanOutOk ? 'muted' : undefined}
          role={state.fanOutOk ? undefined : 'alert'}
          style={{
            fontSize: 13,
            marginTop: -8,
            ...(state.fanOutOk ? null : { color: 'var(--danger)', fontWeight: 600 }),
          }}
        >
          Agenda caches: {state.fanOut}
          {state.fanOutOk ? null : ' Run the agenda cache check on Track Manager to repair them.'}
        </p>
      )}

      <Field
        name="name"
        label="Name"
        required
        defaultValue={existing?.name}
        error={state.fieldErrors?.name}
        maxLength={80}
        width="lg"
        hint={
          existing ? (
            <>
              As it appears on the agenda and the badge. Renaming rewrites the cached name on{' '}
              {existing.sessionCount === 0
                ? 'no sessions — they are not on the programme yet'
                : `their ${existing.sessionCount} session${existing.sessionCount === 1 ? '' : 's'}`}
              . Id <code>{existing.id}</code> never changes — sessions point at it.
            </>
          ) : (
            'As it should appear on the agenda and the badge.'
          )
        }
      />

      <ImageField
        name="photo"
        label="Headshot"
        currentUrl={existing?.photoURL}
        previewSize={96}
        help="PNG, JPEG, WebP or GIF. Large images are shrunk to 1024px in your browser before they are sent, so a photo straight off a phone is fine."
      />

      <FormGrid>
        <Field
          name="title"
          label="Job title"
          defaultValue={existing?.title}
          placeholder="Head of Knowledge Engineering"
          maxLength={90}
        />
        <Field
          name="company"
          label="Affiliation"
          defaultValue={existing?.company}
          placeholder="Cornell Tech"
          maxLength={90}
        />
      </FormGrid>

      <Textarea
        name="bio"
        label="Bio"
        rows={6}
        defaultValue={existing?.bio}
        hint="Shown on the speaker page in the app and on the website. Two or three sentences is what the programme designer wants."
      />

      <Field
        name="contactEmail"
        label="Contact email"
        type="email"
        defaultValue={existing?.contactEmail}
        error={state.fieldErrors?.contactEmail}
        placeholder="speaker@university.edu"
        width="lg"
        hint={
          <>
            The address the programme committee corresponds with — known from the call for papers,
            months before they hold a ticket. Message Speakers sends here in preference to whatever
            address they later bought a ticket with. Without one, this speaker cannot be chased for
            a bio or a slide deck.
          </>
        }
      />

      <FormGrid>
        <Field
          name="linkedin"
          label="LinkedIn"
          defaultValue={existing?.linkedin}
          error={state.fieldErrors?.linkedin}
          placeholder="linkedin.com/in/…"
        />
        <Field
          name="x"
          label="X"
          defaultValue={existing?.x}
          error={state.fieldErrors?.x}
          placeholder="x.com/…"
        />
        <Field
          name="website"
          label="Website"
          defaultValue={existing?.website}
          error={state.fieldErrors?.website}
          placeholder="example.org"
        />
      </FormGrid>

      {existing?.userId ? (
        <p className="muted" style={{ fontSize: 12 }}>
          Joined to the attendee account <code>{existing.userId}</code>. That link is what makes
          their profile, their saved sessions and their messages resolve to this speaker, and
          nothing on this form touches it.
        </p>
      ) : null}

      <FormActions>
        <SubmitButton pendingLabel="Saving…">
          {existing ? 'Save changes' : 'Add speaker'}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
