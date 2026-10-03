'use client';

import { useActionState } from 'react';
import type { Assignment } from '@kgc/scripts/src/lib/reviews';
import { reviewAction, type ReviewState } from './actions';

/**
 * The scoring form: one score and one remark per criterion, then the overall
 * comments.
 *
 * Two submits on one form, like the author's: "Save draft" keeps what is typed
 * without counting it, "Submit review" requires every score. A review that has
 * been submitted stays submitted when edited, so the second button goes away
 * rather than offering a way to drop out of the mean by accident.
 *
 * The two comment boxes are separate on purpose (`ReviewDoc`): one is for the
 * committee, one may be forwarded to the author, and a single box doing both is
 * how a private remark reaches a rejection email.
 */
export function ReviewForm({ assignment, token }: { assignment: Assignment; token: string }) {
  const [state, action] = useActionState<ReviewState, FormData>(reviewAction, {});
  const errors = state.fieldErrors ?? {};
  const own = assignment.own;
  const submitted = own.status === 'submitted';

  return (
    <form action={action} className="checkout">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="submissionId" value={assignment.submissionId} />

      {state.error && (
        <p className="notice bad" role="alert">
          {state.error}
        </p>
      )}

      <h2 style={{ marginTop: 0 }}>Your scores</h2>

      {assignment.rubric.map((c) => (
        <div key={c.id} style={{ marginBottom: 22 }}>
          <div className="field">
            <label htmlFor={`score_${c.id}`}>{c.label} *</label>
            {c.description && <p className="hint">{c.description}</p>}
            <select
              id={`score_${c.id}`}
              name={`score_${c.id}`}
              defaultValue={own.scores[c.id] !== undefined ? String(own.scores[c.id]) : ''}
            >
              <option value="">Choose a score…</option>
              {Array.from({ length: c.max - c.min + 1 }, (_, i) => c.min + i).map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === c.min ? ' (lowest)' : n === c.max ? ' (highest)' : ''}
                </option>
              ))}
            </select>
            {errors[`score_${c.id}`] && (
              <p className="hint" style={{ color: '#991b1b' }} role="alert">
                {errors[`score_${c.id}`]}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor={`comment_${c.id}`}>Comment on {c.label.toLowerCase()}</label>
            <textarea
              id={`comment_${c.id}`}
              name={`comment_${c.id}`}
              rows={2}
              maxLength={1000}
              defaultValue={own.criterionComments[c.id]}
            />
            {errors[`comment_${c.id}`] && (
              <p className="hint" style={{ color: '#991b1b' }} role="alert">
                {errors[`comment_${c.id}`]}
              </p>
            )}
          </div>
        </div>
      ))}

      <div className="field">
        <label htmlFor="confidence">How confident are you in this review?</label>
        <select id="confidence" name="confidence" defaultValue={own.confidence ? String(own.confidence) : ''}>
          <option value="">Prefer not to say</option>
          <option value="1">1. Outside my field</option>
          <option value="2">2. Some familiarity</option>
          <option value="3">3. Fairly confident</option>
          <option value="4">4. Confident</option>
          <option value="5">5. This is my area</option>
        </select>
        {errors.confidence && (
          <p className="hint" style={{ color: '#991b1b' }} role="alert">
            {errors.confidence}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="commentsToCommittee">Comments for the committee</label>
        <textarea
          id="commentsToCommittee"
          name="commentsToCommittee"
          rows={5}
          maxLength={4000}
          defaultValue={own.commentsToCommittee}
        />
        <p className="hint">Only the organizers and the other reviewers see this. The author never does.</p>
      </div>

      <div className="field">
        <label htmlFor="commentsToAuthors">Comments for the author</label>
        <textarea
          id="commentsToAuthors"
          name="commentsToAuthors"
          rows={5}
          maxLength={4000}
          defaultValue={own.commentsToAuthors}
        />
        <p className="hint">The organizers may pass this on with the decision. Your name is not attached.</p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button type="submit" name="finish" value="1" className="btn btn-primary">
          {submitted ? 'Save changes' : 'Submit review'}
        </button>
        {!submitted && (
          <button type="submit" name="finish" value="0" className="btn btn-outline">
            Save draft
          </button>
        )}
      </div>
    </form>
  );
}
