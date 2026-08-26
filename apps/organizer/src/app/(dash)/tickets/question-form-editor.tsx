'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { QuestionFieldDef, TicketAudience } from '@kgc/shared';
import { saveQuestionAction, type QuestionState } from './question-form-actions';

/**
 * Add or edit one registration question.
 *
 * ── Two things the form refuses, and both are refused server-side too ──────
 *
 * A choice with fewer than two options, because a dropdown with one entry is a
 * label. And a **required consent box**, because consent that cannot be
 * withheld is not consent — in several jurisdictions it does not constitute
 * consent at all. That one is stated in the UI rather than only rejected on
 * submit, since the person about to tick it is usually not the person who knows
 * why they shouldn't.
 *
 * ── The tier restriction is a multi-select, defaulting to none ─────────────
 *
 * None means "ask everybody", which is what almost every question wants. A
 * per-tier form would mean editing the dietary question four times and getting
 * it wrong once.
 */
export function QuestionEditor({
  audience,
  editing,
  tiers,
}: {
  audience: TicketAudience;
  /** Present when editing. Its id is passed through untouched. */
  editing?: QuestionFieldDef;
  tiers: { id: string; name: string }[];
}) {
  const [state, action] = useActionState<QuestionState, FormData>(saveQuestionAction, {});
  const [kind, setKind] = useState<QuestionFieldDef['kind']>(editing?.kind ?? 'short-text');
  const [required, setRequired] = useState(editing?.required ?? false);

  const needsOptions = kind === 'choice' || kind === 'multi-choice';
  const isConsent = kind === 'consent';

  return (
    <form action={action}>
      <input type="hidden" name="audience" value={audience} />
      {editing && <input type="hidden" name="id" value={editing.id} />}

      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="prompt">
          Question
        </label>
        <input
          id="prompt"
          name="prompt"
          required
          maxLength={200}
          defaultValue={editing?.prompt}
          placeholder="Do you have any dietary requirements?"
        />
        {editing && (
          <p className="muted" style={{ fontSize: 12 }}>
            Reword this freely. The question keeps its id (<code>{editing.id}</code>), so every
            answer already given to it stays attached.
          </p>
        )}
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="kind">
          Answer type
        </label>
        <select
          id="kind"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as QuestionFieldDef['kind'])}
          style={{ maxWidth: 260 }}
        >
          <option value="short-text">Short text</option>
          <option value="long-text">Long text</option>
          <option value="choice">Choose one</option>
          <option value="multi-choice">Choose any</option>
          <option value="checkbox">Checkbox</option>
          <option value="consent">Consent box</option>
        </select>
        <p className="muted" style={{ fontSize: 12 }}>
          {needsOptions
            ? 'Choices are countable — the catering figure comes from these, and free text does not add up.'
            : kind === 'consent'
              ? 'A consent box records a decision rather than a preference. It is never pre-ticked and cannot be required.'
              : 'Free text is exported but not tallied — a hundred distinct sentences is a list, not a distribution.'}
        </p>
      </div>

      {needsOptions && (
        <div className="whova-form-row">
          <label className="whova-form-label" htmlFor="options">
            Options
          </label>
          <textarea
            id="options"
            name="options"
            rows={5}
            defaultValue={(editing?.options ?? []).join('\n')}
            placeholder={'Vegetarian\nVegan\nGluten-free\nNo requirements'}
          />
          <p className="muted" style={{ fontSize: 12 }}>
            One per line, at least two. Include the &ldquo;none of these&rdquo; option explicitly —
            a blank answer and &ldquo;no requirements&rdquo; look identical in an export and mean
            different things to a caterer.
          </p>
        </div>
      )}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="helpText">
          Help text
        </label>
        <input
          id="helpText"
          name="helpText"
          maxLength={200}
          defaultValue={editing?.helpText}
          placeholder="optional — shown under the field"
        />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="required">
          Required
        </label>
        <label style={{ fontSize: 13 }}>
          <input
            id="required"
            type="checkbox"
            name="required"
            checked={required && !isConsent}
            disabled={isConsent}
            onChange={(e) => setRequired(e.target.checked)}
          />{' '}
          {isConsent
            ? 'A consent box cannot be required'
            : 'The buyer cannot complete checkout without answering'}
        </label>
        {isConsent && (
          <p className="muted" style={{ fontSize: 12 }}>
            Consent that cannot be withheld is not consent, and in several jurisdictions does not
            count as it. If this is genuinely a condition of attending, make it a{' '}
            <strong>Checkbox</strong> and say so in the prompt — &ldquo;I have read the code of
            conduct&rdquo; is a gate, not a consent.
          </p>
        )}
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="ticketTypeIds">
          Ask only on
        </label>
        <select
          id="ticketTypeIds"
          name="ticketTypeIds"
          multiple
          size={Math.min(5, Math.max(2, tiers.length))}
          defaultValue={editing?.ticketTypeIds ?? []}
          style={{ maxWidth: 340 }}
        >
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <p className="muted" style={{ fontSize: 12 }}>
          Select nothing to ask everybody, which is what most questions want. A buyer who answers
          and then switches to a tier that does not ask this has their answer{' '}
          <strong>dropped, not rejected</strong> — they have done nothing wrong.
        </p>
      </div>

      <Submit editing={Boolean(editing)} />
    </form>
  );
}

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Saving…' : editing ? 'Save question' : 'Add question'}
    </button>
  );
}
