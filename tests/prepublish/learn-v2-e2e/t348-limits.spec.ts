import { expect, test, type Page } from '@playwright/test';
import { SETTINGS, moreMenu } from './editor-moves';
import { errorsOf, SHOTS, waitSaved } from './helpers';
import { block, clickWords, doc, draftBlock, editor, field, pageOf, PREVIEW, resetLearn } from './inline-helpers';

/**
 * The T344 gate's limit findings, run the way they were found (T348): a rich
 * field over its limit says so as a plain field does (B2-rich), a paste over a
 * selection in a field already over keeps what fits (D-S1, D-N4), a commit of
 * several characters keeps what fits (D-N3), a cut paste says so (D-N5,
 * E N-C2), and a list item with no words but with sub-items is named at
 * Publish and in the Checker instead of vanishing from www (H N2).
 */

const LABEL_93 = `Over ${'y'.repeat(80)} ENDTAIL`;
const LABEL_79 = `Full ${'y'.repeat(67)} ENDTAI`;
const OVER_TEXT = `PASTE ${'w'.repeat(10_000)}`;

const PAGE = pageOf([
  { id: 'h', kind: 'heading', level: 2, text: doc(`Long ${'x'.repeat(515)}`) },
  { id: 'f', kind: 'heading', level: 2, text: 'Find the program' },
  { id: 't', kind: 'text', text: doc(OVER_TEXT) },
  { id: 'B', kind: 'buttons', align: 'left', buttons: [{ label: LABEL_93, href: 'https://example.org/one', style: 'primary' }] },
  { id: 'C', kind: 'buttons', align: 'left', buttons: [{ label: LABEL_79, href: 'https://example.org/two', style: 'primary' }] },
]);

test.beforeEach(() => resetLearn(PAGE));

test.afterEach(async ({ page: _unused }, info) => {
  if (info.status !== info.expectedStatus && SHOTS) {
    const pages = (_unused.context().browser()?.contexts() ?? []).flatMap((c) => c.pages()).filter((p) => p !== _unused);
    for (const [i, p] of pages.entries()) await p.screenshot({ path: `${SHOTS}/t348-failed-${info.title.slice(0, 40).replace(/\W+/g, '-')}-${i}.png` }).catch(() => {});
  }
});

const rich = (page: Page, id: string) => block(page, id).locator('.rt-content').first();

/** A paste event with `text`, sent to the field with the caret, as the browser sends one. */
async function pasteText(page: Page, text: string) {
  await page.evaluate((t) => {
    const el = document.activeElement as HTMLElement;
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

/** Selects `text` inside the field with the caret. */
async function selectWords(page: Page, text: string) {
  await page.evaluate((t) => {
    const root = document.activeElement as HTMLElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const i = node.data.indexOf(t);
      if (i < 0) continue;
      window.getSelection()!.setBaseAndExtent(node, i, node, i + t.length);
      return;
    }
    throw new Error(`no "${t}" in the field`);
  }, text);
  await page.waitForTimeout(150);
}

const textOf = (v: unknown): string => {
  const n = v as { type?: string; text?: string; content?: unknown[] } | string;
  if (typeof n === 'string') return n;
  if (n?.type === 'text') return n.text ?? '';
  return (n?.content ?? []).map(textOf).join('');
};

test('B2-rich: a heading over its limit says so while the caret is in it, and typing says why it adds nothing', async ({ browser }) => {
  const { ctx, page } = await editor(browser);
  await clickWords(page, 'Long', 'h');
  const h = rich(page, 'h');
  await expect(h).toBeFocused();
  await expect(h).toHaveAttribute('data-limit-over', '');
  await expect(h).toHaveAttribute('data-limit-note', '520 characters; the limit is 500. Shorten it to publish.');
  await page.keyboard.type('Q');
  await expect(h).not.toContainText('Q');
  await expect(h).toHaveAttribute('data-limit-note', '520 characters; the limit is 500. Shorten it to publish.');
  // The note is drawn, not only stored.
  expect(await h.evaluate((el) => getComputedStyle(el, '::after').content)).toContain('the limit is 500');
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});

test('N-C2, D-N5: a long paste into a heading is cut and the field says so', async ({ browser }) => {
  const { ctx, page } = await editor(browser);
  await clickWords(page, 'Find the program', 'f');
  await page.keyboard.press('End');
  await pasteText(page, 'y'.repeat(2470));
  const f = rich(page, 'f');
  await expect(f).toHaveAttribute('data-limit-note', 'Pasted text was cut to fit the limit of 500 characters.');
  await expect(f).not.toHaveAttribute('data-limit-over', '');
  await waitSaved(page);
  expect(textOf((await draftBlock('f'))?.text)).toHaveLength(500);
  // It goes after a few seconds.
  await expect(f).not.toHaveAttribute('data-limit-note', /./, { timeout: 8000 });
  await ctx.close();
});

test('D-S1: in a text block already over its limit, a short paste over a selection replaces it', async ({ browser }) => {
  const { ctx, page } = await editor(browser);
  await clickWords(page, 'PASTE', 't');
  await selectWords(page, 'PASTE');
  await pasteText(page, 'NEW');
  const t = rich(page, 't');
  await expect(t).toContainText('NEW www');
  await waitSaved(page);
  expect(textOf((await draftBlock('t'))?.text)).toBe(`NEW ${'w'.repeat(10_000)}`);
  // A longer paste over a selection keeps as much as the selection held.
  await selectWords(page, 'NEW');
  await pasteText(page, 'ABCDEFGH');
  await expect(t).toContainText('ABC www');
  await waitSaved(page);
  expect(textOf((await draftBlock('t'))?.text)).toBe(`ABC ${'w'.repeat(10_000)}`);
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});

test('D-S1, D-N4: in a label already over its limit, a paste or a key over a selection goes in', async ({ browser }) => {
  const { ctx, page } = await editor(browser);
  const label = field(page, 'B:btn:0');
  await clickWords(page, 'Over', 'B');
  await selectWords(page, 'Over');
  await pasteText(page, 'NEW');
  await expect(label).toHaveText(LABEL_93.replace('Over', 'NEW'));
  await selectWords(page, 'NEW');
  await page.keyboard.type('Q');
  await expect(label).toHaveText(LABEL_93.replace('Over', 'Q'));
  await waitSaved(page);
  expect(((await draftBlock('B'))?.buttons as { label: string }[])[0].label).toBe(LABEL_93.replace('Over', 'Q'));
  await ctx.close();
});

test('D-N3, D-N5: a commit of several characters keeps what fits, and a cut paste in a label says so', async ({ browser }) => {
  const { ctx, page } = await editor(browser);
  const label = field(page, 'C:btn:0');
  await clickWords(page, 'Full', 'C');
  await selectWords(page, 'ENDTAI');
  await page.keyboard.press('ArrowRight');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.insertText', { text: 'hello' });
  await expect(label).toHaveText(`${LABEL_79}h`);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await pasteText(page, 'PASTED-WORDS');
  await expect(label).toHaveText(`${LABEL_79.slice(0, -1)}PA`);
  await expect(label).toHaveAttribute('data-limit-note', 'Pasted text was cut to fit the limit of 80 characters.');
  await waitSaved(page);
  await ctx.close();
});

test('H N2: a list item with no words but with sub-items is named at Publish and in the Checker', async ({ browser }) => {
  await resetLearn(
    pageOf([
      {
        id: 'L',
        kind: 'list',
        ordered: false,
        items: [
          { id: 'i1', text: 'First item words' },
          { id: 'i2', text: '', children: ['Sub item only words'] },
        ],
      },
    ]),
  );
  const { ctx, page } = await editor(browser);
  await expect(block(page, 'L')).toContainText('First item words');
  await page.locator('.le-bar').getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.locator('.le-modal[role=dialog]');
  await expect(dialog).toContainText('The List block in "Main" has an item with no words. Add words or remove it.');
  await expect(dialog.getByRole('button', { name: 'Publish now' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await moreMenu(page, 'Check the page');
  const checker = page.locator(SETTINGS);
  await expect(checker.locator('.le-tools-group', { hasText: 'List item with no words' })).toContainText(
    'Item 2 has no words, so the website would leave it out with its sub-items.',
  );
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});

test('a label typed into a number with no figure is kept, and Publish and the Checker name it (fuzz seed 1770108908)', async ({ browser }) => {
  await resetLearn(
    pageOf([
      {
        id: 'S',
        kind: 'stats',
        columns: 3,
        items: [
          { id: 's1', value: '40', label: 'Instructors' },
          { id: 's2', value: '', label: '' },
        ],
      },
    ]),
  );
  const { ctx, page } = await editor(browser);
  await clickWords(page, 'Instructors', 'S');
  await field(page, 'S:s:s2:label').click();
  await page.keyboard.type('Label only words');
  await waitSaved(page);
  expect(((await draftBlock('S'))?.items as { label: string }[])[1].label).toBe('Label only words');
  await page.locator('.le-bar').getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.locator('.le-modal[role=dialog]');
  await expect(dialog).toContainText('The Numbers block in "Main" has a number with a label but no figure. Add the figure or remove it.');
  await expect(dialog.getByRole('button', { name: 'Publish now' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await moreMenu(page, 'Check the page');
  await expect(page.locator(SETTINGS).locator('.le-tools-group', { hasText: 'Number with no figure' })).toContainText(
    'Number 2 has a label but no figure, so the website would leave it out.',
  );
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});
