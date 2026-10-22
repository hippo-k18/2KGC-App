import { createHmac } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { OWNER, ownerSessionId } from './people';

/**
 * Shared pieces of the T323 run: the private emulator over REST, sessions
 * minted the way `lib/auth.ts` signs them, and the editor's common moves.
 */

export const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-learn-v2-e2e';
export const BUCKET = `${PROJECT}.appspot.com`;
export const WEB = process.env.WEB_URL ?? 'http://localhost:3324';
export const DASH = process.env.E2E_URL ?? 'http://localhost:3323';
export const SHOTS = process.env.LEARN_E2E_SHOTS;
const FS = `${process.env.FIRESTORE_REST ?? 'http://127.0.0.1:8323'}/v1/projects/${PROJECT}/databases/(default)/documents`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const SECRET = process.env.CONSOLE_SESSION_SECRET ?? '';

export type Json = Record<string, unknown>;

export function decode(v: Json | undefined): unknown {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (((v.arrayValue as Json).values as Json[] | undefined) ?? []).map(decode);
  if ('mapValue' in v) {
    const fields = ((v.mapValue as Json).fields ?? {}) as Record<string, Json>;
    return Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

export function encode(v: unknown): Json {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as Json).filter(([, x]) => x !== undefined).map(([k, x]) => [k, encode(x)])) } };
}

export async function fsGet(path: string): Promise<Json | null> {
  const r = await fetch(`${FS}/${path}`, { headers: H });
  if (r.status === 404) return null;
  const j = (await r.json()) as { fields?: Record<string, Json> };
  return Object.fromEntries(Object.entries(j.fields ?? {}).map(([k, v]) => [k, decode(v)]));
}

export async function fsList(path: string): Promise<(Json & { id: string })[]> {
  const r = await fetch(`${FS}/${path}?pageSize=300`, { headers: H });
  const j = (await r.json()) as { documents?: { name: string; fields?: Record<string, Json> }[] };
  return (j.documents ?? []).map((d) => ({
    id: d.name.split('/').pop()!,
    ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, decode(v)])),
  }));
}

/** Writes a whole document from plain values. */
export async function fsSet(path: string, data: Json) {
  const fields = (encode(data).mapValue as { fields: Record<string, Json> }).fields;
  const r = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(`fsSet ${path}: ${r.status} ${await r.text()}`);
}

/** Merges plain values into a document (only the named fields). */
export async function fsPatch(path: string, data: Json) {
  const fields = (encode(data).mapValue as { fields: Record<string, Json> }).fields;
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const r = await fetch(`${FS}/${path}?${mask}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(`fsPatch ${path}: ${r.status} ${await r.text()}`);
}

export async function fsDelete(path: string) {
  await fetch(`${FS}/${path}`, { method: 'DELETE', headers: H });
}

/** Deletes every document in the emulator (this suite's own, on its own port). */
export async function wipeFirestore() {
  await fetch(`${process.env.FIRESTORE_REST ?? 'http://127.0.0.1:8323'}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: 'DELETE',
  });
}

export const learnDoc = () => fsGet('pageLayouts/learn');

export function memberId(email: string): string {
  return `team_${ownerSessionId(email).slice(0, 32)}`;
}

export async function cookieFor(email: string): Promise<string> {
  const doc = email === OWNER ? await fsGet(`ownerSessions/${ownerSessionId(email)}`) : await fsGet(`teamMembers/${memberId(email)}`);
  const epoch = (email === OWNER ? doc?.epoch : doc?.sessionEpoch) as string;
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({ email, expiresAt: now + 8 * 3600e3, epoch, keep: false, refreshedAt: now })).toString(
    'base64url',
  );
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
}

export async function signedIn(browser: Browser, email: string, viewport = { width: 1280, height: 860 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([
    { name: 'kgc_console_session', value: await cookieFor(email), domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  return ctx;
}

/** Page errors and console errors seen on a page, so a test can assert there were none. */
export function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // The website's own port answers some asset requests made from the preview; a refused connection to it is not the editor's fault.
    if (/Failed to load resource/.test(t)) return;
    errors.push(`[console] ${t.slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e).slice(0, 300)}`));
  return errors;
}

export async function openEditor(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  (page as Page & { errors?: string[] }).errors = watch(page);
  await page.goto('/content/learn-page');
  await page.waitForSelector('.le-root');
  await page.waitForTimeout(800);
  return page;
}

export function errorsOf(page: Page): string[] {
  return (page as Page & { errors?: string[] }).errors ?? [];
}

export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: opts.fullPage });
}

/** The save chip in the editor bar. */
export const saveChip = (page: Page) => page.locator('.le-chips .le-chip').first();

export async function waitSaved(page: Page, timeout = 30_000) {
  await expect(saveChip(page)).toHaveText(/Saved/, { timeout });
}

/** The website's /learn, read fresh: `next start` revalidates every 30 seconds, so this polls. */
export async function webLearnHtml(path = '/learn'): Promise<string> {
  const r = await fetch(`${WEB}${path}`, { headers: { 'cache-control': 'no-cache' } });
  return r.text();
}

export async function waitForWeb(pred: (html: string) => boolean, path = '/learn', timeout = 90_000) {
  await expect.poll(async () => pred(await webLearnHtml(path)), { timeout, intervals: [1000, 2000, 3000] }).toBe(true);
}
