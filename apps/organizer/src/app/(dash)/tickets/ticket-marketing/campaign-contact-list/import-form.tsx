'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  commitContactsAction,
  previewContactsAction,
  type ContactImportState,
} from './actions';

/**
 * Import a contact list from a CSV.
 *
 * Preview then commit, the same two steps the attendee importer uses. The one
 * difference is the **list name**, which is required before the file is even
 * read: an import with no list cannot be segmented afterwards, and "everyone we
 * have ever met" is not something you can send an email to responsibly.
 */
export function ContactImportForm({ existingLists }: { existingLists: string[] }) {
  const [preview, previewAction] = useActionState<ContactImportState, FormData>(
    previewContactsAction,
    { stage: 'idle' },
  );
  const [result, commitAction] = useActionState<ContactImportState, FormData>(commitContactsAction, {
    stage: 'idle',
  });

  const state = result.stage === 'done' || result.error ? result : preview;

  if (state.stage === 'done') {
    return (
      <>
        <p className="ok">{state.message}</p>
        {state.errors && state.errors.length > 0 && (
          <ul className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            {state.errors.map((e, i) => (
              <li key={i}>
                Line {e.line}: {e.message}
              </li>
            ))}
          </ul>
        )}
        <p className="muted" style={{ fontSize: 12 }}>
          Contacts are <strong>not</strong> registrations. Nobody imported here holds a ticket or
          appears on the attendee list — they are people to email, and folding them together would
          put non-attendees into the collection that decides who gets through the door.
        </p>
      </>
    );
  }

  return (
    <>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      {state.stage === 'idle' && (
        <form action={previewAction}>
          <div className="whova-form-row">
            <label className="whova-form-label" htmlFor="list">
              List name
            </label>
            <input
              id="list"
              name="list"
              required
              maxLength={60}
              placeholder="KGC 2026 attendees"
              list="existing-lists"
              style={{ maxWidth: 320 }}
            />
            <datalist id="existing-lists">
              {existingLists.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
            <p className="muted" style={{ fontSize: 12 }}>
              Contacts can be on several lists at once, and re-importing{' '}
              <strong>adds</strong> to their lists rather than replacing them — so somebody on last
              year&rsquo;s list who also joins the workshop waitlist stays on both.
            </p>
          </div>

          <div className="whova-form-row">
            <label className="whova-form-label" htmlFor="file">
              CSV file
            </label>
            <input id="file" name="file" type="file" accept=".csv,text/csv" />
            <p className="muted" style={{ fontSize: 12 }}>
              Needs an <strong>Email</strong> column and nothing else. Name, company and source are
              used if present. Column names are matched loosely, so &ldquo;E-mail Address&rdquo; and
              &ldquo;Organisation&rdquo; both work.
            </p>
          </div>

          <div className="whova-form-row">
            <label className="whova-form-label" htmlFor="pasted">
              …or paste it
            </label>
            <textarea
              id="pasted"
              name="pasted"
              rows={5}
              placeholder={'Email,Name,Company\nada@example.com,Ada Nakamura,Acme'}
              style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}
            />
          </div>

          <Submit idle="Check the file" busy="Reading…" />
        </form>
      )}

      {state.stage === 'preview' && (
        <>
          <p style={{ fontSize: 13 }}>
            <strong>{state.validCount}</strong> of {state.totalRows} rows have a usable address
            {state.errors && state.errors.length > 0 ? <> — {state.errors.length} do not</> : null}.
            They will go on <strong>{state.list}</strong>.
          </p>

          {state.sample && state.sample.length > 0 && (
            <>
              <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                The first rows, as the importer understood them. Check the values landed under the
                right headings.
              </p>
              <div className="whova-table-wrapper">
                <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                  <thead>
                    <tr>
                      {Object.keys(state.sample[0]).map((k) => (
                        <th
                          key={k}
                          style={{
                            borderBottom: '1px solid var(--hairline)',
                            padding: 6,
                            textAlign: 'left',
                          }}
                        >
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {state.sample.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((v, j) => (
                          <td
                            key={j}
                            style={{ borderBottom: '1px solid var(--hairline)', padding: 6 }}
                          >
                            {v || <span className="muted">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {state.errors && state.errors.length > 0 && (
            <ul className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginTop: 10 }}>
              {state.errors.map((e, i) => (
                <li key={i}>
                  Line {e.line}: {e.message}
                </li>
              ))}
            </ul>
          )}

          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            ⚠️ Anyone in this file who has already unsubscribed <strong>stays unsubscribed</strong>.
            An import cannot clear a suppression — that is how a conference loses its sending domain,
            and the damage lands on the ticket receipts rather than on the newsletter that caused it.
          </p>

          <form action={commitAction} style={{ marginTop: 14 }}>
            <input type="hidden" name="csv" value={state.csv ?? ''} />
            <input type="hidden" name="list" value={state.list ?? ''} />
            <Submit idle={`Import ${state.validCount} contacts`} busy="Importing…" />
          </form>
        </>
      )}
    </>
  );
}

/**
 * Split out because `useFormStatus` only reports the form it sits inside. An
 * import writes one document per row and takes several seconds on a large
 * file; an unchanged button is a button somebody presses again.
 */
function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? busy : idle}
    </button>
  );
}
