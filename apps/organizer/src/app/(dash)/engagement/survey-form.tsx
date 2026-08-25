'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { SurveyRow } from '@/lib/surveys';
import { saveSurveyAction, type SurveyState } from './survey-actions';

/**
 * Create or edit a survey.
 *
 * Questions are a textarea, one per line, not a drag-and-drop builder. A
 * builder is days of client state for a form written twice a year — and the
 * textarea round-trips, so an organizer can paste last year's questions
 * straight back in, which a builder makes impossible.
 */
export function SurveyForm({
  existing,
  sessions,
  fixedSession,
}: {
  existing?: SurveyRow;
  sessions: { id: string; label: string }[];
  /** Session Feedback pre-selects; the general Surveys screen does not. */
  fixedSession?: boolean;
}) {
  const [state, action] = useActionState<SurveyState, FormData>(saveSurveyAction, {});

  const initialQuestions = existing
    ? undefined
    : 'rating: How useful was this session?\nrating: How well did it match its description?\ntext: What would have made it better?';

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}

      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="title">
          Title
        </label>
        <input id="title" name="title" required defaultValue={existing?.title} maxLength={100} />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="description">
          Description
        </label>
        <input
          id="description"
          name="description"
          defaultValue={existing?.description}
          placeholder="One line telling attendees why it is worth two minutes."
        />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="sessionId">
          {fixedSession ? 'Session' : 'Attach to a session'}
        </label>
        <select
          id="sessionId"
          name="sessionId"
          defaultValue={existing?.sessionId ?? ''}
          style={{ maxWidth: 520 }}
        >
          <option value="">{fixedSession ? '— choose a session —' : 'Not a session — an event survey'}</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="muted" style={{ fontSize: 12 }}>
          A survey attached to a session is session feedback; one without is an event survey. Same
          machinery, two screens.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="questions">
          Questions
        </label>
        <textarea
          id="questions"
          name="questions"
          rows={10}
          required
          defaultValue={
            existing
              ? undefined
              : initialQuestions
          }
          style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          One per line. Prefix with <code>rating:</code>, <code>single:</code>, <code>multi:</code>{' '}
          or <code>text:</code> — no prefix means a rating. Choices take options after a{' '}
          <code>|</code>:
        </p>
        <pre className="whova-code" style={{ fontSize: 12 }}>{`rating: How useful was this session?
single: Would you attend again? | Yes | No | Maybe
text: Anything else?`}</pre>
        {existing && existing.responseCount > 0 && (
          /*
            Warned before the save fails rather than after. Changing a question
            on a survey with answers would silently change what those answers
            mean — `q3` becomes a different question and every stored response
            still points at it.
          */
          <p className="error" style={{ fontSize: 12 }}>
            ⚠️ This survey has {existing.responseCount} responses, so the questions can no longer
            change. Editing the wording would make the answers already stored mean something else.
            Create a new survey instead.
          </p>
        )}
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue={existing?.status ?? 'draft'} style={{ maxWidth: 220 }}>
          <option value="draft">Draft — not visible to attendees</option>
          <option value="published">Published — collecting responses</option>
          <option value="cancelled">Closed</option>
        </select>
      </div>

      <SaveButton editing={Boolean(existing)} />
    </form>
  );
}

function SaveButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Saving…' : editing ? 'Save changes' : 'Create survey'}
    </button>
  );
}
