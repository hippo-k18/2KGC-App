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
  parents,
}: {
  audience: TicketAudience;
  /** Present when editing. Its id is passed through untouched. */
  editing?: QuestionFieldDef;
  tiers: { id: string; name: string }[];
  /**
   * Questions on this form that could reveal another one: a choice or a tick
   * box, at the top level, and never the question being edited. The screen
   * works that list out, because it is the one that holds the whole form.
   */
  parents: { id: string; prompt: string; answers: string[] }[];
}) {
  const [state, action] = useActionState<QuestionState, FormData>(saveQuestionAction, {});
  const [kind, setKind] = useState<QuestionFieldDef['kind']>(editing?.kind ?? 'short-text');
  const [required, setRequired] = useState(editing?.required ?? false);
  const [parentId, setParentId] = useState(editing?.showIf?.fieldId ?? '');

  const needsOptions = kind === 'choice' || kind === 'multi-choice';
  const isConsent = kind === 'consent';
  const parent = parents.find((p) => p.id === parentId);

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
            {parentId
              ? 'Shown only after the answer below, so it has to be ticked by whoever reaches it. Declining is still one question earlier.'
              : (
                  <>
                    If this is a condition of attending, use a <strong>Checkbox</strong> instead.
                  </>
                )}
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

      {/*
        Conditional logic, one level deep.

        Two selects rather than a rule builder: one earlier question, one of its
        answers. That covers "if vegetarian, which kind" and "if you need a visa
        letter, what is your passport name", which is what a registration form
        actually asks. A chain of conditions is a form whose author cannot see
        what any given person will be shown.
      */}
      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="showIfFieldId">
          Show only when
        </label>
        {parents.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Add a &ldquo;choose one&rdquo;, &ldquo;choose any&rdquo; or tick box question first.
            Those are the answers a later question can depend on.
          </p>
        ) : (
          <>
            <select
              id="showIfFieldId"
              name="showIfFieldId"
              className="whova-text-input"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              style={{ maxWidth: 340 }}
            >
              <option value="">Always ask this</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.prompt}
                </option>
              ))}
            </select>

            {parent && (
              <div style={{ marginTop: 8 }}>
                <label className="whova-form-label" htmlFor="showIfEquals">
                  is answered
                </label>
                <select
                  id="showIfEquals"
                  name="showIfEquals"
                  className="whova-text-input"
                  defaultValue={editing?.showIf?.equals ?? ''}
                  style={{ maxWidth: 340 }}
                >
                  <option value="">Choose an answer…</option>
                  {parent.answers.map((a) => (
                    <option key={a} value={a}>
                      {a === 'true' ? 'ticked' : a}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <p className="muted" style={{ fontSize: 12 }}>
              {parent
                ? 'The buyer sees this only after that answer. It is dropped if they change their mind.'
                : 'Pick an earlier question to ask this one only sometimes.'}
            </p>
          </>
        )}
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
