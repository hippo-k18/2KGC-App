'use client';

import { useState } from 'react';
import localFont from 'next/font/local';
import type { CallFormFieldDef, CallSessionType } from '@kgc/shared';
import { fieldsForSessionType, typeLabel } from '@kgc/scripts/src/lib/cfp-core';
import type { BuiltInField, BuiltInLayout } from '@kgc/scripts/src/lib/cfp-form-layout';
import { fieldsForTier } from '@kgc/scripts/src/lib/question-forms';

/** The website's own face, so the preview wraps lines where the real page does. */
const openSans = localFont({
  src: [{ path: './open-sans-var.woff2', weight: '300 800', style: 'normal' }],
  display: 'swap',
  adjustFontFallback: 'Arial',
});

/**
 * The public form as an applicant sees it, with every control disabled (T301).
 *
 * ── A copy of the website's markup, not an embed ───────────────────────────
 *
 * The public page shows the form only while the call is open, so an iframe of
 * it would show "Opens 1 November" for the whole time an organizer is building
 * the form. This draws the same fields in the same order with the website's
 * own measurements (`.cfp-preview` in `globals.css`), from the same field list
 * the builder shows. `apps/web/src/app/submit/submission-form.tsx` and
 * `submission-fields.tsx` are the originals; the built-in labels are held to
 * them by `cfp-form-layout.test.ts`.
 *
 * The session type switcher is the one live control, because which questions
 * a workshop is asked is the thing an organizer most needs to check.
 */
export function FormPreview({
  layout,
  fields,
  sessionTypes,
  closeDay,
  publicUrl,
}: {
  layout: BuiltInLayout;
  fields: CallFormFieldDef[];
  sessionTypes: CallSessionType[];
  /** "Sunday 31 January 2027", or nothing when the close date is not set. */
  closeDay?: string;
  publicUrl: string;
}) {
  const [type, setType] = useState<string>(sessionTypes.length === 1 ? sessionTypes[0] : '');
  const asked = fieldsForTier(fieldsForSessionType(fields, type || undefined), '');
  const shown = (f: BuiltInField) => !f.sessionTypes?.length || f.sessionTypes.includes(type as CallSessionType);

  return (
    <>
      <div className="cfp-preview-bar">
        {sessionTypes.length > 1 && (
          <label className="cfp-preview-switch">
            <span>Preview as</span>
            <select
              className="whova-text-input"
              value={type}
              onChange={(e) => setType(e.target.value)}
              aria-label="Preview the form as this session type"
            >
              <option value="">No session type chosen yet</option>
              {sessionTypes.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </select>
          </label>
        )}
        <a href={publicUrl} target="_blank" rel="noreferrer">
          Open the public page
        </a>
      </div>
      <p className="body-2" style={{ margin: '0 0 12px' }}>
        {sessionTypes.length > 1
          ? 'Some questions are only asked of one session type. Pick a type to see the form as those applicants do.'
          : 'This is the form exactly as applicants see it.'}{' '}
        Nothing here can be typed into or sent.
      </p>

      <div className={`cfp-preview ${openSans.className}`} aria-label="Preview of the public form">
        <p className="notice">
          {closeDay ? (
            <>
              Submissions close on <strong>{closeDay}</strong>.{' '}
            </>
          ) : null}
          No account needed. We will email you a link back to your submission.
        </p>
        <form className="checkout" onSubmit={(e) => e.preventDefault()} aria-disabled="true">
          <fieldset disabled>
            {layout.before.filter(shown).map((f) => (
              <Fixed key={f.id} field={f} value={f.id === 'sessionType' && type ? typeLabel(type) : undefined} />
            ))}
            {asked.map((f) => (
              <div className="field" key={f.id}>
                <Question field={f} />
              </div>
            ))}
            {layout.after.filter(shown).map((f) => (
              <Fixed key={f.id} field={f} />
            ))}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <button type="submit" className="btn btn-primary">
                Submit
              </button>
              <button type="button" className="btn btn-outline">
                Save as a draft
              </button>
            </div>
          </fieldset>
          <p className="hint" style={{ marginTop: 14 }}>
            A draft is not submitted and nobody reads it. You can come back to it from the link we
            email you until the call closes{closeDay ? ` on ${closeDay}` : ''}. Once you press Submit,
            the submission is final and can no longer be changed.
          </p>
        </form>
      </div>
    </>
  );
}

/** One of the fields the website always draws. */
function Fixed({ field: f, value }: { field: BuiltInField; value?: string }) {
  const id = `pv_${f.id}`;
  return (
    <div className="field">
      <label htmlFor={id}>
        {f.label}
        {f.required ? ' *' : ''}
      </label>
      {f.input === 'select' ? (
        <select id={id} value={value ?? ''} onChange={() => {}}>
          <option value="">Choose one…</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : f.input === 'long-text' ? (
        <textarea id={id} rows={f.id === 'abstract' ? 10 : 4} />
      ) : (
        <input id={id} type={f.input === 'text' ? undefined : f.input} />
      )}
      {f.hint && <p className="hint">{f.hint}</p>}
    </div>
  );
}

/** One of the organizer's questions, drawn as `submission-fields.tsx` draws it. */
function Question({ field: f }: { field: CallFormFieldDef }) {
  const id = `pv_q_${f.id}`;
  const hint = f.helpText ? <p className="hint">{f.helpText}</p> : null;

  if (f.kind === 'description') {
    return (
      <p className="hint" style={{ fontSize: '0.95rem', marginTop: 0 }}>
        {f.prompt}
      </p>
    );
  }
  if (f.kind === 'checkbox' || f.kind === 'consent') {
    return (
      <>
        <label htmlFor={id} className="check" style={{ fontWeight: 400 }}>
          <input id={id} type="checkbox" />
          <span>
            {f.prompt}
            {f.required ? ' *' : ''}
          </span>
        </label>
        {hint}
      </>
    );
  }

  const label = (
    <label htmlFor={id}>
      {f.prompt}
      {f.required ? ' *' : ''}
    </label>
  );
  switch (f.kind) {
    case 'long-text':
      return (
        <>
          {label}
          <textarea id={id} rows={5} />
          {hint}
        </>
      );
    case 'choice':
      return (
        <>
          {label}
          <select id={id} defaultValue="">
            <option value="">{f.required ? 'Choose one…' : 'No answer'}</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {hint}
        </>
      );
    case 'multi-choice':
      return (
        <>
          {label}
          <div className="checks">
            {(f.options ?? []).map((o) => (
              <label key={o} className="check" style={{ fontWeight: 400 }}>
                <input type="checkbox" />
                <span>{o}</span>
              </label>
            ))}
          </div>
          {hint}
        </>
      );
    default:
      return (
        <>
          {label}
          <input id={id} />
          {hint}
        </>
      );
  }
}
