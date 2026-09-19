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
          className="whova-text-input"
          required
          maxLength={200}
          defaultValue={editing?.prompt}
          placeholder="Do you have any dietary requirements?"
        />
        {editing && (
          <p className="muted" style={{ fontSize: 12 }}>
            Answers already given stay with the question when you reword it.
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
          className="whova-text-input"
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
            ? 'Choices are counted in the export.'
            : kind === 'consent'
              ? 'Never pre-ticked. Cannot be required.'
              : 'Free text is exported but not counted.'}
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
            className="whova-text-input"
            rows={5}
            defaultValue={(editing?.options ?? []).join('\n')}
            placeholder={'Vegetarian\nVegan\nGluten-free\nNo requirements'}
          />
          <p className="muted" style={{ fontSize: 12 }}>
            One per line, at least two. Include a &ldquo;none of these&rdquo; option.
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
          className="whova-text-input"
          maxLength={200}
          defaultValue={editing?.helpText}
          placeholder="Optional. Shown under the question"
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
            If this is a condition of attending, use a <strong>Checkbox</strong> instead.
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
          className="whova-text-input"
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
          Select nothing to ask everybody.
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
