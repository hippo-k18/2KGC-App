'use client';

import { useState } from 'react';
import type { QuestionFieldDef } from '@kgc/shared';
import { fieldsForTier, isTriggered, type AnswerValue } from '@kgc/scripts/src/lib/question-forms';

/**
 * The organizer's registration questions, rendered inside the checkout form.
 *
 * ── Asked before payment, not after ────────────────────────────────────────
 *
 * The obvious alternative is to ask on the confirmation page, which avoids
 * holding answers across the Stripe redirect entirely. It is wrong: roughly
 * half of buyers close the tab the moment they see "you're registered", and the
 * caterer never learns about the coeliac. The cost of asking first is one extra
 * collection; the cost of asking second is the answers.
 *
 * ── Filtered by tier, in the browser ───────────────────────────────────────
 *
 * `ticketTypeIds` on a field means "only ask this of these tiers", and the
 * buyer can change tier without a round trip — so the filtering happens here as
 * well as on the server. The server is the one that counts: it drops answers to
 * questions the chosen tier does not ask, rather than rejecting them, because a
 * buyer who switched tier after filling the form is doing nothing wrong.
 *
 * ── Sub-questions appear and disappear as the answers change ───────────────
 *
 * A question carrying `showIf` is asked only when an earlier one was answered a
 * particular way. Both halves of that use the shared `isTriggered`, which is the
 * whole point of it living in `@kgc/scripts`: a browser that reveals a field the
 * server then drops, or hides one the server then demands, is the bug this
 * arrangement exists to make impossible.
 *
 * Unmounted rather than hidden with CSS, because a hidden `required` input
 * blocks the submit button with a validation message pointing at something
 * nobody can see.
 */
export function Questions({
  fields,
  ticketTypeId,
  errors,
}: {
  fields: QuestionFieldDef[];
  ticketTypeId: string;
  /** Field id → message, returned by the server action after a failed submit. */
  errors?: Record<string, string>;
}) {
  /**
   * What has been answered so far, for the triggers alone.
   *
   * Read back off the form on every change rather than held per input: the
   * inputs stay uncontrolled, so a buyer's typing is never round-tripped
   * through React, and a `multi-choice` box arrives as the several values
   * `FormData` already knows how to collect.
   */
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});

  const readForm = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const next: Record<string, AnswerValue> = {};
    for (const f of fields) {
      const values = data.getAll(`q_${f.id}`).map((v) => String(v));
      if (values.length === 0) continue;
      if (f.kind === 'checkbox' || f.kind === 'consent') next[f.id] = true;
      else if (f.kind === 'multi-choice') next[f.id] = values;
      else if (values[0] !== '') next[f.id] = values[0];
    }
    setAnswers(next);
  };

  // `fieldsForTier` has already dropped any sub-question whose parent this tier
  // does not ask, so `isTriggered` is left deciding one thing: was it answered
  // that way? A field with no `showIf` is always triggered.
  const forTier = fieldsForTier(fields, ticketTypeId);
  if (forTier.length === 0) return null;
  const asked = forTier.filter((f) => isTriggered(f, answers));

  return (
    /*
      One listener on the wrapper. Change events from every input inside it
      bubble, so nothing has to be wired per field and a question added to the
      form tomorrow is covered without touching this.
    */
    <div
      onChange={(e) => {
        const form = (e.target as HTMLElement).closest('form');
        if (form) readForm(form);
      }}
      style={{ display: 'contents' }}
    >
      {asked.map((f) => (
        <div
          className="field"
          key={f.id}
          /* A follow-up question is set in from the one that revealed it, so it
             reads as a consequence of the previous answer rather than as a new
             field that appeared from nowhere. */
          style={f.showIf ? { borderLeft: '2px solid var(--line, #dcdfe4)', paddingLeft: 12 } : undefined}
        >
          <Field field={f} error={errors?.[f.id]} />
        </div>
      ))}
    </div>
  );
}

function Field({ field: f, error }: { field: QuestionFieldDef; error?: string }) {
  const name = `q_${f.id}`;
  const label = (
    <label htmlFor={name}>
      {f.prompt}
      {f.required ? ' *' : ''}
    </label>
  );
  const hint = f.helpText ? <p className="hint">{f.helpText}</p> : null;
  const problem = error ? (
    <p className="hint" style={{ color: 'var(--danger, #c0392b)' }} role="alert">
      {error}
    </p>
  ) : null;

  switch (f.kind) {
    case 'long-text':
      return (
        <>
          {label}
          <textarea id={name} name={name} rows={3} required={f.required} maxLength={2000} />
          {hint}
          {problem}
        </>
      );

    case 'choice':
      return (
        <>
          {label}
          <select id={name} name={name} required={f.required} defaultValue="">
            {/*
              An empty first option even when required. A select that arrives
              pre-set to the first choice collects that choice from everybody who
              did not read it, which is worse than no data.
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {(f.options ?? []).map((o) => (
              <label key={o} style={{ fontWeight: 400 }}>
                <input type="checkbox" name={name} value={o} /> {o}
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
          <label htmlFor={name} style={{ fontWeight: 400 }}>
            {/*
              Never `defaultChecked`. For a consent box that is the difference
              between a record of a decision and a record of a default, and only
              one of those is consent.
            */}
            <input id={name} name={name} type="checkbox" required={f.required} /> {f.prompt}
            {f.required ? ' *' : ''}
          </label>
          {hint}
          {problem}
        </>
      );

    default:
      return (
        <>
          {label}
          <input id={name} name={name} required={f.required} maxLength={200} />
          {hint}
          {problem}
        </>
      );
  }
}
