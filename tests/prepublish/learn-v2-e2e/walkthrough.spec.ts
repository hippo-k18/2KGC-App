import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { errorsOf, fsDelete, fsGet, learnDoc, openEditor, signedIn, storageClear, waitForWeb, WEB } from './helpers';
import { publish } from './editor-moves';
import { LEARN, OWNER } from './people';

/**
 * The owner's walkthrough (T329): a course lead who has never seen the editor
 * changes the page by clicking on it. Every step here happens on the page
 * itself; the right-hand panel is never touched, and the test fails if
 * anything in it was clicked. Run as the owner and as a learn-only member, at
 * a desktop width and a phone width, each ending with the change live on www.
 *
 * T329_SHOTS=<folder> keeps a picture of every step.
 */

const SHOTS = process.env.T329_SHOTS;
const PHOTO = path.resolve(__dirname, '../../../apps/web/public/kgc/tickets-hero.jpeg');
const PREVIEW = '.le-pane-preview .le-frame';

async function editorAs(browser: Browser, email: string, width: number) {
  const ctx = await signedIn(browser, email, { width, height: width < 600 ? 844 : 900 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('kgc-learn-tour-v3', '1');
    } catch {}
  });
  const page = await openEditor(ctx);
  // Counts every click that lands in the settings panel, which this walkthrough must never need.
  await page.evaluate(() => {
    (window as unknown as { panelClicks: number }).panelClicks = 0;
    document.addEventListener(
      'pointerdown',
      (e) => {
        if ((e.target as HTMLElement).closest?.('.le-pane-settings')) (window as unknown as { panelClicks: number }).panelClicks++;
      },
      true,
    );
  });
  return { ctx, page };
}

function stepper(page: Page, tag: string) {
  let n = 0;
  return async (name: string) => {
    n++;
    // The thing being changed in the middle of the picture.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('.le-frame') && document.activeElement?.scrollIntoView({ block: 'center' }));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tag}-${String(n).padStart(2, '0')}-${name}.png` });
  };
}

/** Clicks once on words in the preview: that one click selects the block and puts the caret there. */
async function clickWords(page: Page, text: string, scope = PREVIEW) {
  const words = page.locator(scope).getByText(text, { exact: false }).first();
  await words.scrollIntoViewIfNeeded();
  await words.click();
  await page.waitForTimeout(400);
}

const draftText = async () => JSON.stringify((await learnDoc())?.draft ?? {});

for (const [who, email] of [
  ['owner', OWNER],
  ['learn-member', LEARN],
] as const) {
  for (const width of [1280, 390]) {
    test(`walkthrough: ${who} at ${width}px changes the page without the side panel`, async ({ browser }) => {
      await fsDelete('pageLayouts/learn');
      for (const m of await (await import('./helpers')).fsList('pageLayouts/learn/media')) await fsDelete(`pageLayouts/learn/media/${m.id}`);
      await storageClear();
      const tag = `${who}-${width}`;
      const mark = `${who === 'owner' ? 'Owner' : 'Member'} ${width}`;
      const { ctx, page } = await editorAs(browser, email, width);
      const step = stepper(page, tag);
      if (width < 600) await page.getByRole('tab', { name: 'Preview' }).click();
      await step('open');

      // 1. Change a list item: click its words and type.
      await clickWords(page, 'fully online for individuals');
      await expect(page.locator(`${PREVIEW} [data-block-id="programmes-list"] .ProseMirror-focused`)).toHaveCount(1);
      await page.keyboard.press('Meta+ArrowDown');
      await page.keyboard.type(` (${mark} edit)`);
      await step('list-item-changed');

      // 2. Enter adds an item; Backspace in an empty item removes it.
      await page.keyboard.press('Enter');
      await page.keyboard.type(`New item, ${mark}`);
      await step('list-item-added');
      await page.keyboard.press('Enter');
      const items = page.locator(`${PREVIEW} [data-block-id="programmes-list"] .lp-list > li`);
      await expect(items).toHaveCount(6);
      await step('list-empty-item');
      await page.keyboard.press('Backspace');
      await expect(items).toHaveCount(5);
      await step('list-item-removed');
      await expect.poll(draftText, { timeout: 30_000 }).toContain(`New item, ${mark}`);

      // 3. A person's name, typed over, and their photo, replaced from the media library.
      await clickWords(page, 'Thomas Deely');
      await page.keyboard.press('Meta+a');
      await page.keyboard.type('Tom Deely');
      await step('person-name');
      const card = page.locator(`${PREVIEW} [data-block-id="team-founders"] .lp-person`).nth(1);
      await card.locator('.lp-img-hit').click();
      await card.getByRole('button', { name: 'Replace' }).click();
      const lib = page.locator('[role=dialog]').filter({ hasText: 'Use this image' });
      await lib.locator('input[type=file]').setInputFiles(PHOTO);
      await expect.poll(async () => (await (await import('./helpers')).fsList('pageLayouts/learn/media')).length, { timeout: 30_000 }).toBe(1);
      await lib.locator('[aria-label^="Images"] button, [aria-label^="Images"] [role=option]').first().click();
      await step('photo-library');
      await lib.getByRole('button', { name: 'Use this image' }).click();
      await expect(card.locator('img')).toHaveAttribute('src', /pageLayouts%2Flearn|pageLayouts\/learn/);
      await step('person-photo');

      // 4. A + on the page adds a Buttons block; its words and address are typed in place.
      const end = page.locator(`${PREVIEW} [data-lp-section="programmes"] .lp-gap.is-last .lp-gap-btn`).last();
      await end.scrollIntoViewIfNeeded();
      await end.click();
      await step('plus-picker');
      await page.getByRole('dialog', { name: 'Add a block' }).getByRole('searchbox').fill('Buttons');
      await page.keyboard.press('Enter');
      const btn = page.locator(`${PREVIEW} .lp-block-buttons .lp-link-edit .lp-plain`).last();
      await btn.click();
      await page.keyboard.press('Meta+a');
      await page.keyboard.type(`Brochure ${mark}`);
      const addr = page.locator(`${PREVIEW} .lp-link-pop input`).first();
      await addr.fill('example.org/brochure');
      await addr.press('Enter');
      await expect(page.locator(`${PREVIEW} .lp-link-pop`)).toContainText('opens in a new tab');
      await step('button-label-and-link');
      await page.keyboard.press('Escape');
      await expect(page.locator(`${PREVIEW} .lp-link-pop`)).toHaveCount(0);

      // 5. A table from another +, a cell typed in place, a row added with the hover +.
      const end2 = page.locator(`${PREVIEW} [data-lp-section="programmes"] .lp-gap.is-last .lp-gap-btn`).last();
      await end2.scrollIntoViewIfNeeded();
      await end2.click();
      await page.getByRole('dialog', { name: 'Add a block' }).getByRole('searchbox').fill('Table');
      await page.keyboard.press('Enter');
      const table = page.locator(`${PREVIEW} .lp-table-edit`).last();
      await table.locator('td').first().click();
      await page.keyboard.press('Meta+a');
      await page.keyboard.type(`Cell ${mark}`);
      await table.locator('.lp-table-wrap').hover();
      await table.getByRole('button', { name: 'Add a row' }).click();
      await expect(table.locator('tr')).toHaveCount(3);
      await step('table-cell-and-row');

      await expect.poll(draftText, { timeout: 30_000 }).toContain(`Cell ${mark}`);
      const draft = await draftText();
      for (const s of [`(${mark} edit)`, 'Tom Deely', `Brochure ${mark}`, 'https://example.org/brochure', `New item, ${mark}`]) expect(draft, s).toContain(s);

      // 6. Publish, and www shows it.
      await publish(page, `Walkthrough ${mark}`);
      await step('published');
      expect(await page.evaluate(() => (window as unknown as { panelClicks: number }).panelClicks), 'clicks in the side panel').toBe(0);
      await waitForWeb((html) => [`(${mark} edit)`, 'Tom Deely', `Brochure ${mark}`, `Cell ${mark}`, `New item, ${mark}`].every((s) => html.includes(s)));
      const live = await fsGet('pageLayouts/learn');
      expect(JSON.stringify(live?.published)).toContain('example.org/brochure');
      if (SHOTS) {
        const web = await ctx.newPage();
        await web.goto(`${WEB}/learn`);
        await web.waitForTimeout(1200);
        await web.screenshot({ path: `${SHOTS}/${tag}-99-on-www.png`, fullPage: true });
        await web.close();
      }
      expect(errorsOf(page), errorsOf(page).join('\n')).toEqual([]);
      await ctx.close();
    });
  }
}
