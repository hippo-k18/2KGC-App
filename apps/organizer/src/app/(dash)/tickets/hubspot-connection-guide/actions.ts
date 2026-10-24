'use server';

import { revalidatePath } from 'next/cache';
import {
  COLLECTIONS,
  HUBSPOT_SOURCE_FIELDS,
  type HubspotConfig,
  type HubspotPropertyOption,
  type HubspotSourceKey,
  type HubspotUpdateMode,
} from '@kgc/shared';
import {
  HubspotError,
  INTERACTIVE,
  createContactProperty,
  listContactProperties,
  testHubspotToken,
} from '@kgc/scripts/src/lib/hubspot-client';
import {
  checkMapping,
  compatible,
  fieldOptions,
  kgcPropertyDefs,
  looksLikeHubspotToken,
  mappableProperties,
} from '@kgc/scripts/src/lib/hubspot-core';
import {
  disconnectHubspot,
  drainHubspotQueue,
  enqueueAllRegistrations,
  isHubspotActive,
  loadHubspotToken,
  markTokenAccepted,
  markTokenRejected,
  readHubspotConfig,
  readHubspotTokenState,
  saveHubspotSettings,
  saveHubspotToken,
  savePropertyTypes,
} from '@kgc/scripts/src/lib/hubspot-sync';
import { requireOwner } from '@/lib/auth';
import { appendAudit, diff } from '@/lib/audit';
import { recordError } from '@/lib/errors';
import { db } from '@/lib/firestore';
import { SCOPES_UNCONFIRMED, UNREADABLE_TOKEN, missingScopesText } from './copy';

/**
 * Tickets › HubSpot (T333): connect a HubSpot private app, map fields, sync.
 *
 * Owners only. The screen sits under Tickets, and a HubSpot token is a key to
 * the whole CRM, so every action starts with `requireOwner()` (pinned by
 * `tests/programme/hubspot-gate.test.ts`). No action ever returns the token,
 * and nothing here logs it.
 *
 * Every HubSpot call made for a button press uses `INTERACTIVE` (about 10
 * seconds, no retries), so a hanging HubSpot costs the owner seconds rather
 * than a frozen screen, and no message promises a retry that a button press
 * does not make.
 */

const PATH = '/tickets/hubspot-connection-guide';
const TARGET = { targetPath: `${COLLECTIONS.integrations}/hubspot`, targetId: 'hubspot', subject: 'HubSpot' };

export interface HubspotState {
  ok?: boolean;
  message?: string;
  error?: string;
  /** One line per field the mapping could not use. */
  problems?: string[];
  /** Sync all now: how many people (one HubSpot contact each) were queued. */
  queued?: number;
  /** It worked, with a caveat the owner should act on. Shown under the success line. */
  warning?: string;
}

/** One row of the mapping table, built on the server so the browser gets only names and labels. */
export interface MappingRow {
  key: HubspotSourceKey;
  label: string;
  hint: string;
  /** The saved HubSpot property, or "" for Do not send. */
  value: string;
  /** The properties this field may go into (`fieldOptions`), as the dropdown shows them. */
  options: { name: string; text: string }[];
  /** Why the saved property cannot be used any more, when it cannot. */
  problem?: string;
}

export interface SettingsValues {
  enabled: boolean;
  mode: HubspotUpdateMode;
  createContacts: boolean;
  setLeadStage: boolean;
}

/** The mapping table, loaded by the browser after the page has rendered. */
export interface MappingLoad {
  ok?: boolean;
  error?: string;
  rows?: MappingRow[];
  values?: SettingsValues;
}

/** A readable sentence for the screen: HubSpot's (already plain) message, or a generic one with the raw error logged. */
function readable(err: unknown, what: string): string {
  if (err instanceof HubspotError) return err.message;
  recordError(what, err);
  return `${what}. Try again in a few minutes.`;
}

/** The saved token, or the sentence that says why there is none to use. */
async function usableToken(): Promise<{ token: string } | { error: string }> {
  const state = await readHubspotTokenState(db());
  if (state === 'none') return { error: 'No HubSpot token is saved. Paste one under Connection first.' };
  const token = state === 'ok' ? await loadHubspotToken(db()) : null;
  return token ? { token } : { error: UNREADABLE_TOKEN };
}

/** The saved token and HubSpot's writable contact properties, or a sentence saying why not. */
async function liveProperties(): Promise<{ token: string; props: HubspotPropertyOption[] } | { error: string }> {
  const t = await usableToken();
  if ('error' in t) return t;
  try {
    return { token: t.token, props: mappableProperties(await listContactProperties(t.token, INTERACTIVE)) };
  } catch (err) {
    return { error: readable(err, 'Could not read the HubSpot properties') };
  }
}

function typesFor(mapping: HubspotConfig['mapping'], props: readonly HubspotPropertyOption[]): Record<string, string> {
  const byName = new Map(props.map((p) => [p.name, p.type]));
  const out: Record<string, string> = {};
  for (const name of Object.values(mapping)) if (name && byName.has(name)) out[name] = byName.get(name)!;
  return out;
}

function settingsView(c: Pick<HubspotConfig, 'enabled' | 'mapping' | 'mode' | 'createContacts' | 'setLeadStage'>) {
  return { enabled: c.enabled, mapping: c.mapping, mode: c.mode, createContacts: c.createContacts, setLeadStage: c.setLeadStage };
}

/** Changes queue while the token is refused; once HubSpot takes a token again, send them without waiting for the timer. */
function kickDrain(actor: string): void {
  void drainHubspotQueue(db(), { trigger: 'retry', actor }).catch((err) => recordError('hubspot sync after reconnect failed', err));
}

/** Save and test: a token is stored only after HubSpot has accepted it with all four scopes. */
export async function connectHubspotAction(_prev: HubspotState, formData: FormData): Promise<HubspotState> {
  const actor = await requireOwner();
  const token = String(formData.get('token') ?? '').trim();
  if (!token) return { error: 'Paste the access token from your HubSpot private app.' };
  if (!looksLikeHubspotToken(token)) {
    return { error: 'That is not a HubSpot access token. Copy it from the Auth tab of the private app with Show token, then Copy.' };
  }

  let check: Awaited<ReturnType<typeof testHubspotToken>>;
  try {
    check = await testHubspotToken(token, INTERACTIVE);
  } catch (err) {
    if (err instanceof HubspotError && err.tokenRejected) {
      return { error: 'HubSpot refused this token. Check that you copied the whole token from the Auth tab of the app.' };
    }
    return { error: `The token was not saved. ${readable(err, 'Could not test the token')}` };
  }
  if (check.missing.length) return { error: `${missingScopesText(check.missing, 'paste the token here again')} The token was not saved.` };

  const before = await readHubspotConfig(db());
  try {
    await saveHubspotToken(db(), token, actor, check.portalId);
  } catch (err) {
    return { error: `HubSpot accepted the token but it could not be saved. ${readable(err, 'Saving the token failed')}` };
  }

  await appendAudit({
    actor,
    action: 'hubspot.connect',
    ...TARGET,
    before: { tokenLast4: before.tokenLast4 ?? null, portalId: before.portalId ?? null },
    after: { tokenLast4: token.slice(-4), portalId: check.portalId ?? null },
  });
  kickDrain(actor);
  revalidatePath(PATH);
  const parts = [check.portalId ? `Connected to HubSpot account ${check.portalId}.` : 'Connected to HubSpot.'];
  if (!before.enabled) parts.push('Turn the sync on under Field mapping when you are ready.');
  return { ok: true, message: parts.join(' '), warning: check.scopes ? undefined : SCOPES_UNCONFIRMED };
}

/** Test connection, with the saved token. A good answer clears an earlier refusal and sends what queued meanwhile. */
export async function testHubspotAction(): Promise<HubspotState> {
  const actor = await requireOwner();
  const t = await usableToken();
  if ('error' in t) return { error: t.error };
  try {
    const check = await testHubspotToken(t.token, INTERACTIVE);
    if (check.missing.length) {
      await appendAudit({ actor, action: 'hubspot.test', ...TARGET, before: {}, after: { result: 'missing-scopes', missing: check.missing } });
      return { error: missingScopesText(check.missing, 'press Test connection again') };
    }
    await markTokenAccepted(db(), check.portalId);
    await appendAudit({ actor, action: 'hubspot.test', ...TARGET, before: {}, after: { result: 'ok', portalId: check.portalId ?? null } });
    kickDrain(actor);
    revalidatePath(PATH);
    return check.scopes
      ? { ok: true, message: 'HubSpot accepted the token, and it has all four scopes.' }
      : { ok: true, message: 'HubSpot accepted the token.', warning: SCOPES_UNCONFIRMED };
  } catch (err) {
    const message = readable(err, 'Could not test the token');
    // A refused token pauses sending, as a refusal during a sync would. Changes keep queueing.
    if (err instanceof HubspotError && err.tokenRejected) await markTokenRejected(db());
    await appendAudit({ actor, action: 'hubspot.test', ...TARGET, before: {}, after: { result: 'refused', message } });
    revalidatePath(PATH);
    return { error: message };
  }
}

/** Forget the token and switch the sync off. Settings and the log are kept. Never calls HubSpot. */
export async function disconnectHubspotAction(): Promise<HubspotState> {
  const actor = await requireOwner();
  const before = await readHubspotConfig(db());
  if (!before.hasToken) return { ok: true, message: 'HubSpot is already disconnected.' };
  try {
    await disconnectHubspot(db(), actor);
  } catch (err) {
    return { error: readable(err, 'Could not disconnect') };
  }
  await appendAudit({
    actor,
    action: 'hubspot.disconnect',
    ...TARGET,
    before: { tokenLast4: before.tokenLast4 ?? null, portalId: before.portalId ?? null, enabled: before.enabled },
    after: { tokenLast4: null, enabled: false },
  });
  revalidatePath(PATH);
  return { ok: true, message: 'Disconnected. The token is deleted and the sync is off.' };
}

/**
 * The mapping table: HubSpot's contact properties, offered per field through
 * `fieldOptions`, with the saved choice and the toggles. A read, so no audit.
 * The page renders without it and asks for it from the browser, so a slow
 * HubSpot never holds up Disconnect or the sync log.
 */
export async function loadHubspotMappingAction(): Promise<MappingLoad> {
  await requireOwner();
  const [config, live] = await Promise.all([readHubspotConfig(db()), liveProperties()]);
  if ('error' in live) return { error: live.error };
  const byName = new Map(live.props.map((p) => [p.name, p]));
  const rows: MappingRow[] = HUBSPOT_SOURCE_FIELDS.map((f) => {
    const value = config.mapping[f.key] ?? '';
    const options = fieldOptions(f, live.props).map((p) => ({ name: p.name, text: `${p.label} (${p.name})` }));
    let problem: string | undefined;
    if (value && !options.some((o) => o.name === value)) {
      const prop = byName.get(value);
      problem = prop
        ? `"${prop.label}" is not a suitable place for this value. Choose another property or Do not send.`
        : `"${value}" is no longer in HubSpot. Choose another property or Do not send.`;
      // Kept in the list so the select shows what is saved, and saving it again is refused.
      options.unshift({ name: value, text: `${prop?.label ?? value}, not available` });
    }
    return { key: f.key, label: f.label, hint: f.hint, value, options, problem };
  });
  return {
    ok: true,
    rows,
    values: { enabled: config.enabled, mode: config.mode, createContacts: config.createContacts, setLeadStage: config.setLeadStage },
  };
}

/** Field mapping, update mode, the two toggles and the Enabled switch, checked against HubSpot's live property list. */
export async function saveHubspotSettingsAction(_prev: HubspotState, formData: FormData): Promise<HubspotState> {
  const actor = await requireOwner();
  const mode = String(formData.get('mode') ?? '');
  if (mode !== 'fill-empty' && mode !== 'overwrite') return { error: 'Choose how existing contacts are updated.' };

  const input: Record<string, string> = {};
  for (const f of HUBSPOT_SOURCE_FIELDS) input[f.key] = String(formData.get(`map.${f.key}`) ?? '');

  const live = await liveProperties();
  if ('error' in live) return { error: `Nothing was saved. ${live.error}` };
  const checked = checkMapping(input, live.props);
  if (!checked.ok) return { error: 'Nothing was saved. Fix the mapping:', problems: checked.problems };

  const before = await readHubspotConfig(db());
  const enabled = formData.get('enabled') === 'on';
  if (enabled && !before.hasToken) return { error: 'Save a token before turning the sync on.' };

  const patch = {
    enabled,
    mapping: checked.mapping,
    mode: mode as HubspotConfig['mode'],
    createContacts: formData.get('createContacts') === 'on',
    setLeadStage: formData.get('setLeadStage') === 'on',
  };
  try {
    await savePropertyTypes(db(), typesFor(checked.mapping, live.props));
    await saveHubspotSettings(db(), patch, actor);
  } catch (err) {
    return { error: readable(err, 'Could not save the settings') };
  }

  const d = diff(settingsView(before), patch);
  if (d.changed.length) await appendAudit({ actor, action: 'hubspot.settings', ...TARGET, before: d.before, after: d.after });
  revalidatePath(PATH);
  return {
    ok: true,
    message: enabled
      ? before.enabled
        ? 'Saved. The sync is on.'
        : 'Saved. The sync is on: new orders, refunds, ticket changes and check-ins now go to HubSpot.'
      : 'Saved. The sync is off.',
  };
}

/**
 * Create the `kgc_<year>_` properties in HubSpot and map every field that is
 * not mapped yet to its own. A property that already exists is reused.
 */
export async function createKgcPropertiesAction(): Promise<HubspotState> {
  const actor = await requireOwner();
  const t = await usableToken();
  if ('error' in t) return { error: t.error };
  const { token } = t;

  const defs = kgcPropertyDefs();
  const created: string[] = [];
  const existing: string[] = [];
  for (const def of defs) {
    try {
      const r = await createContactProperty(token, { name: def.name, label: def.label, type: def.type, fieldType: def.fieldType, options: def.options }, INTERACTIVE);
      (r === 'created' ? created : existing).push(def.name);
    } catch (err) {
      if (created.length) await appendAudit({ actor, action: 'hubspot.createProperties', ...TARGET, before: {}, after: { created } });
      return { error: `Stopped at "${def.label}"${created.length ? ` after creating ${created.length}` : ''}. ${readable(err, 'Could not create the property')}` };
    }
  }

  const live = await liveProperties();
  if ('error' in live) return { error: `The properties are in HubSpot, but the mapping was not updated. ${live.error}` };
  const before = await readHubspotConfig(db());
  const mapping: Partial<Record<HubspotSourceKey, string>> = { ...before.mapping };
  const used = new Set(Object.values(mapping).filter(Boolean));
  const byName = new Map(live.props.map((p) => [p.name, p]));
  const mapped: string[] = [];
  for (const def of defs) {
    const field = HUBSPOT_SOURCE_FIELDS.find((f) => f.key === def.key);
    const prop = byName.get(def.name);
    if (!field || !prop || mapping[def.key] || used.has(def.name) || !compatible(field.kind, prop) || !fieldOptions(field, [prop]).length) continue;
    mapping[def.key] = def.name;
    used.add(def.name);
    mapped.push(field.label);
  }
  const checked = checkMapping(mapping, live.props);
  if (!checked.ok) return { error: 'The properties exist but the mapping could not be updated.', problems: checked.problems };
  try {
    await savePropertyTypes(db(), typesFor(checked.mapping, live.props));
    await saveHubspotSettings(db(), { mapping: checked.mapping }, actor);
  } catch (err) {
    return { error: readable(err, 'Could not save the mapping') };
  }

  await appendAudit({
    actor,
    action: 'hubspot.createProperties',
    ...TARGET,
    before: { mapping: before.mapping },
    after: { created, existing, mapping: checked.mapping },
  });
  revalidatePath(PATH);
  const parts = [
    created.length ? `Created ${created.length} ${created.length === 1 ? 'property' : 'properties'} in HubSpot.` : 'All the KGC properties were already in HubSpot.',
    mapped.length ? `Mapped ${mapped.join(', ')}.` : 'No unmapped fields were left to map.',
  ];
  return { ok: true, message: parts.join(' ') };
}

/** Sync all now: queue every registration and start sending without waiting for it. */
export async function syncAllHubspotAction(): Promise<HubspotState> {
  const actor = await requireOwner();
  const config = await readHubspotConfig(db());
  if (!config.hasToken) return { error: 'Connect HubSpot first.' };
  if ((await readHubspotTokenState(db())) === 'unreadable' || config.tokenUnreadableAt) return { error: UNREADABLE_TOKEN };
  if (config.tokenRejectedAt) return { error: 'HubSpot refused the saved token. Paste a new one, or press Test connection once it is fixed in HubSpot.' };
  if (!isHubspotActive(config)) return { error: 'Turn the sync on under Field mapping first.' };

  let queued: number;
  try {
    queued = await enqueueAllRegistrations(db());
  } catch (err) {
    return { error: readable(err, 'Could not queue the attendees') };
  }
  // Not awaited: a few thousand contacts take minutes, and the log shows the run when it ends.
  void drainHubspotQueue(db(), { trigger: 'manual', actor }).catch((err) => recordError('hubspot sync failed', err));

  await appendAudit({ actor, action: 'hubspot.syncAll', ...TARGET, before: {}, after: { queued } });
  revalidatePath(PATH);
  return {
    ok: true,
    queued,
    message: `Queued ${queued} ${queued === 1 ? 'person' : 'people'}, one HubSpot contact each. Sending has started. Refresh the page in a minute to see the run in the sync log.`,
  };
}
