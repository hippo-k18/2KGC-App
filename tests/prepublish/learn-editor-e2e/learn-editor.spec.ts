import { createHmac } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { MEMBERS, OWNER, ownerSessionId } from './people';

/**
 * The three blockers the T314 gate found in the Learn page editor (T320).
 * `run.sh` starts a private emulator and a dashboard dev server and seeds the
 * people in `people.ts`; sessions are minted here the way `lib/auth.ts` does.
 */

const FS = `${process.env.FIRESTORE_REST ?? 'http://127.0.0.1:8197'}/v1/projects/${
  process.env.GCLOUD_PROJECT ?? 'demo-learn-editor-e2e'
}/databases/(default)/documents`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const SECRET = process.env.CONSOLE_SESSION_SECRET ?? '';
const SHOTS = process.env.LEARN_E2E_SHOTS;

type Json = Record<string, unknown>;

function decode(v: Json | undefined): unknown {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue as Json).values as Json[] | undefined ?? []).map(decode);
  if ('mapValue' in v) {
    const fields = ((v.mapValue as Json).fields ?? {}) as Record<string, Json>;
    return Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

async function fsGet(path: string): Promise<Json | null> {
  const r = await fetch(`${FS}/${path}`, { headers: H });
  if (r.status === 404) return null;
  const j = (await r.json()) as { fields?: Record<string, Json> };
  return Object.fromEntries(Object.entries(j.fields ?? {}).map(([k, v]) => [k, decode(v)]));
}

/** Writes raw Firestore REST fields, so a test can store a shape no client could. */
async function fsSetRaw(path: string, fields: Record<string, Json>) {
  const r = await fetch(`${FS}/${path}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(`fsSetRaw ${path}: ${r.status}`);
}

async function fsDelete(path: string) {
  await fetch(`${FS}/${path}`, { method: 'DELETE', headers: H });
}

const learnDoc = () => fsGet('pageLayouts/learn');
const draftText = async () => JSON.stringify((await learnDoc())?.draft ?? null);

function memberId(email: string): string {
  return `team_${ownerSessionId(email).slice(0, 32)}`;
}

async function cookieFor(email: string): Promise<string> {
  const doc = email === OWNER ? await fsGet(`ownerSessions/${ownerSessionId(email)}`) : await fsGet(`teamMembers/${memberId(email)}`);
  const epoch = (email === OWNER ? doc?.epoch : doc?.sessionEpoch) as string;
  const now = Date.now();
  const payload = Buffer.from(
    JSON.stringify({ email, expiresAt: now + 8 * 3600e3, epoch, keep: false, refreshedAt: now }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
}

async function signedIn(browser: Browser, email: string, viewport = { width: 1280, height: 860 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([
    { name: 'kgc_console_session', value: await cookieFor(email), domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  return ctx;
}

async function openEditor(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[console] ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 300)}`));
  await page.goto('/content/learn-page');
  await page.waitForSelector('.le-root');
  await page.waitForTimeout(800);
  return page;
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/e2e-${name}.png` });
}

const status = (page: Page) => page.locator('.le-status');

/** Click into a text block in the preview, type at its end, and leave. */
async function typeInto(page: Page, needle: string, text: string) {
  await page.locator('.le-pane-preview [data-lp-block]', { hasText: needle }).first().click();
  await page.locator('.le-pane-preview .lp-editing .ProseMirror').waitFor();
  await page.waitForTimeout(250);
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

async function waitForDraft(pred: (draft: string) => boolean, timeout = 15_000) {
  await expect.poll(async () => pred(await draftText()), { timeout }).toBe(true);
}

const SECTION = 'Continuing education';
const T1 = 'Learn how knowledge';
const T2 = 'KGC|Learn was established';

async function addBlock(page: Page, kind: string) {
  const sectionRow = page.locator('.le-ol-row.is-section', {
    has: page.locator(`[role=treeitem][aria-label^="Section: ${SECTION}"]`),
  });
  await page.locator('li', { has: sectionRow }).getByRole('button', { name: 'Add block', exact: true }).first().click();
  await page.locator('.le-pick .le-pick-item', { hasText: kind }).first().click();
  await page.waitForTimeout(200);
}

async function lastBlock(): Promise<Json | undefined> {
  const draft = (await learnDoc())?.draft as { sections: { label: string; blocks: Json[] }[] } | undefined;
  return draft?.sections.find((s) => s.label === SECTION)?.blocks.at(-1);
}

test.beforeEach(async () => {
  await fsDelete('pageLayouts/learn');
});

test('F1: an empty Image or Video block is saved, and publish names it', async ({ browser }) => {
  const ctx = await signedIn(browser, OWNER);
  const page = await openEditor(ctx);

  await addBlock(page, 'Image');
  await expect.poll(async () => (await lastBlock())?.kind, { timeout: 15_000 }).toBe('image');
  await expect(status(page)).toHaveText(/^Saved/);
  expect(((await lastBlock())?.image as Json).src).toBe('');
  await expect(page.locator('.le-pane-preview').getByText('Choose an image')).toBeVisible();
  await shot(page, 'f1-empty-image');

  // Every other edit keeps saving.
  await typeInto(page, T1, ' F1X');
  await waitForDraft((d) => d.includes('F1X'));
  await expect(status(page)).toHaveText(/^Saved/);

  await addBlock(page, 'Video');
  await expect.poll(async () => (await lastBlock())?.kind, { timeout: 15_000 }).toBe('video');
  await expect(status(page)).toHaveText(/^Saved/);
  await expect(page.locator('.le-banner.warning')).toHaveCount(0);
  await expect(page.locator('.le-set-banner')).toContainText('no video link yet');

  // Publish refuses and says which block is empty. Nothing reaches the published copy.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/Image block.*no image yet|no image yet/i);
  await shot(page, 'f1-publish-refused');
  const publishNow = dialog.getByRole('button', { name: 'Publish now' });
  if (await publishNow.isEnabled()) {
    await publishNow.click();
    await expect(dialog).toContainText(/no image yet/i);
  }
  expect((await learnDoc())?.published ?? null).toBeNull();
  await ctx.close();
});

test('F4: Undo after "Load their version" does not bring back what their save replaced', async ({ browser }) => {
  const [a, b] = MEMBERS;
  const ctxA = await signedIn(browser, a);
  const ctxB = await signedIn(browser, b);
  const A = await openEditor(ctxA);
  const B = await openEditor(ctxB);

  await typeInto(A, T1, ' A1X');
  await waitForDraft((d) => d.includes('A1X'));
  await typeInto(B, T2, ' B1X');
  await expect(B.locator('.whova-banner.danger', { hasText: 'Someone else saved' })).toBeVisible();
  await B.getByRole('button', { name: 'Load their version' }).click();
  await expect(B.locator('.le-pane-preview', { hasText: 'A1X' })).toHaveCount(1);
  await expect(B.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(B.getByRole('button', { name: 'Redo' })).toBeDisabled();

  await B.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const before = await learnDoc();
  await B.keyboard.press('Meta+z');
  await B.waitForTimeout(3000);
  const after = await learnDoc();
  expect(after?.revision).toBe(before?.revision);
  expect(await draftText()).toContain('A1X');
  expect(await draftText()).not.toContain('B1X');
  await expect(B.locator('.le-pane-preview', { hasText: 'A1X' })).toHaveCount(1);

  // B's next edit saves on top of A's, at the right revision, with no conflict.
  await typeInto(B, T2, ' B2X');
  await waitForDraft((d) => d.includes('A1X') && d.includes('B2X'));
  await expect(B.locator('.whova-banner.danger')).toHaveCount(0);
  await shot(B, 'f4-after-load-theirs');
  await ctxA.close();
  await ctxB.close();
});

for (const width of [1280, 390]) {
  test(`a learn-only member can sign out at ${width}`, async ({ browser }) => {
    const email = MEMBERS[2];
    const viewport = { width, height: width === 390 ? 844 : 860 };
    const ctx = await signedIn(browser, email, viewport);
    const page = await openEditor(ctx);
    const other = await signedIn(browser, email, viewport);
    const otherPage = await openEditor(other);

    const menuButton = page.locator('.le-bar').getByRole('button', { name: /account/i });
    await menuButton.click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText(email);
    await shot(page, `signout-menu-${width}`);

    if (width === 1280) {
      // Sign out on all devices ends the other browser too.
      await menu.getByRole('menuitem', { name: /all devices/i }).click();
      await page.waitForURL(/\/login/);
      await otherPage.goto('/content/learn-page');
      await expect(otherPage).toHaveURL(/\/login/);
    } else {
      // Plain Sign out ends only this browser.
      await menu.getByRole('menuitem', { name: /^Sign out$/ }).click();
      await page.waitForURL(/\/login/);
      await otherPage.goto('/content/learn-page');
      await expect(otherPage.locator('.le-root')).toBeVisible();
    }
    await page.goto('/content/learn-page');
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
    await other.close();
  });
}

test('F3: the phone preview keeps its scale after switching tabs', async ({ browser }) => {
  const ctx = await signedIn(browser, OWNER, { width: 390, height: 844 });
  const page = await openEditor(ctx);
  const zoom = () => page.locator('.le-frame').evaluate((el) => Number((el as HTMLElement).style.zoom));
  const before = await zoom();
  expect(before).toBeGreaterThan(0.5);
  await page.getByRole('tab', { name: /Outline/ }).click();
  await page.getByRole('tab', { name: /Settings/ }).click();
  await page.getByRole('tab', { name: /Preview/ }).click();
  await expect.poll(zoom).toBeCloseTo(before, 2);
  await shot(page, 'f3-preview-after-tab-switch-390');
  await ctx.close();
});

test('a draft that cannot be read opens a way out, not an error page', async ({ browser }) => {
  await fsSetRaw('pageLayouts/learn', {
    draft: { stringValue: 'not a page' },
    revision: { integerValue: '3' },
    published: { nullValue: null },
  });
  const ctx = await signedIn(browser, OWNER);
  const page = await ctx.newPage();
  const res = await page.goto('/content/learn-page');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'This draft could not be read.' })).toBeVisible();
  await shot(page, 'unreadable-draft');
  await page.getByRole('button', { name: 'Discard the draft' }).click();
  await page.waitForSelector('.le-root');
  await expect(status(page)).toHaveText(/^Saved/);
  expect(typeof (await learnDoc())?.draft).toBe('object');
  await ctx.close();
});
