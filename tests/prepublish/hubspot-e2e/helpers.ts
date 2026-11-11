import { createCipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { OWNER, sha } from './people';

/**
 * Shared pieces of the T333 run (updated for T335). The emulator REST helpers come from the Learn
 * run (they read FIRESTORE_REST and GCLOUD_PROJECT, which run.sh sets to this
 * run's own); sessions, the fake HubSpot and the action ids are this run's.
 */
export { fsDelete, fsGet, fsList, fsPatch, fsSet, watch, type Json } from '../learn-v2-e2e/helpers';
import { fsGet } from '../learn-v2-e2e/helpers';

export const ROOT = path.resolve(__dirname, '../../..');
export const DASH = process.env.E2E_URL ?? 'http://localhost:3333';
export const FAKE = process.env.FAKE_HUBSPOT_URL ?? 'http://127.0.0.1:12133';
export const PAGE = '/tickets/hubspot-connection-guide';
export const SHOTS = process.env.HUBSPOT_E2E_SHOTS ?? path.resolve(ROOT, '../orchestrator/reports/T335-shots');
/** The fake's default token. Made up; the fake accepts nothing else. */
/** Built from parts at runtime so no source line looks like a HubSpot token to secret scanners. */
export const FAKE_TOKEN = ['pat', 'na1', '00000000', '0000', '4000', '8000', '000000000001'].join('-');
/** Well formed, and refused by the fake. */
export const REFUSED_TOKEN = ['pat', 'na1', '11111111', '1111', '4111', '8111', '111111111111'].join('-');

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-hubspot-e2e';
const FS_ROOT = `${process.env.FIRESTORE_REST ?? 'http://127.0.0.1:8333'}/v1/projects/${PROJECT}/databases/(default)/documents`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const SECRET = process.env.CONSOLE_SESSION_SECRET ?? '';

export function memberId(email: string): string {
  return `team_${sha(email).slice(0, 32)}`;
}

/** A console session cookie, signed the way `lib/session-core.ts` signs one. */
export async function cookieFor(email: string): Promise<string> {
  const doc = email === OWNER ? await fsGet(`ownerSessions/${sha(email)}`) : await fsGet(`teamMembers/${memberId(email)}`);
  const epoch = (email === OWNER ? doc?.epoch : doc?.sessionEpoch) as string;
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({ email, expiresAt: now + 8 * 3600e3, epoch, keep: false, refreshedAt: now })).toString('base64url');
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
}

export async function signedIn(browser: Browser, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addCookies([
    { name: 'kgc_console_session', value: await cookieFor(email), domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  return ctx;
}

/** Every text body the browser received in this context, so the token can be looked for in all of it. */
export function recordBodies(ctx: BrowserContext): string[] {
  const bodies: string[] = [];
  ctx.on('response', async (r) => {
    const type = r.headers()['content-type'] ?? '';
    if (!/text|json|javascript|x-component/.test(type)) return;
    try {
      bodies.push(`${r.url()}\n${await r.text()}`);
    } catch {
      // A redirect or an aborted request has no body.
    }
  });
  return bodies;
}

// ---------------------------------------------------------------------------
// The fake HubSpot
// ---------------------------------------------------------------------------

export interface FakeRequest {
  method: string;
  path: string;
  body?: { inputs?: { id?: string; properties?: Record<string, string> }[]; idProperty?: string };
  authOk: boolean;
  status: number;
  /** Addresses HubSpot accepted a write for (batch/create, batch/update). */
  accepted?: string[];
  /** When it arrived, epoch ms. */
  at: number;
}
export interface FakeState {
  requests: FakeRequest[];
  contacts: Record<string, { id: string; properties: Record<string, string | null> }>;
  properties: { name: string; label: string; type: string; fieldType: string; hubspotDefined: boolean }[];
  mode: string;
  badEmails: string[];
}

export const PATHS = {
  read: '/crm/v3/objects/contacts/batch/read',
  update: '/crm/v3/objects/contacts/batch/update',
  create: '/crm/v3/objects/contacts/batch/create',
  upsert: '/crm/v3/objects/contacts/batch/upsert',
  properties: '/crm/v3/properties/contacts',
};
export const ALL_SCOPES = ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.schemas.contacts.read', 'crm.schemas.contacts.write'];

export async function fakeState(): Promise<FakeState> {
  return (await (await fetch(`${FAKE}/__state`)).json()) as FakeState;
}

export interface FakeOptions {
  badEmails?: string[];
  strict400?: boolean;
  strictConflict?: boolean;
  scopes?: string[];
  tokenInfo404?: boolean;
  delayMs?: number;
  delayPaths?: Record<string, number>;
  hangPaths?: string[];
}

/** Set the fake's mode. Every option not given goes back to its default, so one test's setting never leaks into the next. */
export async function fakeMode(mode: string, opts: FakeOptions = {}) {
  const body = {
    mode,
    badEmails: [],
    strict400: false,
    strictConflict: false,
    scopes: ALL_SCOPES,
    tokenInfo404: false,
    delayMs: 0,
    delayPaths: {},
    hangPaths: [],
    ...opts,
  };
  const r = await fetch(`${FAKE}/__mode`, { method: 'POST', body: JSON.stringify(body) });
  expect(r.ok).toBe(true);
}

/** Writes HubSpot accepted for this address, across the whole run. */
export function writesFor(s: FakeState, email: string): number {
  return s.requests
    .filter((r) => (r.path === PATHS.create || r.path === PATHS.update) && r.status < 300)
    .flatMap((r) => r.accepted ?? [])
    .filter((e) => e === email).length;
}

/**
 * The fake token sealed the way `hubspot-secret.ts` seals it, but under a
 * different WEB_ORDER_SECRET: what a server sees after the key was rotated.
 */
export function sealedUnderAnotherKey(token: string): string {
  const key = Buffer.from(hkdfSync('sha256', 'another-order-secret-0123456789abcdef', 'kgc-integrations', 'hubspot-token-v1', 32));
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export async function fakeReset() {
  await fetch(`${FAKE}/__reset`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// The website's trigger and the emulator
// ---------------------------------------------------------------------------

/** Run the website's queue-and-kick for these registrations, and wait for the run it logs. */
export function kick(trigger: string, ...rest: (string | { timeoutMs: number })[]): string {
  const opts = rest.find((x): x is { timeoutMs: number } => typeof x === 'object');
  const ids = rest.filter((x): x is string => typeof x === 'string');
  return execFileSync('npx', ['tsx', path.join(__dirname, 'kick.mts'), trigger, ...ids], {
    cwd: ROOT,
    env: { ...process.env, ...(opts ? { KICK_TIMEOUT_MS: String(opts.timeoutMs) } : {}) },
    encoding: 'utf8',
    timeout: 150_000,
  });
}

async function listIds(parent: string): Promise<string[]> {
  const r = await fetch(`${FS_ROOT}${parent ? `/${parent}` : ''}:listCollectionIds`, { method: 'POST', headers: H, body: JSON.stringify({ pageSize: 100 }) });
  return (((await r.json()) as { collectionIds?: string[] }).collectionIds ?? []).sort();
}

/** Every document in the emulator, as raw REST JSON, with each document's subcollections. */
export async function dumpFirestore(): Promise<string> {
  const out: string[] = [];
  async function walk(collection: string) {
    let token = '';
    do {
      const r = await fetch(`${FS_ROOT}/${collection}?pageSize=300${token ? `&pageToken=${token}` : ''}`, { headers: H });
      const j = (await r.json()) as { documents?: { name: string }[]; nextPageToken?: string };
      for (const d of j.documents ?? []) {
        out.push(JSON.stringify(d));
        const rel = d.name.split('/documents/')[1];
        for (const sub of await listIds(rel)) await walk(`${rel}/${sub}`);
      }
      token = j.nextPageToken ?? '';
    } while (token);
  }
  for (const c of await listIds('')) await walk(c);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

const DIST = process.env.ORGANIZER_DIST_DIR ?? '.next-t333-e2e';
const MANIFEST = path.resolve(ROOT, 'apps/organizer', DIST, 'server/server-reference-manifest.json');
const ACTION_FILE = /tickets\/hubspot-connection-guide\/actions\.ts$/;

/** The HubSpot screen's action ids, from the build's manifest (a dev server writes it once the page has compiled). */
export function hubspotActions(): Map<string, string> {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    node: Record<string, { workers: Record<string, { moduleId: string }>; filename?: string; exportedName?: string }>;
  };
  const out = new Map<string, string>();
  for (const [id, entry] of Object.entries(manifest.node)) {
    if (entry.filename && entry.exportedName) {
      if (ACTION_FILE.test(entry.filename)) out.set(entry.exportedName, id);
      continue;
    }
    for (const w of Object.values(entry.workers)) {
      const query = new URLSearchParams(w.moduleId.split('?')[1]?.replace(/!$/, '') ?? '');
      const list = JSON.parse(query.get('actions') ?? '[]') as [string, { id: string; exportedName: string; filename: string }[]][];
      for (const [, actions] of list) for (const a of actions) if (ACTION_FILE.test(a.filename)) out.set(a.exportedName, a.id);
    }
  }
  return out;
}

/**
 * The body React sends for an action called as `(prevState, formData)`: the
 * arguments as JSON with the form as a reference, and the form's fields
 * prefixed with that reference's number (`_1_`), as React's processReply writes them.
 */
export function formActionBody(fields: Record<string, string>): FormData {
  const fd = new FormData();
  // The form's fields first, as React writes them: the server reads the multipart
  // stream in order and builds the form the moment the root part names it.
  for (const [k, v] of Object.entries(fields)) fd.append(`_1_${k}`, v);
  fd.append('0', JSON.stringify([{}, '$K1']));
  return fd;
}

export async function postAction(email: string, at: string, id: string, body: FormData | unknown[]) {
  const headers: Record<string, string> = {
    'Next-Action': id,
    Accept: 'text/x-component',
    Cookie: `kgc_console_session=${await cookieFor(email)}`,
  };
  let payload: FormData | string;
  if (body instanceof FormData) payload = body;
  else {
    headers['Content-Type'] = 'text/plain;charset=UTF-8';
    payload = JSON.stringify(body);
  }
  const r = await fetch(`${DASH}${at}`, { method: 'POST', redirect: 'manual', headers, body: payload });
  return { status: r.status, body: await r.text(), location: r.headers.get('location') ?? r.headers.get('x-action-redirect') ?? '' };
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export async function openHubspot(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await expect(page.getByRole('heading', { name: 'Connection' })).toBeVisible();
  return page;
}

/** A sync log row, by its trigger label. */
export const logRow = (page: Page, trigger: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name: trigger, exact: true }) });

/** Sent, Created, Updated, Skipped, Failed of the newest log row for a trigger. */
export async function counts(page: Page, trigger: string): Promise<number[]> {
  const cells = await logRow(page, trigger).first().getByRole('cell').allInnerTexts();
  return cells.slice(3, 8).map((c) => Number(c.trim()));
}

export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: opts.fullPage });
}

/** The same state at 1280 and at 390 wide (`<name>-1280.png`, `<name>-390.png`), scrolled to `focus` when given. */
export async function shotBoth(page: Page, name: string, focus?: Locator) {
  for (const [w, h] of [
    [1280, 860],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    if (focus) await focus.evaluate((e) => e.scrollIntoView({ block: 'start' }));
    else await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 860 });
}

/** Wait for the lazily loaded mapping table. */
export async function mappingReady(page: Page) {
  await expect(page.locator('#map-firstName')).toBeVisible({ timeout: 20_000 });
}
