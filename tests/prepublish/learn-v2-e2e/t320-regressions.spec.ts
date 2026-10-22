import { expect, test, type Page } from '@playwright/test';
import { LEARN, OWNER } from './people';
import { fsDelete, fsGet, fsList, openEditor, shot as shotRaw, signedIn, storageClear, waitSaved, type Json } from './helpers';
import { addBlock as addBlockIn } from './editor-moves';

/**
 * T320's fixes for the T314 gate, re-run against the merged v2 editor (T323):
 * an empty Image or Video block saves and blocks publish (F1), Undo after
 * "Load their version" (F4), sign out for a learn-only member, the phone
 * preview's scale (F3), and the screen for a draft that cannot be read.
 * Ported from `learn-editor-e2e/learn-editor.spec.ts` to the v2 shell.
 */

const MEMBERS = [OWNER, LEARN, LEARN];
const learnDoc = () => fsGet('pageLayouts/learn');
const draftText = async () => JSON.stringify((await learnDoc())?.draft ?? null);
const shot = (page: Page, name: string) => shotRaw(page, `t320-${name}`);
async function fsSetRaw(path: string, fields: Record<string, Json>) {
  const r = await fetch(`${process.env.FIRESTORE_REST ?? 'http://127.0.0.1:8323'}/v1/projects/${process.env.GCLOUD_PROJECT ?? 'demo-learn-v2-e2e'}/databases/(default)/documents/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`fsSetRaw ${path}: ${r.status}`);
}

/** The v2 shell's save chip reads "Saved", "Unsaved", "Saving" or "Not saved". */
const status = (page: Page) => page.locator('.le-chips .le-chip').first();

async function typeInto(page: Page, needle: string, text: string) {
  await page.locator('.le-pane-preview [data-lp-block]', { hasText: needle }).first().click();
  await page.locator('.le-pane-preview .lp-editing .ProseMirror').waitFor();
  await page.waitForTimeout(250);
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

async function waitForDraft(pred: (draft: string) => boolean, timeout = 15_000) {
  await expect.poll(async () => pred(await draftText()), { timeout }).toBe(true);
}

const SECTION = 'Continuing education';
const T1 = 'Learn how knowledge';
const T2 = 'KGC|Learn was established';

const addBlock = (page: Page, kind: string) => addBlockIn(page, SECTION, kind);

async function lastBlock(): Promise<Json | undefined> {
  const draft = (await learnDoc())?.draft as { sections: { label: string; blocks: Json[] }[] } | undefined;
  return draft?.sections.find((s) => s.label === SECTION)?.blocks.at(-1);
}

test.beforeEach(async ({ context }) => {
  for (const sub of ['versions', 'library', 'media']) for (const d of await fsList(`pageLayouts/learn/${sub}`)) await fsDelete(`pageLayouts/learn/${sub}/${d.id}`);
  await fsDelete('pageLayouts/learn');
  await storageClear();
  await context.addInitScript(() => {
    // Embedded iframes have an opaque origin, where localStorage throws.
    try {
      localStorage.setItem('kgc-learn-tour-v2', '1');
    } catch {}
  });
});

async function signedInNoTour(browser: import('@playwright/test').Browser, email: string, viewport?: { width: number; height: number }) {
  const ctx = await signedIn(browser, email, viewport);
  await ctx.addInitScript(() => {
    // Embedded iframes have an opaque origin, where localStorage throws.
    try {
      localStorage.setItem('kgc-learn-tour-v2', '1');
    } catch {}
  });
  return ctx;
}

test('F1: an empty Image or Video block is saved, and publish names it', async ({ browser }) => {
  const ctx = await signedInNoTour(browser, OWNER);
  const page = await openEditor(ctx);

  await addBlock(page, 'Image');
  await expect.poll(async () => (await lastBlock())?.kind, { timeout: 15_000 }).toBe('image');
  await expect(status(page)).toHaveText(/Saved/);
  expect(((await lastBlock())?.image as Json).src).toBe('');
  await expect(page.locator('.le-pane-preview').getByText('Choose an image')).toBeVisible();
  await shot(page, 'f1-empty-image');

  // Every other edit keeps saving.
  await typeInto(page, T1, ' F1X');
  await waitForDraft((d) => d.includes('F1X'));
  await expect(status(page)).toHaveText(/Saved/);

  await addBlock(page, 'Video');
  await expect.poll(async () => (await lastBlock())?.kind, { timeout: 15_000 }).toBe('video');
  await expect(status(page)).toHaveText(/Saved/);
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
  const ctxA = await signedInNoTour(browser, a);
  const ctxB = await signedInNoTour(browser, b);
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
    const email = LEARN;
    const viewport = { width, height: width === 390 ? 844 : 860 };
    const ctx = await signedInNoTour(browser, email, viewport);
    const page = await openEditor(ctx);
    const other = await signedInNoTour(browser, email, viewport);
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
  const ctx = await signedInNoTour(browser, OWNER, { width: 390, height: 844 });
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
  const ctx = await signedInNoTour(browser, OWNER);
  const page = await ctx.newPage();
  const res = await page.goto('/content/learn-page');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'This draft could not be read.' })).toBeVisible();
  await shot(page, 'unreadable-draft');
  await page.getByRole('button', { name: 'Discard the draft' }).click();
  await page.waitForSelector('.le-root');
  await expect(status(page)).toHaveText(/Saved/);
  expect(typeof (await learnDoc())?.draft).toBe('object');
  await ctx.close();
});
