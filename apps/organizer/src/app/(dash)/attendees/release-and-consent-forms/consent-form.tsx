'use client';

import { useActionState } from 'react';
import type { ConsentFormRow } from '@/lib/consents';
import { saveConsentFormAction, type ConsentFormState } from './actions';

/**
 * Write or reword a release.
 *
 * A textarea rather than a rich editor, and that is a decision rather than a
 * shortcut: `ConsentFormDoc.body` is plain text because it is hashed, diffed
 * between versions, and rendered into a public page people are being asked to
 * trust. Markup pasted out of Word into a page like that is an injection into
 * exactly the wrong page, and a hash over HTML is a hash over whatever the
 * editor decided to emit that day.
 *
 * The warning above the textarea is the whole reason this component is not just
 * three inputs. An organizer fixing a typo needs to know, *before* they save,
 * that every signature already given is about to become outstanding.
 */
export function ConsentForm({ existing }: { existing?: ConsentFormRow }) {
  const [state, action] = useActionState<ConsentFormState, FormData>(saveConsentFormAction, {});
  const signed = existing?.signatureCount ?? 0;

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}

      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="ok" role="status">
          {state.message}
        </p>
      )}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="title">
          Title
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={120}
          defaultValue={existing?.title}
          placeholder="Photography, filming and recording release"
        />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="audience">
          Who signs it
        </label>
        <select
          id="audience"
          name="audience"
          defaultValue={existing?.audience ?? 'attendee'}
          style={{ maxWidth: 320 }}
        >
          <option value="attendee">Attendees</option>
          <option value="speaker">Speakers</option>
          <option value="volunteer">Volunteers</option>
        </select>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="body">
          The wording
        </label>
        {signed > 0 && (
          <p className="error" style={{ fontSize: 12 }}>
            {signed} {signed === 1 ? 'person has' : 'people have'} already signed this. Changing
            the text below publishes version {(existing?.version ?? 1) + 1} and they will each be
            asked to sign again.
          </p>
        )}
        <textarea
          id="body"
          name="body"
          rows={14}
          required
          defaultValue={existing?.body}
          placeholder={
            'I agree that the Knowledge Graph Conference may photograph, film and record me at the event, and may publish those recordings.'
          }
          style={{ fontSize: 13, lineHeight: 1.6 }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          Plain text. Blank lines separate paragraphs.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="status">
          Status
        </label>
        <select
          id="status"
          name="status"
          defaultValue={existing?.status ?? 'draft'}
          style={{ maxWidth: 320 }}
        >
          <option value="draft">Draft: nobody can sign it</option>
          <option value="published">Published: collecting signatures</option>
          <option value="cancelled">Cancelled: stop collecting</option>
        </select>
        <p className="muted" style={{ fontSize: 12 }}>
          A draft cannot be signed, in the app or through a link.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="required">
          Required
        </label>
        <label style={{ alignItems: 'center', display: 'flex', fontSize: 13, gap: 8 }}>
          <input
            id="required"
            name="required"
            type="checkbox"
            defaultChecked={existing?.required ?? true}
          />
          Everyone in this audience is expected to sign
        </label>
        <p className="muted" style={{ fontSize: 12 }}>
          This sets who counts as outstanding. It does not block check-in or sessions.
        </p>
      </div>

      <div className="whova-form-row">
        <button type="submit" className="whova-btn-main primary">
          {existing ? 'Save' : 'Create form'}
        </button>
      </div>
    </form>
  );
}
