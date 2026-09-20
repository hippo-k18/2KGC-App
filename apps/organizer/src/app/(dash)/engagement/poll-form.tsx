'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { PollRow } from '@/lib/polls';
import { CheckboxField, Field, FormActions, FormBanner, Select, SubmitButton, Textarea } from '../form';
import { savePollAction, type PollState } from './poll-actions';

/**
 * Create or edit a poll on a session.
 *
 * Options are a textarea, one per line, matching `survey-form.tsx`. A poll is
 * written in the ten minutes before a talk, often on a laptop balanced on a
 * knee, and a textarea is the fastest control there is for four short lines.
 * It also round-trips: last year's poll pastes straight back in.
 */
export function PollForm({
  existing,
  sessions,
  defaultSessionId,
}: {
  existing?: PollRow;
  sessions: { id: string; label: string }[];
  defaultSessionId?: string;
}) {
  const [state, action] = useActionState<PollState, FormData>(savePollAction, {});
  const locked = Boolean(existing && existing.actualVotes > 0);

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}

      <FormBanner state={state} />

      {existing ? (
        <input type="hidden" name="sessionId" value={existing.sessionId} />
      ) : (
        <Select
          name="sessionId"
          label="Session"
          required
          width="xl"
          placeholder="Choose a session…"
          defaultValue={defaultSessionId}
          options={sessions.map((s) => ({ value: s.id, label: s.label }))}
          hint={
            <>
              Attendees see the poll on that session&rsquo;s screen. Polls must be turned on for
              the session in{' '}
              <Link href="/content/agenda-center/session-qanda-manager">Session Q&amp;A Manager</Link>.
            </>
          }
        />
      )}

      <Field
        name="question"
        label="Question"
        required
        width="xl"
        maxLength={200}
        defaultValue={existing?.question}
        placeholder="What is your biggest obstacle?"
      />

      <Textarea
        name="options"
        label="Options"
        required
        rows={6}
        defaultValue={existing?.options.map((o) => o.label).join('\n')}
        style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }}
        hint={
          locked
            ? `${existing!.actualVotes} ${existing!.actualVotes === 1 ? 'person has' : 'people have'} voted, so options can be reworded but not added, removed or reordered.`
            : 'One per line, two to ten of them.'
        }
      />

      <CheckboxField
        name="open"
        label="Open to votes"
        defaultChecked={existing ? existing.open : false}
        description="A closed poll takes no votes. A new poll starts closed unless you tick this."
      />

      <CheckboxField
        name="liveResults"
        label="Live results"
        defaultChecked={existing ? existing.liveResults : false}
        description="Keeps the result attendees see up to date while the room view is open, so you do not have to publish the count by hand. Leave it off for a poll you want to reveal at the end."
      />

      <FormActions>
        <SubmitButton pendingLabel="Saving…">
          {existing ? 'Save changes' : 'Create poll'}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
