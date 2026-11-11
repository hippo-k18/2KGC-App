import { expect, test, type Page } from '@playwright/test';
import { waitSaved } from './helpers';
import { block, caretField, clickWords, draftBlock, editor, pageOf, PREVIEW, resetLearn, row, tableDoc, wordsAt } from './inline-helpers';
import { LEARN, OWNER } from './people';

/**
 * The T344 gate's bubble finding K1, and the same check for every other
 * button in the in-place text bubble (T348). Every step is a real click or key.
 */

const FILLER = Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, kind: 'text', text: `Filler paragraph ${i} with enough words to take some room on the page.` }));

const PAGE = pageOf([
  { id: 'h', kind: 'heading', level: 2, text: 'T348 heading' },
  ...FILLER,
  { id: 'L', kind: 'list', style: 'bullets', items: [{ id: 'l1', text: 'List line one' }, { id: 'l2', text: 'List line two' }] },
  { id: 'T', kind: 'table', striped: false, doc: tableDoc(row('tableHeader', 'Head A', 'Head B'), row('tableCell', 'Cell A', 'Cell B')) },
  {
    id: 'P',
    kind: 'people',
    style: 'cards',
    columns: 2,
    people: [{ id: 'p1', name: 'Ada Person', role: 'First role', bio: 'A short bio with a [link](/team).' }],
  },
]);

test.beforeEach(() => resetLearn(PAGE));

/** Where the people block sits on screen: a scroll of any box around it moves it. */
const scrollTop = async (page: Page) => -((await block(page, 'P').boundingBox())?.y ?? 0);
const selection = (page: Page) => page.evaluate(() => ({ text: window.getSelection()?.toString() ?? '', collapsed: window.getSelection()?.isCollapsed ?? true }));

/** The bubble's button with this name, clicked with the mouse the way a person does. */
async function bubbleButton(page: Page, name: RegExp) {
  const btn = page.locator('.rt-bubble').getByRole('button', { name }).first();
  await expect(btn).toBeVisible();
  const box = (await btn.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('K1: Remove in the link bubble leaves a caret where it was', () => {
  for (const [who, width] of [
    [LEARN, 1280],
    [OWNER, 390],
  ] as const) {
    test(`after typing in a link, Remove keeps the caret and the scroll, and the next words are added (${width})`, async ({ browser }) => {
      const { ctx, page } = await editor(browser, { email: who, width });
      await clickWords(page, 'Ada Person', 'P');
      const at = await wordsAt(page, 'link', 'P');
      await page.mouse.click(at.x, at.y);
      await page.keyboard.type('W1');
      const before = await scrollTop(page);
      await page.waitForTimeout(250);
      await bubbleButton(page, /^Remove$/);
      // The fuzz typed 181 ms later; check at once what the person would type into.
      expect(await selection(page)).toEqual({ text: '', collapsed: true });
      expect(Math.abs((await scrollTop(page)) - before)).toBeLessThan(40);
      expect(await caretField(page)).toMatch(/^P:/);
      await page.keyboard.type('W2');
      await waitSaved(page);
      const bio = JSON.stringify(((await draftBlock('P'))?.people as { bio: unknown }[])[0].bio);
      expect(bio).not.toContain('/team');
      expect(bio).toContain('linW1W2k');
      await ctx.close();
    });
  }
});

test.describe('K1 audit: every bubble button keeps the caret and the scroll', () => {
  for (const name of [/^Bold/, /^Italic/, /^Edit$/]) {
    test(`${name.source} in the bubble over selected words in a bio`, async ({ browser }) => {
      const { ctx, page } = await editor(browser, { email: OWNER, width: 1280 });
      await clickWords(page, 'Ada Person', 'P');
      const at = await wordsAt(page, 'short', 'P');
      await page.mouse.dblclick(at.x, at.y);
      const before = await scrollTop(page);
      if (name.source === '^Edit$') {
        const link = await wordsAt(page, 'link', 'P');
        await page.mouse.click(link.x, link.y);
        await page.waitForTimeout(150);
      }
      const btn = page.locator('.rt-bubble').getByRole('button', { name }).first();
      if (!(await btn.isVisible().catch(() => false))) test.skip(true, `${name.source} is not in this bubble`);
      await bubbleButton(page, name);
      expect(Math.abs((await scrollTop(page)) - before)).toBeLessThan(40);
      if (name.source === '^Edit$') {
        // The address box opens; Escape gives the caret back to the words.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
        expect(await caretField(page)).toMatch(/^P:/);
        expect((await selection(page)).collapsed).toBe(true);
      } else {
        expect(await caretField(page)).toMatch(/^P:/);
        // The words stay selected for the next tool, as in a document editor.
        expect((await selection(page)).text).toBe('short');
      }
      await ctx.close();
    });
  }
});

test.describe('Table bubble: never over the block above, and Escape closes it', () => {
  for (const width of [1280, 390]) {
    test(`with the caret in a table, the list line above takes the click and the words (${width})`, async ({ browser }) => {
      const { ctx, page } = await editor(browser, { email: OWNER, width });
      await clickWords(page, 'Cell A', 'T');
      await expect(page.locator('.rt-bubble').first()).toBeVisible();
      const at = await wordsAt(page, 'List line two', 'L');
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.rt-bubble') !== null, [at.x, at.y]);
      expect(hit).toBe(false);
      await page.mouse.click(at.x + 30, at.y);
      await page.keyboard.press('Meta+ArrowDown');
      await page.keyboard.type(' Lx');
      await waitSaved(page);
      expect(JSON.stringify((await draftBlock('L'))?.items)).toContain('List line two Lx');
      await ctx.close();
    });
  }

  test('Escape in a table cell closes the table bubble and keeps the caret in the cell', async ({ browser }) => {
    const { ctx, page } = await editor(browser, { email: OWNER, width: 1280 });
    await clickWords(page, 'Cell A', 'T');
    await expect(page.locator('.rt-bubble').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.rt-bubble:visible')).toHaveCount(0);
    expect(await caretField(page)).toMatch(/^T:/);
    await page.keyboard.type('Ex');
    await waitSaved(page);
    expect(JSON.stringify((await draftBlock('T'))?.doc)).toContain('Ex');
    await ctx.close();
  });
});

