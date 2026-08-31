'use client';

import { useActionState } from 'react';
import { CheckboxField, FormActions, SubmitButton, Textarea } from '../../../form';
import {
  commitSponsorImportAction,
  previewSponsorImportAction,
  type SponsorImportState,
} from './actions';

/**
 * Import a sponsor list from the sponsorship spreadsheet.
 *
 * Two steps — preview, then commit — copied from the attendee importer, and for
 * the same reason: the way an import goes wrong is silently, with every value
 * one column to the left. Showing the first three rows *as the importer
 * understood them* is the only question worth answering before writing to the
 * collection the public sponsor page renders.
 *
 * Sharper here than for attendees, in one respect: an attendee import that
 * lands in the wrong column is discovered at the badge desk. A sponsor import
 * that does is discovered by the sponsor.
 */
export function SponsorImportForm() {
  const [preview, previewAction] = useActionState<SponsorImportState, FormData>(
    previewSponsorImportAction,
    { stage: 'idle' },
  );
  const [result, commitAction] = useActionState<SponsorImportState, FormData>(
    commitSponsorImportAction,
    { stage: 'idle' },
  );

  const state = result.stage === 'done' || result.error ? result : preview;

  if (state.stage === 'done') {
    return (
      <>
        <div className="whova-banner success" role="status">
          <div>{state.message}</div>
        </div>
        <p className="whova-form-description">
          Nothing was removed. A sponsor missing from the file stays on the list — an import is
          additive, because a truncated export must not quietly take a paying sponsor off the
          public website.
        </p>
      </>
    );
  }

  return (
    <>
      {state.error ? (
        <div className="whova-banner danger" role="alert">
          <div>{state.error}</div>
        </div>
      ) : null}

      {state.stage === 'idle' && (
        <form action={previewAction}>
          {/*
            A bare `<input type="file">` rather than `Field`, which would put
            `.whova-text-input` on it: that class is a sized text box, and a file
            input styled as one renders its button inside a box that does not fit
            it. The label and hint use the same classes `Field` would.
          */}
          <div className="whova-form-group">
            <div className="whova-form-label">
              <label htmlFor="sponsor-csv">CSV file</label>
            </div>
            <input id="sponsor-csv" name="file" type="file" accept=".csv,text/csv" />
            <p className="whova-form-description">
              Needs a <strong>Company</strong> and a <strong>Tier</strong> column. Website, Booth,
              Main contact, Contact email, Description and Logo URL are used if present. Column
              names are matched loosely, so &ldquo;Sponsorship Level&rdquo; and
              &ldquo;Organisation&rdquo; both work.
            </p>
          </div>

          <Textarea
            name="pasted"
            label="…or paste it"
            rows={5}
            placeholder={'Company,Tier,Website\nAcme Graphs,gold,https://acme.example'}
            style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}
          />

          <FormActions>
            <SubmitButton pendingLabel="Reading…">Check the file</SubmitButton>
          </FormActions>
        </form>
      )}

      {state.stage === 'preview' && (
        <>
          <p style={{ fontSize: 13 }}>
            <strong>{state.validCount}</strong> of {state.totalRows} rows look importable
            {state.errors && state.errors.length > 0 ? <> — {state.errors.length} have problems</> : null}.
          </p>

          {state.sample && state.sample.length > 0 && (
            <>
              <p className="whova-form-description" style={{ marginBottom: 4 }}>
                The first rows, as the importer understood them. Check the values landed under the
                right headings before committing.
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
            <div style={{ marginTop: 12 }}>
              <p className="whova-form-error-message" style={{ marginBottom: 4 }}>
                Problems, by line number as your spreadsheet shows them:
              </p>
              <ul
                className="muted"
                style={{ fontSize: 12, lineHeight: 1.6, maxHeight: 200, overflowY: 'auto' }}
              >
                {state.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
              {state.errors.length > 50 && (
                <p className="whova-form-description">
                  …and {state.errors.length - 50} more, not shown.
                </p>
              )}
            </div>
          )}

          <form action={commitAction} style={{ marginTop: 14 }}>
            <input type="hidden" name="csv" value={state.csv ?? ''} />
            {state.errors && state.errors.length > 0 && (
              <CheckboxField
                name="allowPartial"
                label={`Import the ${state.validCount} good rows anyway and leave the rest`}
              />
            )}
            <FormActions>
              <SubmitButton pendingLabel="Importing…">
                Import {state.validCount} sponsors
              </SubmitButton>
            </FormActions>
          </form>
        </>
      )}
    </>
  );
}
