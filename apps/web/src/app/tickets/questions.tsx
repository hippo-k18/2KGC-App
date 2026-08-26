'use client';

import type { QuestionFieldDef } from '@kgc/shared';
import { fieldsForTier } from '@kgc/scripts/src/lib/question-forms';

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
  const asked = fieldsForTier(fields, ticketTypeId);
  if (asked.length === 0) return null;

  return (
    <>
      {asked.map((f) => (
        <div className="field" key={f.id}>
          <Field field={f} error={errors?.[f.id]} />
        </div>
      ))}
    </>
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
