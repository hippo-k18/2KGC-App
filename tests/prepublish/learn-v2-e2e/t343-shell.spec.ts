import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { LEARN, OWNER } from './people';
import { errorsOf, fsDelete, fsList, fsSet, learnDoc, openEditor, openMoreOptions, shot, signedIn, waitSaved } from './helpers';
import { SETTINGS } from './editor-moves';

/**
 * T342 N5 and N-G, run the way they were found (T343): the owner reaches the
 * editor in-app (Content, then Learn Page in the sidebar), a second editor
 * saves, the owner types, and browser Back must not lose the words. Also a
 * plain pending save on Back still saves, and "Load their version" puts focus
 * on Cancel.
 */

type Json = Record<string, unknown>;

async function resetLearn() {
  for (const sub of ['versions', 'library', 'media']) {
    for (const d of await fsList(`pageLayouts/learn/${sub}`)) await fsDelete(`pageLayouts/learn/${sub}/${d.id}`);
  }
  await fsDelete('pageLayouts/learn');
}

test.use({ actionTimeout: 20_000 });

test.beforeEach(async () => {
  await resetLearn();
});

async function context(browser: Browser, email: string) {
  const ctx = await signedIn(browser, email);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('kgc-learn-tour-v3', '1');
    } catch {}
  });
  return ctx;
}

/** Content first, then Learn Page in the sidebar: a client-side route change, so Back stays in the app. */
async function openInApp(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto('/content');
  await page.waitForLoadState('networkidle');
  await page.getByRole('link', { name: 'Learn Page', exact: true }).first().click();
  await page.waitForURL(/content\/learn-page/);
  await page.waitForSelector('.le-root');
  await page.waitForTimeout(800);
  return page;
}

/** Opens the editor again the same way, from wherever Back left the page. */
async function reopenInApp(page: Page) {
  await expect(page).not.toHaveURL(/content\/learn-page/, { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  await page.getByRole('link', { name: 'Learn Page', exact: true }).first().click();
  await page.waitForURL(/content\/learn-page/);
  await page.waitForSelector('.le-root');
}

async function seed() {
  const draft = {
    seoTitle: 'T343 page',
    seoDescription: '',
    sections: [
      {
        id: 'top',
        label: 'Top',
        background: 'plain',
        width: 'normal',
        paddingTop: 'medium',
        paddingBottom: 'medium',
        blocks: [{ id: 'top-h', kind: 'heading', text: 'T343 page', level: 2 }] as Json[],
      },
    ],
  };
  await fsSet('pageLayouts/learn', { draft, published: draft, revision: 1, draftUpdatedAt: Date.now(), draftUpdatedBy: OWNER });
}

async function typeHeading(page: Page, words: string) {
  await page.locator('.le-pane-preview [data-block-id="top-h"]').first().click({ position: { x: 4, y: 4 } });
  await openMoreOptions(page);
  await page.locator(SETTINGS).getByLabel('Text', { exact: true }).fill(words);
}

const draftText = async () => JSON.stringify((await learnDoc())?.draft ?? null);

/** A second editor, in its own browser, saves a change to the page. */
async function otherEditorSaves(browser: Browser, words: string) {
  const ctx = await context(browser, LEARN);
  const page = await openEditor(ctx);
  await typeHeading(page, words);
  await waitSaved(page);
  await expect.poll(draftText, { timeout: 10_000 }).toContain(words);
  await ctx.close();
}

const conflictBanner = (page: Page) => page.locator('.whova-banner.danger', { hasText: 'Someone else saved this page' });
const recoveryBanner = (page: Page) => page.locator('.le-recovery');

test('N5: conflict, then browser Back asks first; after leaving anyway the words are offered back and can be kept', async ({ browser }) => {
  await seed();
  const ctx = await context(browser, OWNER);
  const page = await openInApp(ctx);
  await otherEditorSaves(browser, 'T343 member saved');
  await typeHeading(page, 'BACKCONF owner words');
  await expect(conflictBanner(page)).toBeVisible({ timeout: 20_000 });

  await page.goBack();
  const dialog = page.locator('.le-modal[role=dialog]');
  await expect(dialog).toContainText('Leave without saving?');
  await expect(page).toHaveURL(/content\/learn-page/);
  await shot(page, 't343-back-leave-dialog');
  await dialog.getByRole('button', { name: 'Stay' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.le-pane-preview')).toContainText('BACKCONF owner words');

  // Back asks again after Stay.
  await page.goBack();
  await expect(dialog).toContainText('Leave without saving?');
  await expect(dialog).toContainText('this browser keeps a copy');
  await dialog.getByRole('button', { name: 'Leave anyway' }).click();
  await expect(page).not.toHaveURL(/content\/learn-page/, { timeout: 20_000 });
  expect(await draftText()).not.toContain('BACKCONF');

  await reopenInApp(page);
  await expect(recoveryBanner(page)).toContainText('You have changes from');
  await expect(recoveryBanner(page)).toContainText('that were not saved');
  await shot(page, 't343-recovery-offer');
  await recoveryBanner(page).getByRole('button', { name: 'Restore them' }).click();
  await expect(recoveryBanner(page)).toHaveCount(0);
  await expect(page.locator('.le-pane-preview')).toContainText('BACKCONF owner words');
  // Someone saved after these words were typed, so the usual conflict flow asks.
  await expect(conflictBanner(page)).toBeVisible({ timeout: 20_000 });
  await conflictBanner(page).getByRole('button', { name: 'Keep mine and replace their saved changes' }).click();
  await waitSaved(page);
  await expect.poll(draftText, { timeout: 10_000 }).toContain('BACKCONF owner words');

  // Saved now, so nothing is offered again.
  await page.reload();
  await page.waitForSelector('.le-root');
  await page.waitForTimeout(800);
  await expect(recoveryBanner(page)).toHaveCount(0);
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});

test('N5: Back straight after typing, before the conflict shows, keeps the words for the next open', async ({ browser }) => {
  await seed();
  const ctx = await context(browser, OWNER);
  const page = await openInApp(ctx);
  await otherEditorSaves(browser, 'T343 member saved');
  await typeHeading(page, 'FASTBACK owner words');
  await page.goBack();
  await expect(page).not.toHaveURL(/content\/learn-page/, { timeout: 20_000 });
  await page.waitForTimeout(2000);
  expect(await draftText()).not.toContain('FASTBACK');

  await reopenInApp(page);
  await expect(recoveryBanner(page)).toContainText('You have changes from');
  await recoveryBanner(page).getByRole('button', { name: 'Restore them' }).click();
  await expect(page.locator('.le-pane-preview')).toContainText('FASTBACK owner words');
  await expect(conflictBanner(page)).toBeVisible({ timeout: 20_000 });
  await conflictBanner(page).getByRole('button', { name: 'Keep mine and replace their saved changes' }).click();
  await waitSaved(page);
  await expect.poll(draftText, { timeout: 10_000 }).toContain('FASTBACK owner words');
  await ctx.close();
});

test('N5: "Throw them away" removes the copy for good', async ({ browser }) => {
  await seed();
  const ctx = await context(browser, OWNER);
  const page = await openInApp(ctx);
  await otherEditorSaves(browser, 'T343 member saved');
  await typeHeading(page, 'THROWAWAY owner words');
  await page.goBack();
  await reopenInApp(page);
  await recoveryBanner(page).getByRole('button', { name: 'Throw them away' }).click();
  await expect(recoveryBanner(page)).toHaveCount(0);
  await expect(page.locator('.le-pane-preview')).not.toContainText('THROWAWAY');
  await expect(page.locator('.le-pane-preview')).toContainText('T343 member saved');
  await page.reload();
  await page.waitForSelector('.le-root');
  await page.waitForTimeout(800);
  await expect(recoveryBanner(page)).toHaveCount(0);
  await ctx.close();
});

test('N5: a plain pending save still goes on browser Back, and nothing is offered after', async ({ browser }) => {
  await seed();
  const ctx = await context(browser, OWNER);
  const page = await openInApp(ctx);
  await typeHeading(page, 'PLAINBACK pending words');
  await page.goBack();
  await expect(page).not.toHaveURL(/content\/learn-page/, { timeout: 20_000 });
  await expect.poll(draftText, { timeout: 10_000 }).toContain('PLAINBACK pending words');
  await reopenInApp(page);
  await page.waitForTimeout(800);
  await expect(page.locator('.le-pane-preview')).toContainText('PLAINBACK pending words');
  await expect(recoveryBanner(page)).toHaveCount(0);
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});

test('N-G: "Load their version" puts focus on Cancel, so Enter keeps the words', async ({ browser }) => {
  await seed();
  const ctx = await context(browser, OWNER);
  const page = await openInApp(ctx);
  await otherEditorSaves(browser, 'T343 member saved');
  await typeHeading(page, 'FOCUSW owner words');
  const banner = conflictBanner(page);
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await banner.getByRole('button', { name: 'Load their version' }).click();
  await expect(banner).toContainText('This throws away your changes that are not saved yet.');
  await expect(banner.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(banner).not.toContainText('This throws away');
  await expect(banner.getByRole('button', { name: 'Load their version' })).toBeFocused();
  await expect(page.locator('.le-pane-preview')).toContainText('FOCUSW owner words');
  await ctx.close();
});
