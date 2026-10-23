/**
 * The HubSpot CRM v3 calls the contact sync makes (T333, reworked in T335),
 * and nothing else.
 *
 * ── Read by email, then update by id or create ──────────────────────────────
 *
 * HubSpot's `batch/upsert` with `idProperty: email` does not support partial
 * upserts ("Partial upserts are not supported when using email as the
 * idProperty for contacts",
 * https://developers.hubspot.com/docs/guides/crm/using-object-apis), so this
 * client never calls it. Instead, per batch of at most 100:
 *
 * 1. `POST /crm/v3/objects/contacts/batch/read` with `idProperty: "email"`
 *    finds the contacts and their current values. A contact found through a
 *    secondary address comes back with its primary `email`, so results are
 *    matched on `email` or `hs_additional_emails`.
 *    https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/batch/post-crm-v3-objects-contacts-batch-read
 * 2. `POST /crm/v3/objects/contacts/batch/update` with `inputs: [{ id, properties }]`,
 *    `id` being the HubSpot record id, for contacts that exist.
 *    https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/batch/post-crm-v3-objects-contacts-batch-update
 * 3. `POST /crm/v3/objects/contacts/batch/create` with
 *    `inputs: [{ properties, associations: [], objectWriteTraceId }]` for new
 *    ones. Batch create is the endpoint HubSpot documents multi-status (207)
 *    with `objectWriteTraceId` for, so each failed input is tied to its email.
 *    https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/batch/post-crm-v3-objects-contacts-batch-create
 *    https://developers.hubspot.com/docs/guides/crm/using-object-apis (multi-status)
 *
 * ── One bad record never fails its neighbours ───────────────────────────────
 *
 * HubSpot answers some batches with a single 400 or 409 for the whole request
 * when one input is bad. `sendIsolating` then splits the batch in half and
 * tries again, down to the single record at fault, which is reported on its
 * own with HubSpot's reason. A batch of 100 with one bad address costs at most
 * about 14 extra calls, and the other 99 go through.
 *
 * Plain `fetch`, like `email.ts` does for Resend: a timeout on every call, and
 * a retry with backoff on 429 and 5xx, except HubSpot's daily limit, which no
 * retry within the day can fix. The token goes in one header and is never
 * logged, thrown or returned; error text is redacted, including the exact token.
 *
 * `HUBSPOT_API_BASE` points the client at a local fake for tests, and is
 * honoured only for a loopback address, so a stray setting on the server can
 * never send a token anywhere but HubSpot.
 */

import {
  HUBSPOT_BATCH,
  HUBSPOT_SCOPES,
  errorKind,
  hubspotErrorMessage,
  isRetryableStatus,
  missingScopes,
  networkErrorMessage,
  readableValidation,
  redact,
  retryDelayMs,
  type CurrentContact,
  type HubspotErrorKind,
  type HubspotRawProperty,
} from './hubspot-core.js';

const DEFAULT_BASE = 'https://api.hubapi.com';

export function hubspotApiBase(): string {
  const env = process.env.HUBSPOT_API_BASE?.trim();
  if (!env) return DEFAULT_BASE;
  try {
    const u = new URL(env);
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return env.replace(/\/+$/, '');
  } catch {
    // fall through
  }
  return DEFAULT_BASE;
}

/** A call HubSpot refused, or could not be made, with a message an organizer can read. */
export class HubspotError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly kind: HubspotErrorKind,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'HubspotError';
  }
  get tokenRejected(): boolean {
    return this.kind === 'auth';
  }
  /** About one record rather than HubSpot or the connection: worth isolating. */
  get recordLevel(): boolean {
    return this.kind === 'bad-request' || this.kind === 'conflict';
  }
}

export interface ClientOptions {
  /** Retries after the first try, for 429 and 5xx. */
  retries?: number;
  timeoutMs?: number;
  /** Replaced in tests so retries do not really wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** For a button on the screen: answer within about 10 seconds, no long retries. */
export const INTERACTIVE: ClientOptions = { retries: 0, timeoutMs: 10_000 };

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function call<T>(token: string, method: string, path: string, body: unknown, opts: ClientOptions = {}): Promise<{ status: number; body: T }> {
  const retries = opts.retries ?? 4;
  const sleep = opts.sleep ?? realSleep;
  let last: HubspotError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${hubspotApiBase()}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      last = new HubspotError(0, networkErrorMessage(timedOut), timedOut ? 'timeout' : 'network');
      if (attempt < retries) await sleep(retryDelayMs(attempt, 500));
      continue;
    }
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (res.ok || res.status === 207) return { status: res.status, body: parsed as T };
    const kind = errorKind(res.status, parsed);
    last = new HubspotError(res.status, redact(hubspotErrorMessage(res.status, parsed), token), kind, parsed);
    if (!isRetryableStatus(res.status) || kind === 'daily' || attempt === retries) throw last;
    await sleep(retryDelayMs(attempt, res.status));
  }
  throw last ?? new HubspotError(0, networkErrorMessage(false), 'network');
}

export interface TokenCheck {
  portalId?: number;
  /** The scopes HubSpot says the token has, when it says. */
  scopes?: string[];
  /** Required scopes the token lacks; empty when all four are there. */
  missing: string[];
}

/**
 * Does the token work, and does it carry the four scopes? Reads the token's
 * own details (`POST /oauth/v2/private-apps/get/access-token-info`, which
 * returns its `scopes` and `hubId`). If HubSpot will not describe the token,
 * the two read scopes are probed with harmless reads and the write scopes are
 * reported as unknown rather than assumed.
 * https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview
 */
export async function testHubspotToken(token: string, opts: ClientOptions = INTERACTIVE): Promise<TokenCheck> {
  await call(token, 'GET', '/crm/v3/objects/contacts?limit=1', undefined, opts);
  try {
    const info = await call<{ scopes?: unknown; hubId?: unknown }>(token, 'POST', '/oauth/v2/private-apps/get/access-token-info', { tokenKey: token }, opts);
    const scopes = Array.isArray(info.body?.scopes) ? info.body.scopes.filter((s): s is string => typeof s === 'string') : undefined;
    const portalId = typeof info.body?.hubId === 'number' ? info.body.hubId : undefined;
    if (scopes) return { portalId, scopes, missing: missingScopes(scopes) };
  } catch (err) {
    if (err instanceof HubspotError && (err.tokenRejected || err.kind === 'network' || err.kind === 'timeout')) throw err;
  }
  // Fallback: prove what can be proved without writing anything.
  const missing: string[] = [];
  try {
    await call(token, 'GET', '/crm/v3/properties/contacts', undefined, opts);
  } catch (err) {
    if (err instanceof HubspotError && err.kind === 'scope') missing.push('crm.schemas.contacts.read');
    else throw err;
  }
  return { missing, scopes: undefined };
}

export { HUBSPOT_SCOPES };

export async function listContactProperties(token: string, opts?: ClientOptions): Promise<HubspotRawProperty[]> {
  const r = await call<{ results?: HubspotRawProperty[] }>(token, 'GET', '/crm/v3/properties/contacts', undefined, opts);
  return Array.isArray(r.body?.results) ? r.body.results : [];
}

export async function createContactProperty(
  token: string,
  def: { name: string; label: string; type: string; fieldType: string; options?: unknown[] },
  opts?: ClientOptions,
): Promise<'created' | 'exists'> {
  try {
    await call(
      token,
      'POST',
      '/crm/v3/properties/contacts',
      { name: def.name, label: def.label, type: def.type, fieldType: def.fieldType, groupName: 'contactinformation', description: 'Written by the KGC registration sync.', ...(def.options ? { options: def.options } : {}) },
      opts,
    );
    return 'created';
  } catch (err) {
    if (err instanceof HubspotError && err.status === 409) return 'exists';
    throw err;
  }
}

interface BatchError {
  status?: string;
  category?: string;
  message?: string;
  context?: Record<string, string[]>;
}

/**
 * Current values of `properties` for up to 100 people by email, keyed by the
 * email we asked with. A contact found through a secondary address is matched
 * through `hs_additional_emails`. People HubSpot does not have are absent.
 */
export async function readContactsByEmail(
  token: string,
  emails: readonly string[],
  properties: readonly string[],
  opts?: ClientOptions,
): Promise<Map<string, CurrentContact>> {
  const out = new Map<string, CurrentContact>();
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return out;
  if (wanted.length > HUBSPOT_BATCH) throw new Error(`readContactsByEmail takes at most ${HUBSPOT_BATCH} emails.`);
  const props = [...new Set(['email', 'hs_additional_emails', ...properties])];
  const r = await call<{ results?: { id?: string; properties?: Record<string, string | null> }[] }>(
    token,
    'POST',
    '/crm/v3/objects/contacts/batch/read',
    { idProperty: 'email', properties: props, propertiesWithHistory: [], inputs: wanted.map((id) => ({ id })) },
    opts,
  );
  const want = new Set(wanted);
  for (const row of r.body?.results ?? []) {
    if (typeof row.id !== 'string' || !row.properties) continue;
    const primary = row.properties.email?.trim().toLowerCase();
    const extra = String(row.properties.hs_additional_emails ?? '')
      .split(/[;,]/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    for (const e of [primary, ...extra]) {
      if (e && want.has(e) && !out.has(e)) out.set(e, { id: row.id, properties: row.properties });
    }
  }
  return out;
}

/**
 * `readContactsByEmail`, but a whole-batch 400 (HubSpot refusing the read
 * because of one malformed address) is split in half until the bad address
 * is alone, like writes are, so it fails on its own and the rest are read.
 */
export async function readContactsIsolating(
  token: string,
  emails: readonly string[],
  properties: readonly string[],
  opts?: ClientOptions,
): Promise<{ found: Map<string, CurrentContact>; failed: Map<string, string> }> {
  const found = new Map<string, CurrentContact>();
  const failed = new Map<string, string>();
  const go = async (part: readonly string[]): Promise<void> => {
    if (part.length === 0) return;
    try {
      for (const [k, v] of await readContactsByEmail(token, part, properties, opts)) found.set(k, v);
    } catch (err) {
      if (!(err instanceof HubspotError) || !err.recordLevel) throw err;
      if (part.length === 1) {
        failed.set(part[0].trim().toLowerCase(), err.message);
        return;
      }
      const mid = Math.ceil(part.length / 2);
      await go(part.slice(0, mid));
      await go(part.slice(mid));
    }
  };
  await go([...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]);
  return { found, failed };
}

export interface SendOutcome {
  /** Emails HubSpot accepted. */
  ok: Set<string>;
  /** Email to HubSpot's reason, for records HubSpot refused. */
  failed: Map<string, string>;
  /** Email to existing HubSpot id, for a create HubSpot refused because the contact exists. */
  exists: Map<string, string>;
}

const emptyOutcome = (): SendOutcome => ({ ok: new Set(), failed: new Map(), exists: new Map() });

function merge(a: SendOutcome, b: SendOutcome): SendOutcome {
  for (const e of b.ok) a.ok.add(e);
  for (const [k, v] of b.failed) a.failed.set(k, v);
  for (const [k, v] of b.exists) a.exists.set(k, v);
  return a;
}

/**
 * Send `items` with `send`; when HubSpot refuses the whole batch for a reason
 * about one record (400, 409), split it and try the halves, until the bad
 * record is alone and can be reported on its own. Anything else (bad token,
 * HubSpot down, rate limit) is thrown for the caller to stop on.
 */
export async function sendIsolating<T extends { email: string }>(
  items: readonly T[],
  send: (batch: readonly T[]) => Promise<SendOutcome>,
): Promise<SendOutcome> {
  if (items.length === 0) return emptyOutcome();
  try {
    return await send(items);
  } catch (err) {
    if (!(err instanceof HubspotError) || !err.recordLevel) throw err;
    if (items.length === 1) {
      const out = emptyOutcome();
      const existing = existingIdFrom(err);
      if (existing) out.exists.set(items[0].email, existing);
      else out.failed.set(items[0].email, err.message);
      return out;
    }
    const mid = Math.ceil(items.length / 2);
    return merge(await sendIsolating(items.slice(0, mid), send), await sendIsolating(items.slice(mid), send));
  }
}

/** HubSpot's 409 for a create names the contact that already has the address: "Contact already exists. Existing ID: 123". */
function existingIdFrom(err: HubspotError): string | undefined {
  if (err.kind !== 'conflict') return undefined;
  const msg = typeof (err.body as { message?: unknown } | undefined)?.message === 'string' ? (err.body as { message: string }).message : err.message;
  return /Existing ID:\s*(\d+)/i.exec(msg)?.[1];
}

function batchErrors(errors: BatchError[] | undefined, token: string, byTrace: (id: string) => string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of errors ?? []) {
    const message = redact(readableValidation(e.message ?? 'HubSpot refused this contact.'), token).slice(0, 300);
    for (const id of [...(e.context?.objectWriteTraceId ?? []), ...(e.context?.ids ?? [])]) {
      const email = byTrace(id);
      if (email) out.set(email, message);
    }
  }
  return out;
}

/** Update up to 100 existing contacts by HubSpot id (`batch/update`). */
export async function updateContacts(
  token: string,
  inputs: readonly { email: string; id: string; properties: Record<string, string> }[],
  opts?: ClientOptions,
): Promise<SendOutcome> {
  const out = emptyOutcome();
  if (inputs.length === 0) return out;
  if (inputs.length > HUBSPOT_BATCH) throw new Error(`updateContacts takes at most ${HUBSPOT_BATCH} contacts.`);
  const r = await call<{ errors?: BatchError[] }>(
    token,
    'POST',
    '/crm/v3/objects/contacts/batch/update',
    { inputs: inputs.map((i) => ({ id: i.id, properties: i.properties })) },
    opts,
  );
  const byId = new Map(inputs.map((i) => [i.id, i.email]));
  const failed = batchErrors(r.body?.errors, token, (id) => byId.get(id));
  if (r.status === 207 && failed.size === 0 && (r.body?.errors?.length ?? 0) > 0) {
    // An error HubSpot did not tie to a record: refuse the batch so it is split, never claim success.
    throw new HubspotError(400, redact(r.body?.errors?.[0]?.message ?? 'HubSpot refused part of the batch.', token), 'bad-request', r.body);
  }
  for (const i of inputs) {
    const msg = failed.get(i.email);
    if (msg) out.failed.set(i.email, msg);
    else out.ok.add(i.email);
  }
  return out;
}

/** Create up to 100 contacts (`batch/create`), each traced by its email. */
export async function createContacts(
  token: string,
  inputs: readonly { email: string; properties: Record<string, string> }[],
  opts?: ClientOptions,
): Promise<SendOutcome> {
  const out = emptyOutcome();
  if (inputs.length === 0) return out;
  if (inputs.length > HUBSPOT_BATCH) throw new Error(`createContacts takes at most ${HUBSPOT_BATCH} contacts.`);
  const r = await call<{ errors?: BatchError[] }>(
    token,
    'POST',
    '/crm/v3/objects/contacts/batch/create',
    { inputs: inputs.map((i) => ({ properties: i.properties, associations: [], objectWriteTraceId: i.email })) },
    opts,
  );
  const emails = new Set(inputs.map((i) => i.email));
  const failed = batchErrors(r.body?.errors, token, (id) => (emails.has(id.trim().toLowerCase()) ? id.trim().toLowerCase() : undefined));
  if (r.status === 207 && failed.size === 0 && (r.body?.errors?.length ?? 0) > 0) {
    throw new HubspotError(400, redact(r.body?.errors?.[0]?.message ?? 'HubSpot refused part of the batch.', token), 'bad-request', r.body);
  }
  for (const i of inputs) {
    const msg = failed.get(i.email);
    const existing = msg ? /Existing ID:\s*(\d+)/i.exec(msg)?.[1] : undefined;
    if (existing) out.exists.set(i.email, existing);
    else if (msg) out.failed.set(i.email, msg);
    else out.ok.add(i.email);
  }
  return out;
}
