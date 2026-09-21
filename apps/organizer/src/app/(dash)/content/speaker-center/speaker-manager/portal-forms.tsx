'use client';

import { useActionState } from 'react';
import {
  FormActions,
  FormBanner,
  Select,
  SubmitButton,
  Textarea,
  type FormState,
} from '../../../form';
import {
  decideSpeakerProfileAction,
  revokeSpeakerLinkAction,
  sendSpeakerLinkAction,
} from './actions';

/**
 * The three self-service forms, apart from the page because they hold form
 * state and `ui.tsx` may not be imported by a client component.
 *
 * All three are `useActionState`, the same shape the reviewers screen uses, so
 * the outcome is a banner on the panel that was pressed rather than a redirect
 * that loses which of several forms it belonged to.
 */

export interface LinkTarget {
  id: string;
  name: string;
  hasAddress: boolean;
  /** "Link sent", "Opened", "Waiting for you"… absent when none has been sent. */
  statusLabel?: string;
}

/**
 * Send one speaker, or a group, the link to their own profile.
 *
 * The two group options are the two chases an organizer actually runs. A
 * speaker with no address is listed but cannot be chosen, and the row says why
 * — greying it out with no reason is how "why can I not email Ada?" becomes a
 * question nobody can answer from this screen.
 */
export function SendLinkForm({
  speakers,
  incompleteCount,
  emailOn,
}: {
  speakers: LinkTarget[];
  incompleteCount: number;
  emailOn: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(sendSpeakerLinkAction, {});
  const reachable = speakers.filter((s) => s.hasAddress);

  return (
    <form action={action}>
      <FormBanner state={state} />
      <Select
        label="Send to"
        name="speakerId"
        required
        placeholder="Choose…"
        width="xl"
        options={[
          { value: '__incomplete', label: `Everyone missing a bio or a photo (${incompleteCount})` },
          { value: '__all', label: `Every speaker with an address (${reachable.length})` },
          ...speakers.map((s) => ({
            value: s.id,
            label: s.hasAddress
              ? `${s.name}${s.statusLabel ? ` · ${s.statusLabel}` : ''}`
              : `${s.name} · no address on file`,
            disabled: !s.hasAddress,
          })),
        ]}
      />
      <Textarea
        label="A note from you"
        name="note"
        rows={3}
        maxLength={2000}
        placeholder="Optional. Shown above the link, for example when you need the bio by."
      />
      <FormActions>
        <SubmitButton pendingLabel="Sending…">Send link</SubmitButton>
      </FormActions>
      {!emailOn && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Email is not switched on yet, so pressing this sends nothing. Copy a speaker&rsquo;s link
          from the list and send it yourself until it is.
        </p>
      )}
    </form>
  );
}

/**
 * Approve or turn down one speaker's submission.
 *
 * Two submits on one form, because the note belongs to the rejection and the
 * organizer types it before choosing. Approve is the primary: it is what
 * happens to almost every submission, and making the rare answer the easy one
 * is how a panel of thirty takes an afternoon.
 */
export function DecisionForm({ speakerId }: { speakerId: string }) {
  const [state, action] = useActionState<FormState, FormData>(decideSpeakerProfileAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="speakerId" value={speakerId} />
      <FormBanner state={state} />
      <Textarea
        label="Why you turned it down"
        name="note"
        rows={2}
        maxLength={500}
        placeholder="Optional, and only for your own record. It is not sent to the speaker."
      />
      <FormActions>
        <SubmitButton name="decision" value="approve" pendingLabel="Publishing…">
          Approve and publish
        </SubmitButton>
        <SubmitButton name="decision" value="reject" variant="secondary" pendingLabel="Saving…">
          Turn down
        </SubmitButton>
      </FormActions>
    </form>
  );
}

/**
 * Stop every link one speaker holds.
 *
 * Its own form rather than a row action, because a row menu item is one click
 * from "Edit speaker" and this one cannot be undone from the speaker's side:
 * their link stops working with no message to them, and the only way back is an
 * organizer sending a new one.
 */
export function RevokeLinkForm({ speakers }: { speakers: LinkTarget[] }) {
  const [state, action] = useActionState<FormState, FormData>(revokeSpeakerLinkAction, {});

  return (
    <form action={action}>
      <FormBanner state={state} />
      <Select
        label="Stop a link"
        name="speakerId"
        required
        placeholder="Choose…"
        width="xl"
        options={speakers.map((s) => ({
          value: s.id,
          label: `${s.name}${s.statusLabel ? ` · ${s.statusLabel}` : ''}`,
        }))}
      />
      <FormActions>
        <SubmitButton variant="danger" pendingLabel="Stopping…">
          Stop this speaker&rsquo;s links
        </SubmitButton>
      </FormActions>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        Every link already sent to them stops opening. They are not told. Send a new link to let
        them back in.
      </p>
    </form>
  );
}
