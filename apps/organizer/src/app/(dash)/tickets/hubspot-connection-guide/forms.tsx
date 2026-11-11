'use client';

import { useCallback, useEffect, useState } from 'react';
import { ActionForm, CheckboxField, FieldSet, FormActions, FormBanner, Field, SubmitButton, useFormAction } from '../../form';
import {
  connectHubspotAction,
  createKgcPropertiesAction,
  disconnectHubspotAction,
  loadHubspotMappingAction,
  saveHubspotSettingsAction,
  syncAllHubspotAction,
  testHubspotAction,
  type HubspotState,
  type MappingRow,
  type SettingsValues,
} from './actions';

/**
 * Every control on this screen answers right under itself, and the answer
 * stays until the owner edits that form or presses the control again. A
 * result banner at the top of a long form is a result nobody sees (T334).
 */
function useResult(state: HubspotState, pending: boolean) {
  const [dismissed, setDismissed] = useState<HubspotState | null>(null);
  return { show: !pending && state !== dismissed, dismiss: () => setDismissed(state) };
}

function Result({ state, show }: { state: HubspotState; show: boolean }) {
  if (!show || (!state.ok && !state.error)) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <FormBanner state={state} />
      {state.problems?.length ? (
        // `whova-form-error-message` is a flex row for one line of text; a list of problems must stack.
        <ul className="whova-form-error-message hubspot-problems" role="alert" style={{ display: 'block', listStyle: 'disc outside', margin: '8px 0 0', paddingLeft: 18 }}>
          {state.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {state.ok && state.warning ? (
        <div className="whova-banner warning" role="status" style={{ marginTop: 8 }}>
          <div>{state.warning}</div>
        </div>
      ) : null}
    </div>
  );
}

const isRedirect = (err: unknown) => String((err as { digest?: unknown } | null)?.digest ?? '').startsWith('NEXT_REDIRECT');

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/**
 * Test, Disconnect and the token box. One component across connected and not
 * connected, so the Disconnect answer is still on screen after the page
 * re-renders without the Disconnect button.
 */
export function ConnectionControls({ connected }: { connected: boolean }) {
  const [disconnected, setDisconnected] = useState<HubspotState | null>(null);
  return (
    <>
      {connected ? (
        <div style={{ margin: '12px 0 20px' }}>
          <TestAndDisconnect onDisconnected={setDisconnected} />
        </div>
      ) : disconnected?.ok ? (
        <div className="whova-banner success" role="status" style={{ marginBottom: 16 }}>
          <div>{disconnected.message}</div>
        </div>
      ) : null}
      <ConnectForm connected={connected} />
    </>
  );
}

/** Paste a token. The box is never filled in from the server: the token does not leave it. */
function ConnectForm({ connected }: { connected: boolean }) {
  const [state, run] = useFormAction(connectHubspotAction, {}, { resetOnSuccess: true });
  const result = useResult(state, run.pending);
  return (
    <ActionForm run={run} onChange={result.dismiss}>
      <Field
        name="token"
        type="password"
        label={connected ? 'Replace the access token' : 'Private app access token'}
        placeholder="pat-na1-..."
        autoComplete="off"
        spellCheck={false}
        maxLength={500}
        width="lg"
        required
      />
      <FormActions style={{ marginTop: 8 }}>
        <SubmitButton pendingLabel="Testing…">Save and test</SubmitButton>
      </FormActions>
      <Result state={state} show={result.show} />
    </ActionForm>
  );
}

function TestAndDisconnect({ onDisconnected }: { onDisconnected: (s: HubspotState) => void }) {
  const [tested, test] = useFormAction(testHubspotAction, {});
  const testResult = useResult(tested, test.pending);
  const [gone, disconnect] = useFormAction(() => disconnectHubspotAction(), {}, { onSuccess: onDisconnected });
  const goneResult = useResult(gone, disconnect.pending);
  return (
    <div>
      <div style={{ alignItems: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <ActionForm run={test}>
          <SubmitButton variant="secondary" small pendingLabel="Testing…">
            Test connection
          </SubmitButton>
        </ActionForm>
        {/* An inline confirm, as ConfirmButton draws it, but answered like every other control here. */}
        <details style={{ display: 'inline-block' }}>
          <summary className="whova-btn-main small danger" style={{ cursor: 'pointer', listStyle: 'none' }}>
            Disconnect
          </summary>
          <ActionForm
            run={disconnect}
            style={{
              background: 'var(--surface-alt)',
              border: '1px solid var(--hairline)',
              borderRadius: 4,
              marginTop: 8,
              maxWidth: '100%',
              padding: 12,
              width: 320,
            }}
          >
            <div style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
              The token is deleted and the sync stops. Contacts already in HubSpot stay there. Your field mapping and
              the sync log are kept for when you connect again.
            </div>
            <SubmitButton variant="danger" small pendingLabel="Working…" style={{ width: '100%' }}>
              Disconnect HubSpot
            </SubmitButton>
          </ActionForm>
        </details>
      </div>
      <Result state={tested} show={testResult.show} />
      {gone.error ? <Result state={gone} show={goneResult.show} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

type Load =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; rows: MappingRow[]; values: SettingsValues; revision: number; refreshing?: boolean };

/**
 * The mapping table, fetched from the browser once the page is up: listing
 * HubSpot's properties takes a HubSpot call, and the rest of the page (status,
 * Disconnect, the sync log) must not wait on it.
 */
export function MappingPanel() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const fetchMapping = useCallback(async () => {
    setLoad((l) => (l.status === 'ready' ? { ...l, refreshing: true } : { status: 'loading' }));
    try {
      const r = await loadHubspotMappingAction();
      if (r.ok && r.rows && r.values) setLoad({ status: 'ready', rows: r.rows, values: r.values, revision: Date.now() });
      else setLoad({ status: 'error', error: r.error ?? 'Try again in a few minutes.' });
    } catch (err) {
      if (isRedirect(err)) throw err;
      setLoad({ status: 'error', error: 'Could not reach the server. Check your connection and try again.' });
    }
  }, []);

  useEffect(() => {
    void fetchMapping();
  }, [fetchMapping]);

  if (load.status === 'loading') {
    return (
      <p className="body-2 muted" role="status">
        Loading the HubSpot contact properties…
      </p>
    );
  }
  if (load.status === 'error') {
    return (
      <div className="whova-banner danger" role="alert">
        <div>
          Could not load the HubSpot contact properties. {load.error}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="whova-btn-main secondary small" onClick={() => void fetchMapping()}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      <div style={{ alignItems: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', marginBottom: 12 }}>
        <p className="body-2" style={{ flex: '1 1 380px', margin: 0 }}>
          Choose the HubSpot contact property each registration field goes to. Fields set to Do not send are left
          out. Create KGC properties adds one property per event field to HubSpot and maps the fields that have none.
        </p>
        <div style={{ flex: '0 1 380px' }}>
          <CreatePropertiesButton onCreated={() => void fetchMapping()} />
        </div>
      </div>
      {load.refreshing ? (
        <p className="body-2 muted" role="status">
          Loading the HubSpot contact properties…
        </p>
      ) : null}
      {/* Remounted only when the table is reloaded (after Create KGC properties), never by a save. */}
      <SettingsForm key={load.revision} rows={load.rows} values={load.values} />
    </>
  );
}

const cell = (cls: string) => `whova-table-cell ${cls}`;

function SettingsForm({ rows, values }: { rows: MappingRow[]; values: SettingsValues }) {
  const [state, run] = useFormAction(saveHubspotSettingsAction, {});
  const result = useResult(state, run.pending);
  // A row's "not available" note goes once the owner picks something else in it.
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  return (
    <ActionForm run={run} onChange={result.dismiss}>
      <div className="whova-table stack-rows-sm" role="table" style={{ marginBottom: 20 }}>
        <div className="whova-table-head" role="rowgroup">
          <div className="whova-table-row" role="row">
            <div className="whova-table-header cell-md" role="columnheader">Registration field</div>
            <div className="whova-table-header cell-fill" role="columnheader">HubSpot property</div>
          </div>
        </div>
        <div className="whova-table-body" role="rowgroup">
          <div className="whova-table-row" role="row">
            <div className={cell('cell-md')} role="cell" data-label="Registration field">
              <strong>Email</strong>
            </div>
            <div className={cell('cell-fill')} role="cell" data-label="HubSpot property">
              Email, used to match contacts
            </div>
          </div>
          {rows.map((r) => (
            <div className="whova-table-row" role="row" key={r.key}>
              <div className={cell('cell-md')} role="cell" data-label="Registration field">
                {/* One wrapper, because a table cell is a flex row and would set the hint beside the label. */}
                <div>
                  <label htmlFor={`map-${r.key}`}>
                    <strong>{r.label}</strong>
                  </label>
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {r.hint}
                  </span>
                </div>
              </div>
              <div className={cell('cell-fill')} role="cell" data-label="HubSpot property">
                <div style={{ width: '100%' }}>
                  <select
                    id={`map-${r.key}`}
                    name={`map.${r.key}`}
                    defaultValue={r.value}
                    className="whova-text-input whova-input-lg"
                    aria-invalid={r.problem && !changed.has(r.key) ? true : undefined}
                    aria-describedby={r.problem && !changed.has(r.key) ? `map-${r.key}-problem` : undefined}
                    onChange={() => setChanged((s) => new Set(s).add(r.key))}
                  >
                    <option value="">Do not send</option>
                    {r.options.map((o) => (
                      <option key={o.name} value={o.name}>
                        {o.text}
                      </option>
                    ))}
                  </select>
                  {r.problem && !changed.has(r.key) ? (
                    <div id={`map-${r.key}-problem`} className="whova-form-error-message" style={{ marginTop: 4 }}>
                      {r.problem}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <FieldSet
        legend="When a contact is already in HubSpot"
        hint="Properties starting with kgc_ belong to this sync and are always kept current."
      >
        <div>
          <label className="whova-radio-label">
            <input className="whova-radio-input" type="radio" name="mode" value="fill-empty" defaultChecked={values.mode === 'fill-empty'} />
            <span>Fill only empty fields</span>
          </label>
        </div>
        <div>
          <label className="whova-radio-label">
            <input className="whova-radio-input" type="radio" name="mode" value="overwrite" defaultChecked={values.mode === 'overwrite'} />
            <span>Always overwrite</span>
          </label>
        </div>
        <p className="body-2 muted" style={{ margin: '8px 0 0' }}>
          With Fill only empty fields, a property that does not start with kgc_ keeps the first value it was given. A
          status sent there, such as Registration status or Checked in, does not change after a refund, cancellation
          or check-in.
        </p>
      </FieldSet>

      <FieldSet legend="New contacts">
        <CheckboxField name="createContacts" label="Create a contact for registrants HubSpot does not have" defaultChecked={values.createContacts} />
        <CheckboxField name="setLeadStage" label="Set Lifecycle stage to Lead on new contacts" defaultChecked={values.setLeadStage} />
      </FieldSet>
      <p className="body-2 muted" style={{ marginTop: -8 }}>
        HubSpot does not let apps set marketing status, so new contacts arrive as non-marketing contacts, which cost
        nothing. To make them marketing contacts, change it in HubSpot under Settings &gt; Integrations &gt; Marketing
        Contacts, or with a workflow.
      </p>

      <FieldSet legend="Sync">
        <CheckboxField
          name="enabled"
          label="Enabled"
          description="When on, new orders, refunds, ticket changes and check-ins are sent to HubSpot as they happen."
          defaultChecked={values.enabled}
        />
      </FieldSet>

      <FormActions>
        <SubmitButton>Save</SubmitButton>
      </FormActions>
      <Result state={state} show={result.show} />
    </ActionForm>
  );
}

function CreatePropertiesButton({ onCreated }: { onCreated: () => void }) {
  const [state, run] = useFormAction(createKgcPropertiesAction, {}, { onSuccess: onCreated });
  const result = useResult(state, run.pending);
  return (
    <ActionForm run={run} style={{ textAlign: 'right' }}>
      <SubmitButton variant="secondary" small pendingLabel="Creating…">
        Create KGC properties
      </SubmitButton>
      <div style={{ textAlign: 'left' }}>
        <Result state={state} show={result.show} />
      </div>
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/** `disabledReason` set means the button is off, and says why. */
export function SyncAllButton({ disabledReason }: { disabledReason?: string }) {
  const [state, run] = useFormAction(syncAllHubspotAction, {});
  const result = useResult(state, run.pending);
  return (
    <ActionForm run={run} style={{ maxWidth: 420 }}>
      <SubmitButton pendingLabel="Queuing…" disabled={Boolean(disabledReason)}>
        Sync all now
      </SubmitButton>
      {disabledReason ? (
        <p className="body-2 muted" style={{ margin: '8px 0 0' }}>
          {disabledReason}
        </p>
      ) : null}
      <Result state={state} show={result.show} />
    </ActionForm>
  );
}
