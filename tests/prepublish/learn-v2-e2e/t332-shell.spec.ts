import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { OWNER } from './people';
import { errorsOf, fsDelete, fsList, fsPatch, fsSet, learnDoc, openEditor, openMoreOptions, shot, signedIn, waitSaved } from './helpers';
import { SETTINGS, moreMenu } from './editor-moves';

/**
 * The T331 shell findings, run the way they were found (T332): leaving
 * through the editor's own links with words still unsaved (E F2), "Load their
 * version" (E F8), Schedule during "Edit saved section" (C N3), the Checker's
 * count for starter text (C N1), the block picker's Enter (D F10) and the
 * Image and text starter title (D F11).
 */

type Json = Record<string, unknown>;
type Section = { blocks: Json[] } & Json;
const FIXTURES = JSON.parse(readFileSync(path.join(__dirname, '.fixtures.json'), 'utf8')) as { library: Record<string, Section> };

async function resetLearn() {
  for (const sub of ['versions', 'library', 'media']) {
    for (const d of await fsList(`pageLayouts/learn/${sub}`)) await fsDelete(`pageLayouts/learn/${sub}/${d.id}`);
  }
  await fsDelete('pageLayouts/learn');
}

test.beforeEach(async () => {
  await resetLearn();
});

async function editor(browser: Browser) {
  const ctx = await signedIn(browser, OWNER);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('kgc-learn-tour-v3', '1');
    } catch {}
  });
  return { ctx, page: await openEditor(ctx) };
}

const section = (id: string, label: string, blocks: Json[]): Section => ({
  id,
  label,
  background: 'plain',
  width: 'normal',
  paddingTop: 'medium',
  paddingBottom: 'medium',
  blocks,
});

async function seed(blocks: Json[] = [{ id: 'top-h', kind: 'heading', text: 'T332 page', level: 2 }], extra: Section[] = []) {
  const draft = { seoTitle: 'T332 page', seoDescription: '', sections: [section('top', 'Top', blocks), ...extra] };
  await fsSet('pageLayouts/learn', { draft, published: draft, revision: 1, draftUpdatedAt: Date.now(), draftUpdatedBy: OWNER });
}

/** Types into the heading's Text field in the panel; the edit lands at once, the autosave 1.5 s later. */
async function typeHeading(page: Page, words: string) {
  await page.locator('.le-pane-preview [data-block-id="top-h"]').first().click({ position: { x: 4, y: 4 } });
  await openMoreOptions(page);
  await page.locator(SETTINGS).getByLabel('Text', { exact: true }).fill(words);
}

const draftText = async () => JSON.stringify((await learnDoc())?.draft ?? null);

/** Someone else saves meanwhile: the next save from this editor is a conflict. */
async function makeConflict(page: Page, words: string) {
  await typeHeading(page, 'T332 first save');
  await waitSaved(page);
  const doc = await learnDoc();
  await fsPatch('pageLayouts/learn', { revision: (doc?.revision as number) + 5 });
  await typeHeading(page, words);
  await expect(page.locator('.whova-banner.danger')).toContainText('Someone else saved this page', { timeout: 20_000 });
}

test('E F2: "< Dashboard" straight after typing saves the words first', async ({ browser }) => {
  await seed();
  const { ctx, page } = await editor(browser);
  await typeHeading(page, 'BACKW pending words');
  await page.locator('.le-back').click();
  await expect(page).not.toHaveURL(/content\/learn-page/, { timeout: 20_000 });
  await expect.poll(draftText, { timeout: 10_000 }).toContain('BACKW pending words');
  await ctx.close();
});

test('E F2: Sign out straight after typing saves the words first', async ({ browser }) => {
  await seed();
  const { ctx, page } = await editor(browser);
  await typeHeading(page, 'SIGNOUTW pending words');
  await page.locator('.acct-editor .acct-button').click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await expect.poll(draftText, { timeout: 10_000 }).toContain('SIGNOUTW pending words');
  await ctx.close();
});

test('E F2: with a conflict showing, leaving asks first, and Stay keeps the words', async ({ browser }) => {
  await seed();
  const { ctx, page } = await editor(browser);
  await makeConflict(page, 'CONFLICTW unsaved words');

  await page.locator('.le-back').click();
  const dialog = page.locator('.le-modal[role=dialog]');
  await expect(dialog).toContainText('Leave without saving?');
  await expect(dialog).toContainText('Your latest changes are not saved.');
  await shot(page, 't332-leave-dialog');
  await dialog.getByRole('button', { name: 'Stay' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/content\/learn-page/);
  await expect(page.locator('.le-pane-preview')).toContainText('CONFLICTW unsaved words');

  // Sign out asks too.
  await page.locator('.acct-editor .acct-button').click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(dialog).toContainText('Leave without saving?');
  await dialog.getByRole('button', { name: 'Stay' }).click();
  await expect(page).toHaveURL(/content\/learn-page/);

  await page.locator('.le-back').click();
  await dialog.getByRole('button', { name: 'Leave anyway' }).click();
  await expect(page).not.toHaveURL(/content\/learn-page/, { timeout: 20_000 });
  expect(await draftText()).not.toContain('CONFLICTW');
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});

test('E F8: "Load their version" asks before throwing away unsaved words; "Keep mine" says what it replaces', async ({ browser }) => {
  await seed();
  const { ctx, page } = await editor(browser);
  await makeConflict(page, 'THEIRSW unsaved words');
  const banner = page.locator('.whova-banner.danger');
  await expect(banner.getByRole('button', { name: 'Keep mine and replace their saved changes' })).toBeVisible();

  await banner.getByRole('button', { name: 'Load their version' }).click();
  await expect(banner).toContainText('This throws away your changes that are not saved yet.');
  await shot(page, 't332-load-theirs-confirm');
  await banner.getByRole('button', { name: 'Cancel' }).click();
  await expect(banner).not.toContainText('This throws away');
  await expect(page.locator('.le-pane-preview')).toContainText('THEIRSW unsaved words');

  await banner.getByRole('button', { name: 'Load their version' }).click();
  await banner.getByRole('button', { name: 'Throw away my changes' }).click();
  await expect(page.locator('.whova-banner.danger')).toHaveCount(0);
  await expect(page.locator('.le-pane-preview')).not.toContainText('THEIRSW');
  await expect(page.locator('.le-pane-preview')).toContainText('T332 first save');
  await ctx.close();
});

test('C N3: Schedule waits during "Edit saved section", like Publish', async ({ browser }) => {
  await fsSet('pageLayouts/learn/library/lib-cta', { name: 'Call to action', section: FIXTURES.library['lib-cta'], createdAt: Date.now(), createdBy: OWNER });
  await seed(undefined, [section('mid', 'Middle', [{ id: 'mid-r', kind: 'reusable', libraryId: 'lib-cta' }])]);
  const { ctx, page } = await editor(browser);
  const bar = page.locator('.le-bar');
  await expect(bar.getByRole('button', { name: 'Schedule', exact: true })).toBeEnabled();

  await page.locator('.le-pane-preview [data-lp-block="mid-r"]').first().click({ position: { x: 4, y: 4 } });
  await page.locator(SETTINGS).getByRole('button', { name: 'Edit saved section' }).click();
  await expect(page.locator('.le-saved-edit')).toBeVisible();

  const reason = 'Save the saved section to the library, or cancel, first.';
  const publishBtn = bar.getByRole('button', { name: 'Publish', exact: true });
  const scheduleBtn = bar.getByRole('button', { name: 'Schedule', exact: true });
  await expect(publishBtn).toBeDisabled();
  await expect(scheduleBtn).toBeDisabled();
  await expect(scheduleBtn).toHaveAttribute('title', reason);
  await bar.getByRole('button', { name: 'More', exact: true }).click();
  const item = page.getByRole('menuitem', { name: 'Schedule' });
  await expect(item).toBeDisabled();
  await expect(item).toHaveAttribute('title', reason);
  await shot(page, 't332-schedule-disabled');
  await page.keyboard.press('Escape');

  await page.locator('.le-saved-edit').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.le-saved-edit')).toHaveCount(0);
  await expect(scheduleBtn).toBeEnabled();
  await ctx.close();
});

test('C N1: starter text counts as worth a look in the Checker, not as a thing to fix', async ({ browser }) => {
  await seed([
    { id: 'top-h', kind: 'heading', text: 'T332 page', level: 2 },
    { id: 'top-t', kind: 'text', text: 'Write something here.' },
  ]);
  const { ctx, page } = await editor(browser);
  await moreMenu(page, 'Check the page');
  const checker = page.locator(SETTINGS);
  await expect(checker).toContainText('Starter text left in');
  await expect(checker.locator('.le-tools-summary')).toHaveText('1 worth a look');
  await expect(checker).not.toContainText('thing to fix');
  const badge = checker.getByRole('tab', { name: /Accessibility/ }).locator('.le-tools-tab-n');
  await expect(badge).toHaveClass(/is-look/);
  await expect(badge).toContainText('worth a look');
  await shot(page, 't332-checker-starter');
  await ctx.close();
});

test('D F10 and F11: the picker adds the block named exactly, and Image and text has no "##"', async ({ browser }) => {
  await seed();
  const { ctx, page } = await editor(browser);
  const addByEnter = async (query: string) => {
    const outline = page.locator('.le-pane-outline');
    const item = outline.locator('li', { has: page.locator('[role=treeitem][aria-label^="Section: Top"]') }).first();
    await item.getByRole('button', { name: 'Add a block' }).last().click();
    await page.locator('.le-pick input[type=search]').fill(query);
    await page.keyboard.press('Enter');
    await expect(page.locator('.le-pick')).toHaveCount(0);
    await waitSaved(page);
  };
  await addByEnter('Text');
  await addByEnter('Columns');
  await addByEnter('Image and text');
  const kinds = (((await learnDoc())?.draft as { sections: Section[] }).sections[0].blocks as { kind: string }[]).map((b) => b.kind);
  expect(kinds).toEqual(['heading', 'text', 'columns', 'imageText']);

  const it = page.locator('.le-pane-preview [data-block-id]').last();
  await expect(it).toContainText('A short title');
  await expect(it).not.toContainText('##');
  await expect(it.locator('h2, h3', { hasText: 'A short title' })).toHaveCount(1);
  await shot(page, 't332-imagetext-starter');
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});
