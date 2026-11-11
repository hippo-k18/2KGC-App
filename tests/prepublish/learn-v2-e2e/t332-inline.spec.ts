import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { errorsOf, fsDelete, fsList, fsSet, learnDoc, openEditor, SHOTS, signedIn, waitForWeb, waitSaved } from './helpers';
import { publish } from './editor-moves';
import { LEARN, OWNER } from './people';

/**
 * The T331 gate's lost-text findings, run the way they were found (T332):
 * X1 the caret dropped after an item is removed, X2 Cmd+A in an empty table
 * cell, X3 addresses that only counted on Enter, X4 words typed under a
 * table, X5 Cmd+Down in a table, and the in-place should-fixes beside them.
 * Every step is a real click or key on the page.
 */

const PREVIEW = '.le-pane-preview .le-frame';
const PHOTO = path.resolve(__dirname, '../../../apps/web/public/kgc/tickets-hero.jpeg');
type Json = Record<string, unknown>;

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] });
const cell = (type: 'tableHeader' | 'tableCell', text: string) => ({ type, content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] });
const row = (type: 'tableHeader' | 'tableCell', ...texts: string[]) => ({ type: 'tableRow', content: texts.map((t) => cell(type, t)) });

const PAGE = {
  seoTitle: 'T332 page',
  seoDescription: '',
  sections: [
    {
      id: 'main',
      label: 'Main',
      background: 'plain',
      width: 'normal',
      paddingTop: 'medium',
      paddingBottom: 'medium',
      blocks: [
        { id: 'h', kind: 'heading', level: 2, text: 'T332 heading' },
        {
          id: 'L',
          kind: 'list',
          ordered: false,
          items: [
            { id: 'a', text: 'Alpha words' },
            { id: 'b', text: 'Beta words' },
            { id: 'c', title: 'Gamma title', text: 'Gamma words', link: { label: 'Gamma link', href: 'mailto:x@example.org', style: 'text' } },
          ],
        },
        { id: 'T', kind: 'table', striped: false, doc: { type: 'doc', content: [{ type: 'table', content: [row('tableHeader', 'Head A', 'Head B'), row('tableCell', 'Cell A', 'Cell B')] }] } },
        { id: 'B', kind: 'buttons', align: 'left', buttons: [{ label: 'First button', href: 'https://example.org/one', style: 'primary' }, { label: 'Second button', href: '#main', style: 'secondary' }] },
        {
          id: 'P',
          kind: 'people',
          style: 'cards',
          columns: 2,
          people: [
            { id: 'p1', name: 'Ada Person', role: 'First role' },
            { id: 'p2', name: 'Bo Person', role: 'Second role' },
          ],
        },
        {
          id: 'Q',
          kind: 'accordion',
          allowMany: true,
          items: [
            { id: 'q1', title: 'Question one', text: doc('Answer one') },
            { id: 'q2', title: 'Question two', text: doc('Answer two') },
          ],
        },
        { id: 'S', kind: 'stats', columns: 3, items: [{ id: 's1', value: '10', label: 'Ten things' }, { id: 's2', value: '20', label: 'Twenty things' }] },
        {
          id: 'K',
          kind: 'cards',
          columns: 3,
          items: [
            { id: 'k1', title: 'Card one', text: doc('Card one words') },
            { id: 'k2', title: 'Card two', text: doc('Card two words') },
          ],
        },
        { id: 'TB', kind: 'tabs', items: [{ id: 't1', title: 'Tab one', text: doc('Tab one words') }, { id: 't2', title: 'Tab two', text: doc('Tab two words') }] },
      ],
    },
  ],
};

async function resetLearn() {
  for (const sub of ['versions', 'library', 'media']) {
    for (const d of await fsList(`pageLayouts/learn/${sub}`)) await fsDelete(`pageLayouts/learn/${sub}/${d.id}`);
  }
  await fsDelete('pageLayouts/learn');
  await fsSet('pageLayouts/learn', { draft: PAGE, published: PAGE, revision: 1, draftUpdatedAt: Date.now(), draftUpdatedBy: OWNER });
}

test.beforeEach(resetLearn);

// LEARN_E2E_SHOTS=<folder> keeps a picture of a failed test's page, as it stood.
test.afterEach(async ({ page: _unused }, info) => {
  if (info.status !== info.expectedStatus && SHOTS) {
    const pages = (_unused.context().browser()?.contexts() ?? []).flatMap((c) => c.pages()).filter((p) => p !== _unused);
    for (const [i, p] of pages.entries()) await p.screenshot({ path: `${SHOTS}/t332-failed-${info.title.slice(0, 40).replace(/\W+/g, '-')}-${i}.png` }).catch(() => {});
  }
});

async function editor(browser: Browser, opts: { email?: string; width?: number } = {}) {
  const width = opts.width ?? 1280;
  const ctx = await signedIn(browser, opts.email ?? OWNER, { width, height: width < 600 ? 844 : 900 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('kgc-learn-tour-v3', '1');
    } catch {}
  });
  const page = await openEditor(ctx);
  if (width < 600) await page.locator('#le-tab-preview').click();
  return { ctx, page };
}

const field = (page: Page, key: string) => page.locator(`${PREVIEW} [data-lp-field="${key}"]`).first();
const block = (page: Page, id: string) => page.locator(`${PREVIEW} [data-block-id="${id}"]`).first();

/** Clicks words on the page, on the words themselves: the click selects the block and puts the caret in them. */
async function clickWords(page: Page, text: string, within?: string) {
  const scope = within ? `${PREVIEW} [data-block-id="${within}"]` : PREVIEW;
  await page.locator(scope).first().getByText(text, { exact: false }).first().scrollIntoViewIfNeeded();
  const at = await page.evaluate(
    ({ scope, text }) => {
      const root = document.querySelector(scope);
      const walker = root && document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker?.nextNode()) {
        const node = walker.currentNode as Text;
        const i = node.data.toLowerCase().indexOf(text.toLowerCase());
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + Math.min(text.length, 4));
        const b = r.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
      return null;
    },
    { scope, text },
  );
  if (!at) throw new Error(`no words "${text}" on the page`);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(300);
}

/** What has the caret: the `data-lp-field` of the field around it, or the tag of whatever else. */
const caretField = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return 'BODY';
    return a.closest('[data-lp-field]')?.getAttribute('data-lp-field') ?? a.tagName;
  });

const draft = async () => ((await learnDoc())?.draft ?? {}) as { sections: { blocks: (Json & { id: string })[] }[] };
const draftBlock = async (id: string) => (await draft()).sections.flatMap((s) => s.blocks).find((b) => b.id === id);
const draftText = async () => JSON.stringify(await draft());

/** The words of a stored table, row by row. */
function tableCells(b: Json | undefined): string[][] {
  const d = b?.doc as { content: { type: string; content?: { content: { content?: { content?: { text: string }[] }[] }[] }[] }[] };
  const table = d.content.find((n) => n.type === 'table');
  return (table?.content ?? []).map((r) => r.content.map((c) => (c.content ?? []).flatMap((p) => p.content ?? []).map((t) => t.text).join('')));
}

test.describe('X1: removing an item keeps the caret on the page', () => {
  for (const [who, width] of [
    [OWNER, 1280],
    [LEARN, 390],
  ] as const) {
    test(`Backspace in an empty list item, then typing and Backspace again (${width})`, async ({ browser }) => {
      const { ctx, page } = await editor(browser, { email: who, width });
      await clickWords(page, 'Beta words', 'L');
      await page.keyboard.press('Meta+ArrowDown');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Backspace');
      // Typing at once (0 ms) lands at the end of the item above, never on the page.
      await page.keyboard.type(' more332');
      expect(await caretField(page)).toBe('L:li:b');
      await page.keyboard.press('Backspace');
      await expect(block(page, 'L')).toHaveCount(1);
      await waitSaved(page);
      const L = await draftBlock('L');
      expect(JSON.stringify(L)).toContain('Beta words more33');
      expect((L?.items as unknown[]).length).toBe(3);

      // The first item emptied and removed: the caret goes to the next one.
      await clickWords(page, 'Alpha words', 'L');
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('X');
      expect(await caretField(page)).toBe('L:li:b');
      await waitSaved(page);
      expect(JSON.stringify(await draftBlock('L'))).toContain('XBeta words');
      expect(errorsOf(page)).toEqual([]);
      await ctx.close();
    });
  }

  test("every in-place x and Remove leaves the caret in the block, and the next words are kept", async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    const cases: { block: string; click: string; remove: () => Promise<void>; expectIn: RegExp }[] = [
      { block: 'L', click: 'Beta words', remove: () => block(page, 'L').locator('li').nth(1).getByRole('button', { name: 'Remove this item' }).click(), expectIn: /^L:li:a$/ },
      { block: 'Q', click: 'Question two', remove: () => block(page, 'Q').locator('details').nth(1).getByRole('button', { name: 'Remove this question' }).click(), expectIn: /^Q:a:q1:text$/ },
      { block: 'P', click: 'Bo Person', remove: () => block(page, 'P').locator('.lp-person').nth(1).getByRole('button', { name: /^Remove Bo Person/ }).click(), expectIn: /^P:p:p1:/ },
      { block: 'S', click: 'Twenty things', remove: () => block(page, 'S').locator('li.lp-item-shell').nth(1).getByRole('button', { name: 'Remove this number' }).click(), expectIn: /^S:s:s1:/ },
      { block: 'K', click: 'Card two words', remove: () => block(page, 'K').locator('li.lp-card').nth(1).getByRole('button', { name: 'Remove this card' }).click(), expectIn: /^K:k:k1:/ },
      { block: 'TB', click: 'Tab two', remove: () => block(page, 'TB').locator('.lp-tab').nth(1).getByRole('button', { name: 'Remove this tab' }).click(), expectIn: /^TB:t:t1:/ },
      {
        block: 'B',
        click: 'Second button',
        remove: () => block(page, 'B').getByRole('button', { name: 'Remove button' }).click(),
        expectIn: /^B:btn:0$/,
      },
    ];
    for (const c of cases) {
      await clickWords(page, c.click, c.block);
      await c.remove();
      await page.waitForTimeout(200);
      const at = await caretField(page);
      expect(at, `${c.block}: caret after removing`).toMatch(c.expectIn);
      await page.keyboard.type(`k${c.block}332`);
      // A Backspace now edits words; it never deletes the block.
      await page.keyboard.press('Backspace');
      await expect(block(page, c.block)).toHaveCount(1);
      await waitSaved(page);
      expect(await draftText(), `${c.block}: typed words kept`).toContain(`k${c.block}33`);
    }
    expect(errorsOf(page)).toEqual([]);
    await ctx.close();
  });

  test('removing the last item leaves the focus on the block, and Backspace then deletes nothing (found by the fuzz)', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    for (const words of ['Card two words', 'Card one words']) {
      await clickWords(page, words, 'K');
      const card = block(page, 'K').locator('li.lp-card').filter({ hasText: words });
      await card.hover();
      await card.getByRole('button', { name: 'Remove this card' }).click();
      await page.waitForTimeout(200);
    }
    await expect(block(page, 'K').locator('li.lp-card')).toHaveCount(0);
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim())).toBe('+ Add card');
    await page.keyboard.press('Backspace');
    await expect(block(page, 'K')).toHaveCount(1);
    await waitSaved(page);
    expect(await draftBlock('K')).toBeTruthy();
    await ctx.close();
  });

  test('every in-place add puts the caret in the new item, and starter words are replaced', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    const cases: { block: string; click: string; add: string; word: string; expectIn: RegExp }[] = [
      { block: 'L', click: 'Alpha words', add: 'Add item', word: 'addL332', expectIn: /^L:li:/ },
      { block: 'P', click: 'Ada Person', add: 'Add person', word: 'addP332', expectIn: /^P:p:.*:name$/ },
      { block: 'Q', click: 'Question one', add: 'Add question', word: 'addQ332', expectIn: /^Q:a:.*:title$/ },
      { block: 'S', click: 'Ten things', add: 'Add number', word: '99', expectIn: /^S:s:.*:value$/ },
      { block: 'K', click: 'Card one words', add: 'Add card', word: 'addK332', expectIn: /^K:k:.*:title$/ },
      { block: 'TB', click: 'Tab one', add: 'Add tab', word: 'addT332', expectIn: /^TB:t:.*:title$/ },
      { block: 'B', click: 'First button', add: 'Add button', word: 'Apply now', expectIn: /^B:btn:2$/ },
      { block: 'K', click: 'Card one words', add: 'Add a link', word: 'Read more', expectIn: /^K:k:k1:link$/ },
    ];
    for (const c of cases) {
      await clickWords(page, c.click, c.block);
      await block(page, c.block).getByRole('button', { name: c.add }).first().click();
      await page.waitForTimeout(200);
      expect(await caretField(page), `${c.block}: ${c.add}`).toMatch(c.expectIn);
      await page.keyboard.type(c.word);
      await waitSaved(page);
      const text = await draftText();
      expect(text).toContain(c.word);
      // D F8: the starter words go when you type, as in any new box.
      expect(text).not.toContain(`New button${c.word}`);
      expect(text).not.toContain(`Learn more${c.word}`);
    }
    await ctx.close();
  });
});

test.describe('X2: Cmd+A selects only the field it is pressed in', () => {
  test('in an empty table cell made by "Add a row", and in other fields', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Cell A', 'T');
    await block(page, 'T').hover();
    await block(page, 'T').getByRole('button', { name: 'Add a row' }).click();
    // The caret is in the new row's first (empty) cell; Cmd+A there, then type.
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('Price332');
    await waitSaved(page);
    const cells = tableCells(await draftBlock('T'));
    expect(cells).toEqual([
      ['Head A', 'Head B'],
      ['Cell A', 'Cell B'],
      ['Price332', ''],
    ]);
    // Twice in a cell with words: still only that cell.
    await clickWords(page, 'Cell B', 'T');
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('Only332');
    await waitSaved(page);
    expect(tableCells(await draftBlock('T'))[1]).toEqual(['Cell A', 'Only332']);

    // A person's name, a list item and the heading: each Cmd+A replaces only its own words.
    for (const [words, within, typed] of [
      ['Ada Person', 'P', 'Name332'],
      ['Alpha words', 'L', 'Item332'],
      ['T332 heading', 'h', 'Heading332'],
    ] as const) {
      await clickWords(page, words, within);
      await page.keyboard.press('Meta+a');
      await page.keyboard.type(typed);
    }
    await waitSaved(page);
    const text = await draftText();
    for (const kept of ['First role', 'Beta words', 'Bo Person', 'Gamma words', 'Name332', 'Item332', 'Heading332']) expect(text).toContain(kept);
    expect(errorsOf(page)).toEqual([]);
    await ctx.close();
  });
});

test.describe('X3: addresses count as they are typed', () => {
  for (const [who, width] of [
    [OWNER, 1280],
    [LEARN, 390],
  ] as const) {
    test(`a button's address and a LinkedIn address, typed and never Entered, survive a reload (${width})`, async ({ browser }) => {
      const { ctx, page } = await editor(browser, { email: who, width });
      await clickWords(page, 'First button', 'B');
      const box = page.locator(`${PREVIEW} .lp-link-pop input`).first();
      await box.click();
      await page.keyboard.press('Meta+a');
      await page.keyboard.type('example.org/typed332');
      // "Saved" now means the address is stored.
      await waitSaved(page);
      expect(JSON.stringify(await draftBlock('B'))).toContain('https://example.org/typed332');
      // The box still shows what was typed, not a rewrite under the caret.
      await expect(box).toHaveValue('example.org/typed332');
      // Put the box away, as a person would to see what is under it.
      await page.keyboard.press('Escape');

      await clickWords(page, 'Ada Person', 'P');
      await block(page, 'P').locator('.lp-person').first().getByRole('button', { name: 'Add a LinkedIn link' }).click();
      await page.keyboard.type('linkedin.com/in/typed332');
      await waitSaved(page);
      expect(JSON.stringify(await draftBlock('P'))).toContain('https://linkedin.com/in/typed332');

      await page.reload();
      await page.waitForSelector('.le-root');
      const text = await draftText();
      expect(text).toContain('https://example.org/typed332');
      expect(text).toContain('https://linkedin.com/in/typed332');

      // An address no page may open is held in the box and says so; it never holds up the page's saving.
      if (width < 600) await page.locator('#le-tab-preview').click();
      await clickWords(page, 'Second button', 'B');
      const box2 = page.locator(`${PREVIEW} .lp-link-pop input`).first();
      await box2.click();
      await page.keyboard.press('Meta+a');
      await page.keyboard.type('javascript:alert(1)');
      await expect(page.locator(`${PREVIEW} .lp-link-pop [role=alert]`)).toBeVisible();
      await clickWords(page, 'Gamma words', 'L');
      await page.keyboard.type(' later332');
      await waitSaved(page);
      const after = await draftText();
      expect(after).toContain('later332');
      expect(after).not.toContain('javascript:');
      expect(errorsOf(page)).toEqual([]);
      await ctx.close();
    });
  }
});

test.describe('X4 and X5: the caret stays in a table\'s cells', () => {
  test('ArrowDown out of the last row types nothing that the page does not show', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Cell B', 'T');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.type('UNDER332');
    await waitSaved(page);
    const T = await draftBlock('T');
    const d = T?.doc as { content: unknown[] };
    // The block holds its table and nothing else, so whatever was typed is in a cell.
    expect(d.content).toHaveLength(1);
    expect(tableCells(T).flat().join('|')).toContain('UNDER332');
    // Click away: still drawn, and on www after publish.
    await page.locator('.le-pane-preview').click({ position: { x: 4, y: 4 } });
    await expect(block(page, 'T')).toContainText('UNDER332');
    await publish(page);
    await waitForWeb((h) => h.includes('UNDER332'));
    await ctx.close();
  });

  test('Cmd+Down and Cmd+Up land at the end and start of the table, and no character is dropped', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    const typed: string[] = [];
    for (let i = 0; i < 12; i++) {
      await clickWords(page, i % 2 ? 'Head B' : 'Cell A', 'T');
      const down = i % 2 === 0;
      await page.keyboard.press(down ? 'Meta+ArrowDown' : 'Meta+ArrowUp');
      const word = `${down ? 'D' : 'U'}${i}abc`;
      await page.keyboard.type(word, { delay: 25 });
      typed.push(word);
      await page.waitForTimeout(900);
      await page.locator('.le-pane-preview').click({ position: { x: 4, y: 4 } });
    }
    await waitSaved(page);
    const cells = tableCells(await draftBlock('T'));
    // Every word whole: down ones at the end of the last cell, up ones at the start of the first.
    for (const w of typed) expect(cells.flat().join('|')).toContain(w);
    expect(cells[1][1].endsWith(typed.filter((w) => w.startsWith('D')).at(-1)!)).toBe(true);
    expect(cells[0][0].startsWith(typed.filter((w) => w.startsWith('U')).at(-1)!)).toBe(true);
    expect((await draftBlock('T'))?.doc).toMatchObject({ content: [{ type: 'table' }] });
    await ctx.close();
  });

  test('the + at the right edge adds a column at the right edge, and the + at the bottom a row at the bottom (D F3)', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Head A', 'T');
    await block(page, 'T').hover();
    await block(page, 'T').getByRole('button', { name: 'Add a column' }).click();
    await page.keyboard.type('NewCol332');
    await clickWords(page, 'Head A', 'T');
    await block(page, 'T').hover();
    await block(page, 'T').getByRole('button', { name: 'Add a row' }).click();
    await page.keyboard.type('NewRow332');
    await waitSaved(page);
    expect(tableCells(await draftBlock('T'))).toEqual([
      ['Head A', 'Head B', 'NewCol332'],
      ['Cell A', 'Cell B', ''],
      ['NewRow332', '', ''],
    ]);
    await ctx.close();
  });
});

test.describe('In-place should-fixes', () => {
  test('list Tab and Shift+Tab never move the caret into another box or drop a title or link (E F6, F9)', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    // Tab in the first item: nothing above to tuck under, and the caret stays.
    await clickWords(page, 'Alpha words', 'L');
    await page.keyboard.press('Tab');
    expect(await caretField(page)).toBe('L:li:a');
    await page.keyboard.press('Shift+Tab');
    expect(await caretField(page)).toBe('L:li:a');
    // Tab on the item with a title and a link: it stays an item, title and link kept.
    await clickWords(page, 'Gamma words', 'L');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect(await caretField(page)).toBe('L:li:c');
    await page.keyboard.type('Z');
    await waitSaved(page);
    const c = ((await draftBlock('L'))?.items as Json[]).find((i) => i.id === 'c');
    expect(c).toMatchObject({ title: 'Gamma title', link: { label: 'Gamma link', href: 'mailto:x@example.org' } });
    // A plain item still tucks in and comes back out.
    await clickWords(page, 'Beta words', 'L');
    await page.keyboard.press('Tab');
    await waitSaved(page);
    expect(((await draftBlock('L'))?.items as Json[])[0].children).toEqual(['Beta words']);
    await ctx.close();
  });

  test('the LinkedIn box closes on Enter, Escape and a click elsewhere (D F5)', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    const pop = page.locator(`${PREVIEW} .lp-li-pop`);
    const icon = block(page, 'P').locator('.lp-person').first().locator('.lp-li');
    await clickWords(page, 'Ada Person', 'P');
    await icon.click();
    await expect(pop).toHaveCount(1);
    await page.keyboard.type('linkedin.com/in/ada');
    await page.keyboard.press('Enter');
    await expect(pop).toHaveCount(0);
    await icon.click();
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await icon.click();
    await clickWords(page, 'First role', 'P');
    await expect(pop).toHaveCount(0);
    expect(await caretField(page)).toBe('P:p:p1:role');
    await ctx.close();
  });

  test("a card's x is on top of its \"+ Picture\" (D F7)", async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Card two words', 'K');
    const x = block(page, 'K').locator('li.lp-card').nth(1).getByRole('button', { name: 'Remove this card' });
    await expect(x).toBeVisible();
    const onTop = await x.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && el.contains(hit);
    });
    expect(onTop).toBe(true);
    await x.click();
    await expect(block(page, 'K').locator('li.lp-card')).toHaveCount(1);
    await ctx.close();
  });

  test('a button cannot be typed past its limit, and the page keeps saving (B S1, E F7)', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'First button', 'B');
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('x'.repeat(95));
    await clickWords(page, 'Beta words', 'L');
    await page.keyboard.type(' still332');
    await waitSaved(page);
    const B = await draftBlock('B');
    expect((B?.buttons as Json[])[0].label).toBe('x'.repeat(80));
    expect(await draftText()).toContain('still332');
    await ctx.close();
  });

  test('on a phone the + beside the block being typed in stays, and a sheet leaves room to scroll the words clear (D F9, F4)', async ({ browser }) => {
    const { ctx, page } = await editor(browser, { email: LEARN, width: 390 });
    await clickWords(page, 'Beta words', 'L');
    const slot = page.locator(`${PREVIEW} .lp-drop-slot`, { has: page.locator('[data-block-id="L"]') });
    await expect(slot.locator('> .lp-gap .lp-gap-btn')).toBeVisible();
    // The last button opens its sheet; its words are above the sheet.
    await clickWords(page, 'Second button', 'B');
    await page.waitForTimeout(400);
    const covered = await page.evaluate(() => {
      const words = document.activeElement as HTMLElement;
      const sheet = document.querySelector('.lp-link-pop') as HTMLElement | null;
      if (!sheet) return 'no sheet';
      return words.getBoundingClientRect().bottom > sheet.getBoundingClientRect().top ? 'covered' : 'clear';
    });
    expect(covered).toBe('clear');
    await ctx.close();
  });

  test('the image bar goes once a photo is chosen, and stays shut (D F6)', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Ada Person', 'P');
    const card = block(page, 'P').locator('.lp-person').first();
    await card.locator('.lp-img-hit').click();
    const lib = page.locator('[role=dialog]').filter({ hasText: 'Use this image' });
    await lib.locator('input[type=file]').setInputFiles(PHOTO);
    await expect.poll(async () => (await fsList('pageLayouts/learn/media')).length, { timeout: 30_000 }).toBe(1);
    await lib.locator('[aria-label^="Images"] button, [aria-label^="Images"] [role=option]').first().click();
    await lib.getByRole('button', { name: 'Use this image' }).click();
    await expect(card.locator('img')).toHaveAttribute('src', /pageLayouts%2Flearn|pageLayouts\/learn/);
    await page.waitForTimeout(600);
    await expect(page.locator(`${PREVIEW} .lp-img-bar`)).toHaveCount(0);
    // A click on the photo opens it again.
    await card.locator('.lp-img-hit').click();
    await expect(page.locator(`${PREVIEW} .lp-img-bar`)).toHaveCount(1);
    await ctx.close();
  });

  test('on a phone the formatting bubble with More stays on screen and off the tabs (D F13)', async ({ browser }) => {
    const { ctx, page } = await editor(browser, { email: LEARN, width: 390 });
    await clickWords(page, 'T332 heading', 'h');
    await page.keyboard.press('Meta+a');
    const bubble = page.locator('.rt-bubble-floating');
    await expect(bubble).toBeVisible();
    await bubble.getByRole('button', { name: 'More tools' }).click();
    await page.waitForTimeout(300);
    const r = await bubble.boundingBox();
    const tabs = await page.locator('.le-tabs').boundingBox();
    expect(r!.x).toBeGreaterThanOrEqual(0);
    expect(r!.x + r!.width).toBeLessThanOrEqual(390);
    if (tabs) expect(r!.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1);
    await ctx.close();
  });

  test('a new "Map, form or video" points at its own box on the page (D F12)', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    const end = page.locator(`${PREVIEW} .lp-gap.is-last .lp-gap-btn`).last();
    await end.scrollIntoViewIfNeeded();
    await end.click();
    await page.getByRole('dialog', { name: 'Add a block' }).getByRole('searchbox').fill('Map, form or video');
    await page.keyboard.press('Enter');
    const box = page.locator(`${PREVIEW} [data-selected] .lp-video-empty`);
    await expect(box).toContainText('in the box below');
    await expect(box).not.toContainText('panel');
    await expect(page.locator(`${PREVIEW} [data-selected]`).getByLabel('Link to show')).toBeVisible();
    await ctx.close();
  });

  test('a selected saved section carries one tag, clear of the words above it (C N2)', async ({ browser }) => {
    const fixtures = JSON.parse(readFileSync(path.join(__dirname, '.fixtures.json'), 'utf8')) as { library: Record<string, Json> };
    await fsSet('pageLayouts/learn/library/lib-cta', { name: 'Call to action', section: fixtures.library['lib-cta'], createdAt: Date.now(), createdBy: OWNER });
    const linked = {
      ...PAGE,
      sections: [{ ...PAGE.sections[0], blocks: [{ id: 'before', kind: 'text', text: 'Before the link.' }, { id: 'R', kind: 'reusable', libraryId: 'lib-cta' }] }],
    };
    await fsSet('pageLayouts/learn', { draft: linked, published: linked, revision: 1, draftUpdatedAt: Date.now(), draftUpdatedBy: OWNER });
    for (const width of [1280, 390]) {
      const { ctx, page } = await editor(browser, { width, email: width < 600 ? LEARN : OWNER });
      const copy = page.locator(`${PREVIEW} [data-lp-saved]`).first();
      await copy.scrollIntoViewIfNeeded();
      await copy.click({ position: { x: 4, y: 4 } });
      const tags = page.locator(`${PREVIEW} .lp-tag-saved`);
      await expect(tags).toHaveCount(1);
      const overlap = await page.evaluate((sel) => {
        const tag = document.querySelector(`${sel} .lp-tag-saved`)!.getBoundingClientRect();
        const words = document.querySelector(`${sel} [data-block-id="before"]`)!;
        // The words themselves, not the block's box.
        const rects: DOMRect[] = [];
        const walker = document.createTreeWalker(words, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const r = document.createRange();
          r.selectNodeContents(walker.currentNode);
          rects.push(...r.getClientRects());
        }
        return rects.some((w) => w.left < tag.right && w.right > tag.left && w.top < tag.bottom && w.bottom > tag.top);
      }, PREVIEW);
      expect(overlap, `tag over "Before the link." at ${width}`).toBe(false);
      await ctx.close();
    }
  });
});

