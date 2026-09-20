'use client';

import { useActionState } from 'react';
import type { TrackOption } from '@/lib/data';
import type { ReviewerRow } from '@/lib/reviewers';
import type { SubmissionRow } from '@/lib/submissions';
import {
  CheckboxField,
  Field,
  FieldSet,
  FormActions,
  FormBanner,
  FormGrid,
  Select,
  SubmitButton,
  type FormState,
} from '../../../form';
import { assignByTrackAction, assignReviewerAction, inviteReviewerAction } from './actions';

/**
 * Adding somebody to the programme committee.
 *
 * ── Tracks, not free text ──────────────────────────────────────────────────
 *
 * `ReviewerDoc.trackIds` holds `tracks/{id}` ids and this is why: assignment by
 * topic matches on them, and a matcher over free text returns nothing for the
 * reviewer who typed "Knowledge Graphs" where the call says "Knowledge Graph
 * Engineering" — a mismatch that looks exactly like a reviewer with no
 * expertise.
 */
export function InviteReviewerForm({ tracks }: { tracks: TrackOption[] }) {
  const [state, action] = useActionState<FormState, FormData>(inviteReviewerAction, {});

  return (
    <form action={action}>
      <FormBanner state={state} />

      <FormGrid>
        <Field label="Name" name="name" required maxLength={120} width="lg" />
        <Field label="Email" name="email" type="email" required width="lg" />
      </FormGrid>

      <FormGrid>
        <Field
          label="Affiliation"
          name="affiliation"
          maxLength={120}
          width="lg"
          hint="Helps the committee spot conflicts of interest."
        />
        <Field
          label="Most submissions they will take"
          name="maxAssignments"
          type="number"
          min={1}
          max={200}
          defaultValue={10}
          width="sm"
          hint="Assignment never gives them more than this."
        />
      </FormGrid>

      <FieldSet
        legend="Tracks they cover"
        hint={
          tracks.length === 0
            ? 'No tracks have been entered for this event, so assignment by topic has nothing to match on. Add them in Track Manager.'
            : 'What assignment by topic matches on. A reviewer with no tracks can still be assigned by hand.'
        }
        inline
      >
        {tracks.map((t) => (
          <CheckboxField key={t.id} name="trackIds" value={t.id} label={t.name} />
        ))}
      </FieldSet>

      <FormActions>
        <SubmitButton>Add reviewer</SubmitButton>
      </FormActions>
    </form>
  );
}

/**
 * One reviewer, one submission, chosen by hand.
 *
 * The list of submissions is deliberately every one that is not a draft or a
 * withdrawal, rather than only the unassigned: a chair adding a third opinion to
 * a contested paper is doing something the matcher would not.
 */
export function AssignForm({
  reviewers,
  submissions,
}: {
  reviewers: ReviewerRow[];
  submissions: SubmissionRow[];
}) {
  const [state, action] = useActionState<FormState, FormData>(assignReviewerAction, {});

  return (
    <form action={action}>
      <FormBanner state={state} />
      <FormGrid>
        <Select
          label="Submission"
          name="submissionId"
          required
          placeholder="Choose one…"
          width="xl"
          options={submissions.map((s) => ({
            value: s.id,
            label: `${s.title || 'Untitled'} · ${s.reviewsSubmitted}/${s.reviewsAssigned} reviews`,
          }))}
        />
        <Select
          label="Reviewer"
          name="reviewerId"
          required
          placeholder="Choose one…"
          width="lg"
          options={reviewers.map((r) => ({
            value: r.id,
            label: `${r.name} (${r.assignedCount}/${r.maxAssignments})`,
          }))}
        />
      </FormGrid>
      <FormActions>
        <SubmitButton pendingLabel="Assigning…">Assign</SubmitButton>
      </FormActions>
    </form>
  );
}

/** The bulk matcher. Runs immediately and reports what it did. */
export function AssignByTrackForm({ callId, target }: { callId: string; target: number }) {
  const [state, action] = useActionState<FormState, FormData>(assignByTrackAction, {});

  return (
    <form action={action}>
      <FormBanner state={state} />
      <input type="hidden" name="callId" value={callId} />
      <p className="body-2">
        Gives every submission with a track up to {target} reviewer{target === 1 ? '' : 's'} whose
        own tracks include it, least-loaded first, never past what a reviewer said they would take.
        A submission that already has enough reviewers is left alone.
      </p>
      <FormActions>
        <SubmitButton variant="secondary" pendingLabel="Matching…">
          Assign by track
        </SubmitButton>
      </FormActions>
    </form>
  );
}
