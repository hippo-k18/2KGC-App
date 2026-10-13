'use client';

import type { CallFormFieldDef } from '@kgc/shared';
import { fieldsForTier, type AnswerValue } from '@kgc/scripts/src/lib/question-forms';

/**
 * The call's own questions, rendered inside the submission form.
 *
 * A near-twin of `tickets/questions.tsx` and deliberately a separate component
 * rather than a widened one: that renderer switches on `QuestionFieldDef['kind']`
 * with a text-input fallback, and a call form has a seventh kind — `description`,
 * a block of prose that collects no answer. Widening the shared union would make
 * an explanatory paragraph render as an empty box on the *payment* page, and
 * typecheck cleanly while doing it. `models.ts` says so where the two types are
 * declared.
 *
 * What is shared is everything that matters: the field definitions, the ids
 * answers are keyed by, and `validateAnswers` on the server. Two renderers over
 * one validator is fine; two validators would not be.
 */
export function SubmissionFields({
  fields,
  answers,
  errors,
}: {
  fields: CallFormFieldDef[];
  /** Existing answers, when returning to a draft. */
  answers?: Record<string, AnswerValue>;
  /** Field id → message, returned by the server action after a failed submit. */
  errors?: Record<string, string>;
}) {
  /*
   * `fieldsForTier` with an empty tier: a call has no ticket types, so every
   * field applies. It is called anyway rather than skipped, because it is also
   * what lifts a sub-question to sit immediately after the question that reveals
   * it — sorting by `order` alone can put a sub-question above its own parent.
   */
  const asked = fieldsForTier(fields, '');
  if (asked.length === 0) return null;

  return (
    <>
      {asked.map((f) => (
        <div className="field" key={f.id}>
          <One field={f} value={answers?.[f.id]} error={errors?.[f.id]} />
        </div>
      ))}
    </>
  );
}

function One({
  field: f,
  value,
  error,
}: {
  field: CallFormFieldDef;
  value?: AnswerValue;
  error?: string;
}) {
  const name = `q_${f.id}`;

  if (f.kind === 'description') {
    /*
     * Not a question. It renders as prose between the questions and posts
     * nothing — no input, no name, so there is no key for it in the answers map
     * and `validateAnswers` never sees one.
     */
    return (
      <p className="hint" style={{ fontSize: '0.95rem', marginTop: 0 }}>
        {f.prompt}
      </p>
    );
  }

  const label = (
    <label htmlFor={name}>
      {f.prompt}
      {f.required ? ' *' : ''}
    </label>
  );
  const hint = f.helpText ? <p className="hint">{f.helpText}</p> : null;
  const problem = error ? (
    <p className="hint" style={{ color: '#991b1b' }} role="alert">
      {error}
    </p>
  ) : null;

  switch (f.kind) {
    case 'long-text':
      return (
        <>
          {label}
          <textarea
            id={name}
            name={name}
            rows={5}
            required={f.required}
            maxLength={f.maxLength ?? 2000}
            defaultValue={typeof value === 'string' ? value : ''}
          />
          {hint}
          {problem}
        </>
      );

    case 'choice':
      return (
        <>
          {label}
          <select id={name} name={name} required={f.required} defaultValue={typeof value === 'string' ? value : ''}>
            {/*
              An empty first option even when required. A select that arrives
              pre-set to the first choice collects that choice from everybody
              who did not read it, which is worse than no data at all.
            */}
            <option value="" disabled={f.required}>
              {f.required ? 'Choose one…' : 'No answer'}
            </option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {hint}
          {problem}
        </>
      );

    case 'multi-choice':
      return (
        <>
          {label}
          <div className="checks">
            {(f.options ?? []).map((o) => (
              <label key={o} className="check" style={{ fontWeight: 400 }}>
                <input
                  type="checkbox"
                  name={name}
                  value={o}
                  defaultChecked={Array.isArray(value) ? value.includes(o) : false}
                />
                <span>{o}</span>
              </label>
            ))}
          </div>
          {hint}
          {problem}
        </>
      );

    case 'checkbox':
    case 'consent':
      return (
        <>
          <label htmlFor={name} className="check" style={{ fontWeight: 400 }}>
            {/*
              Never `defaultChecked` from nothing. For a consent box that is the
              difference between a record of a decision and a record of a
              default, and only one of those is consent. Restoring what somebody
              actually ticked on a saved draft is a different thing and is fine.
            */}
            <input
              id={name}
              name={name}
              type="checkbox"
              required={f.required}
              defaultChecked={value === true}
            />
            <span>
              {f.prompt}
              {f.required ? ' *' : ''}
            </span>
          </label>
          {hint}
          {problem}
        </>
      );

    default:
      return (
        <>
          {label}
          <input
            id={name}
            name={name}
            required={f.required}
            maxLength={f.maxLength ?? 200}
            defaultValue={typeof value === 'string' ? value : ''}
          />
          {hint}
          {problem}
        </>
      );
  }
}
