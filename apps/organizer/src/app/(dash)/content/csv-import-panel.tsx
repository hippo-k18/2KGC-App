'use client';

import { useActionState } from 'react';
import type { ProgrammeImportState } from '@/lib/csv-import';
import { CheckboxField, FormActions, SubmitButton, Textarea } from '../form';

/**
 * The preview-then-commit importer, as one component.
 *
 * The sponsor importer proved this screen and it is identical for speakers,
 * tracks and sessions — the only thing that varies between them is the noun and
 * the sentence describing the columns. Three copies of it would be three places
 * to fix the next thing learned about how a spreadsheet goes wrong, which is
 * the argument `lib/csv-import.ts` already makes about the parser: written
 * eight times badly or once well.
 *
 * ── Why two steps ───────────────────────────────────────────────────────────
 *
 * The way an import goes wrong is silently, with every value one column to the
 * left. Nothing about that result looks wrong until somebody reads a badge, or
 * walks to a room the agenda invented. So the first step writes nothing and
 * shows the first rows **as the importer understood them**, which is the only
 * question worth answering before touching a collection every phone is
 * listening to.
 *
 * The parsed file travels between the steps in a hidden field rather than being
 * uploaded twice, so the thing committed is provably the thing previewed.
 *
 * ── The server actions arrive as props ──────────────────────────────────────
 *
 * Each entity keeps its own pair in its own `actions.ts`, beside the writer
 * they call and inside the `'use server'` boundary that gives them
 * `requireOrganizer()`. Passing them in means this component holds no
 * knowledge of what is being imported and cannot drift from any one of them.
 */
export function CsvImportPanel({
  previewAction,
  commitAction,
  nounSingular,
  nounPlural,
  columnHint,
  placeholder,
  /** Shown after a successful run — what the import did *not* do. */
  additiveNote,
}: {
  previewAction: (prev: ProgrammeImportState, formData: FormData) => Promise<ProgrammeImportState>;
  commitAction: (prev: ProgrammeImportState, formData: FormData) => Promise<ProgrammeImportState>;
  nounSingular: string;
  nounPlural: string;
  columnHint: React.ReactNode;
  placeholder: string;
  additiveNote: React.ReactNode;
}) {
  const [preview, runPreview] = useActionState<ProgrammeImportState, FormData>(previewAction, {
    stage: 'idle',
  });
  const [result, runCommit] = useActionState<ProgrammeImportState, FormData>(commitAction, {
    stage: 'idle',
  });

  // A commit that failed falls back to the preview it came from, so the file is
  // still in hand and the organizer can tick "import the good rows anyway"
  // rather than starting again.
  const state = result.stage === 'done' || result.error ? result : preview;
  const id = `csv-${nounSingular}`;

  if (state.stage === 'done') {
    return (
      <>
        <div className="whova-banner success" role="status">
          <div>{state.message}</div>
        </div>
        {state.failed && state.failed.length > 0 && (
          <RowProblems
            title={`${state.failed.length} row${state.failed.length === 1 ? '' : 's'} could not be imported:`}
            items={state.failed.map((f) => `Line ${f.line}${f.name ? ` (${f.name})` : ''}: ${f.message}`)}
          />
        )}
        <p className="whova-form-description">{additiveNote}</p>
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
        <form action={runPreview}>
          {/*
            A bare `<input type="file">` rather than `Field`: that component puts
            `.whova-text-input` on its control, which is a sized text box, and a
            file input styled as one draws its button inside a box too small for
            it. The label and hint use the classes `Field` would.
          */}
          <div className="whova-form-group">
            <div className="whova-form-label">
              <label htmlFor={id}>CSV file</label>
            </div>
            <input id={id} name="file" type="file" accept=".csv,text/csv" />
            <p className="whova-form-description">{columnHint}</p>
          </div>

          <Textarea
            name="pasted"
            label="…or paste it"
            rows={5}
            placeholder={placeholder}
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
            {state.errors && state.errors.length > 0 ? (
              <> — {state.errors.length} have problems</>
            ) : null}
            .
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
                    {state.sample.map((sampleRow, i) => (
                      <tr key={i}>
                        {Object.values(sampleRow).map((v, j) => (
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
            <RowProblems
              title="Problems, by line number as your spreadsheet shows them:"
              items={state.errors.map((e) => `Line ${e.line}: ${e.message}`)}
            />
          )}

          {state.failed && state.failed.length > 0 && (
            <RowProblems
              title="Rows that parsed but could not be resolved:"
              items={state.failed.map((f) => `Line ${f.line}${f.name ? ` (${f.name})` : ''}: ${f.message}`)}
            />
          )}

          <form action={runCommit} style={{ marginTop: 14 }}>
            <input type="hidden" name="csv" value={state.csv ?? ''} />
            {((state.errors && state.errors.length > 0) ||
              (state.failed && state.failed.length > 0)) && (
              <CheckboxField
                name="allowPartial"
                label={`Import the good rows anyway and leave the rest`}
              />
            )}
            <FormActions>
              <SubmitButton pendingLabel="Importing…">
                Import {state.validCount} {state.validCount === 1 ? nounSingular : nounPlural}
              </SubmitButton>
            </FormActions>
          </form>
        </>
      )}
    </>
  );
}

/**
 * Line-numbered problems, capped.
 *
 * Fifty is where a list stops being a list and starts being a wall — and a file
 * with more than fifty bad rows has one systematic fault, which the first few
 * lines name as well as all four hundred would.
 */
function RowProblems({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ marginTop: 12 }}>
      <p className="whova-form-error-message" style={{ marginBottom: 4 }}>
        {title}
      </p>
      <ul className="muted" style={{ fontSize: 12, lineHeight: 1.6, maxHeight: 200, overflowY: 'auto' }}>
        {items.slice(0, 50).map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
      {items.length > 50 && (
        <p className="whova-form-description">…and {items.length - 50} more, not shown.</p>
      )}
    </div>
  );
}
