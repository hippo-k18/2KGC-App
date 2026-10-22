import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { OWNER } from './people';
import { WEB, errorsOf, fsDelete, fsGet, fsList, fsPatch, fsSet, learnDoc, openEditor, shot, signedIn, waitForWeb, waitSaved } from './helpers';
import { SETTINGS, addBlock, moreMenu } from './editor-moves';

/**
 * The T326 should-fixes, run the way they were found (T328): a reload or a
 * publish in the middle of "Edit saved section", an Image and text block with
 * no picture, starter text, an empty Embed title, a dead preview link and the
 * tour's "Add a section" step at 1280.
 */

const DASH = process.env.E2E_URL ?? 'http://localhost:3323';
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

async function editor(browser: Browser, opts: { tour?: boolean } = {}) {
  const ctx = await signedIn(browser, OWNER);
  if (!opts.tour) {
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('kgc-learn-tour-v2', '1');
      } catch {}
    });
  }
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

/** A page with a heading and a section that links the sample saved section among other blocks. */
async function seedLinkedPage() {
  await fsSet('pageLayouts/learn/library/lib-cta', { name: 'Call to action', section: FIXTURES.library['lib-cta'], createdAt: Date.now(), createdBy: OWNER });
  const draft = {
    seoTitle: 'T328 page',
    seoDescription: '',
    sections: [
      section('top', 'Top', [{ id: 'top-h', kind: 'heading', text: 'T328 linked page', level: 2 }]),
      section('mid', 'Middle', [
        { id: 'mid-t', kind: 'text', text: 'Before the link.' },
        { id: 'mid-r', kind: 'reusable', libraryId: 'lib-cta' },
      ]),
    ],
  };
  await fsSet('pageLayouts/learn', { draft, published: draft, revision: 1, draftUpdatedAt: Date.now(), draftUpdatedBy: OWNER });
}

/** Starts "Edit saved section" from the linked block and types `word` into the copy's heading. */
async function startEditAndType(page: Page, word: string) {
  await page.locator('.le-pane-preview [data-lp-block="mid-r"]').first().click({ position: { x: 4, y: 4 } });
  await page.locator(SETTINGS).getByRole('button', { name: 'Edit saved section' }).click();
  await expect(page.locator('.le-saved-edit')).toBeVisible();
  await page.locator('.le-pane-preview [data-block-id]:not([data-lp-saved])', { hasText: 'From the library' }).last().click({ position: { x: 4, y: 4 } });
  await page.locator(SETTINGS).getByLabel('Text', { exact: true }).fill(`${word} ready to start?`);
  await waitSaved(page);
}

test('R1: a reload mid "Edit saved section" keeps the edit, and Save puts the text in the library', async ({ browser }) => {
  await seedLinkedPage();
  const { ctx, page } = await editor(browser);
  await startEditAndType(page, 'RELOADW');
  await page.reload();
  await expect(page.locator('.le-saved-edit')).toBeVisible();
  await shot(page, 't328-r1-after-reload');
  await page.locator('.le-saved-edit').getByRole('button', { name: 'Save to library' }).click();
  await expect(page.locator('.le-saved-edit')).toHaveCount(0);
  await waitSaved(page);
  expect(JSON.stringify((await fsGet('pageLayouts/learn/library/lib-cta'))?.section)).toContain('RELOADW');
  const draft = JSON.stringify((await learnDoc())?.draft);
  expect(draft).toContain('"libraryId":"lib-cta"');
  expect(draft).not.toContain('libraryEdit');
  expect(draft).not.toContain('RELOADW');
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});

test('R1: Cancel after a reload puts the link back and changes nothing', async ({ browser }) => {
  await seedLinkedPage();
  const before = (await learnDoc())?.draft;
  const { ctx, page } = await editor(browser);
  await startEditAndType(page, 'CANCELW');
  await page.reload();
  await page.locator('.le-saved-edit').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.le-saved-edit')).toHaveCount(0);
  await waitSaved(page);
  expect((await learnDoc())?.draft).toEqual(before);
  expect(JSON.stringify(await fsGet('pageLayouts/learn/library/lib-cta'))).not.toContain('CANCELW');
  await ctx.close();
});

test('R1: a scheduled publish and the preview link during an edit show the saved section, once', async ({ browser }) => {
  await seedLinkedPage();
  const { ctx, page } = await editor(browser);
  await startEditAndType(page, 'UNSAVEDW');
  const token = randomBytes(32).toString('base64url');
  const doc = await learnDoc();
  await fsPatch('pageLayouts/learn', { scheduledPublishAt: Date.now() - 1000, scheduledRevision: doc?.revision as number, previewToken: token });
  const cron = await fetch(`${DASH}/api/cron/learn-page`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? 'learn-v2-e2e-cron-secret'}` },
  });
  expect(cron.status).toBe(200);
  const after = await learnDoc();
  expect(after?.scheduledPublishAt).toBeUndefined();
  const live = JSON.stringify(after?.published);
  expect(live).not.toContain('UNSAVEDW');
  expect(live).not.toContain('libraryEdit');
  expect(live.split('From the library').length - 1).toBe(1);
  // The stored draft still holds the edit.
  expect(JSON.stringify(after?.draft)).toContain('UNSAVEDW');

  const preview = await (await fetch(`${WEB}/learn/preview/${token}`)).text();
  expect(preview).not.toContain('UNSAVEDW');
  // Counted as drawn text (`>text<`): the page's own data payload repeats every string.
  expect(preview.split('>From the library: ready to start?<').length - 1).toBe(1);

  await page.reload();
  await expect(page.locator('.le-saved-edit')).toBeVisible();
  await ctx.close();
});

test('N3: an Image and text block with no picture shows its text and button on www', async () => {
  const page = {
    seoTitle: 'T328 no picture',
    seoDescription: '',
    sections: [
      section('np', 'No picture', [
        {
          id: 'np-it',
          kind: 'imageText',
          image: { src: '', alt: '' },
          imageSide: 'left',
          text: 'NOPIC text beside no picture.',
          buttons: [{ label: 'NOPIC button', href: '/tickets', style: 'primary' }],
        },
      ]),
    ],
  };
  await fsSet('pageLayouts/learn', { draft: page, published: page, revision: 1 });
  await waitForWeb((h) => h.includes('T328 no picture'));
  const html = await (await fetch(`${WEB}/learn`)).text();
  expect(html).toContain('NOPIC text beside no picture.');
  expect(html).toContain('NOPIC button');
});

test('N3: starter text is a warning in Publish and the Checker; an empty Embed title is not a problem', async ({ browser }) => {
  await seedLinkedPage();
  const { ctx, page } = await editor(browser);
  await addBlock(page, 'Middle', 'Heading');
  await waitSaved(page);
  await addBlock(page, 'Middle', 'Embed');
  await waitSaved(page);
  await page.locator(`${SETTINGS} input[type=url]`).first().fill('https://www.google.com/maps/place/Bryant+Park/@40.7536,-73.9832,17z');
  await page.locator(SETTINGS).getByLabel('Title for screen readers').fill('');
  await waitSaved(page);

  await page.locator('.le-bar').getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.locator('.le-modal[role=dialog]');
  await expect(dialog).toContainText('The Heading block in "Middle" still has starter text: "New heading"');
  await expect(dialog).not.toContainText(/embed has no title/i);
  await expect(dialog.getByRole('button', { name: 'Publish now' })).toBeEnabled();
  await shot(page, 't328-starter-text-publish');
  await page.keyboard.press('Escape');

  await moreMenu(page, 'Check the page');
  const checker = page.locator(SETTINGS);
  await expect(checker).toContainText('Starter text left in');
  await expect(checker).not.toContainText(/embed has no title/i);
  await shot(page, 't328-starter-text-checker');
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});

test('F13: a preview link that no longer works says so', async () => {
  await seedLinkedPage();
  const r = await fetch(`${WEB}/learn/preview/${randomBytes(32).toString('base64url')}`);
  expect(r.status).toBe(200);
  expect(await r.text()).toContain('This preview link no longer works');
});

test('D5b: tour step 4 at 1280 points at "Add a section", not the bar over it', async ({ browser }) => {
  await seedLinkedPage();
  const { ctx, page } = await editor(browser, { tour: true });
  const card = page.locator('.le-x-tour');
  await expect(card).toBeVisible();
  for (let i = 0; i < 3; i++) await card.getByRole('button', { name: 'Next' }).click();
  await expect(card).toContainText('Add something new');
  await page.waitForTimeout(600);
  const topAtButton = await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('[data-tour="add"]')!;
    const r = b.getBoundingClientRect();
    const hit = document
      .elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      .find((el) => !el.closest('.le-x-tour, .le-x-tour-shade, .le-x-tour-ring'));
    return hit ? b.contains(hit) || hit === b : false;
  });
  await shot(page, 't328-tour-step4-1280');
  expect(topAtButton).toBe(true);
  await ctx.close();
});
