'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { commitImportAction, previewImportAction, type ImportState } from './import-actions';

/**
 * Import attendees from a CSV.
 *
 * Two steps: preview, then commit. The preview shows the first three rows as
 * they were understood — which is the only question worth answering before
 * writing four hundred registrations, because the way an import goes wrong is
 * silently, with every name in the company column.
 */
export function ImportForm() {
  const [preview, previewAction] = useActionState<ImportState, FormData>(previewImportAction, {
    stage: 'idle',
  });
  const [result, commitAction] = useActionState<ImportState, FormData>(commitImportAction, {
    stage: 'idle',
  });

  const state = result.stage === 'done' || result.error ? result : preview;

  if (state.stage === 'done') {
    return (
      <>
        <p className="ok">{state.message}</p>
        <p className="muted" style={{ fontSize: 12 }}>
          Imported attendees get a registration and appear on the list above.{' '}
          <strong>No order is created</strong> — they did not pay through us, and inventing one
          would put money in the revenue figures that nobody received.
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
            <label className="whova-form-label" htmlFor="file">
              CSV file
            </label>
            <input id="file" name="file" type="file" accept=".csv,text/csv" />
            <p className="muted" style={{ fontSize: 12 }}>
              Needs a <strong>Name</strong> and an <strong>Email</strong> column. Ticket type,
              company and job title are used if present. Column names are matched loosely, so
              &ldquo;E-mail Address&rdquo; and &ldquo;Organisation&rdquo; both work.
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
              placeholder={'Name,Email,Ticket\nAda Nakamura,ada@example.com,Main Conference'}
              style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}
            />
          </div>

          <SubmitButton idle="Check the file" busy="Reading…" />
        </form>
      )}

      {state.stage === 'preview' && (
        <>
          <p style={{ fontSize: 13 }}>
            <strong>{state.validCount}</strong> of {state.totalRows} rows look importable
            {state.errors && state.errors.length > 0 && (
              <> — {state.errors.length} have problems</>
            )}
            .
          </p>

          {state.sample && state.sample.length > 0 && (
            <>
              <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                The first rows, as the importer understood them. Check the values landed under the
                right headings before committing.
              </p>
              <div className="whova-table-wrapper">
                <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                  <thead>
                    <tr>
                      {Object.keys(state.sample[0]).map((k) => (
                        <th key={k} style={{ borderBottom: '1px solid var(--hairline)', padding: 6, textAlign: 'left' }}>
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {state.sample.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((v, j) => (
                          <td key={j} style={{ borderBottom: '1px solid var(--hairline)', padding: 6 }}>
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
            <div style={{ marginTop: 12 }}>
              <p className="error" style={{ fontSize: 12, marginBottom: 4 }}>
                Problems, by line number as your spreadsheet shows them:
              </p>
              <ul className="muted" style={{ fontSize: 12, lineHeight: 1.6, maxHeight: 200, overflowY: 'auto' }}>
                {state.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
              {state.errors.length > 50 && (
                <p className="muted" style={{ fontSize: 12 }}>
                  …and {state.errors.length - 50} more. Shown in full so nothing is silently
                  truncated.
                </p>
              )}
            </div>
          )}

          <form action={commitAction} style={{ marginTop: 14 }}>
            <input type="hidden" name="csv" value={state.csv ?? ''} />
            {state.errors && state.errors.length > 0 && (
              <label style={{ display: 'block', fontSize: 13, marginBottom: 10 }}>
                <input type="checkbox" name="allowPartial" /> Import the {state.validCount} good
                rows anyway and leave the rest
              </label>
            )}
            <SubmitButton idle={`Import ${state.validCount} attendees`} busy="Importing…" />
          </form>
        </>
      )}
    </>
  );
}

/**
 * Split out because `useFormStatus` only reports the form it sits inside. An
 * import of four hundred rows is sequential and takes several seconds; an
 * unchanged button is a button somebody presses again, and although the writes
 * are idempotent the second run is a confusing wait.
 */
function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? busy : idle}
    </button>
  );
}
