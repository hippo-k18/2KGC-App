import { expect, test } from '@playwright/test';
import { errorsOf, saveChip, SHOTS, waitSaved } from './helpers';
import { block, caretField, clickWords, draft, draftBlock, editor, field, pageOf, resetLearn, row, tableCells, tableDoc, wordsAt } from './inline-helpers';
import { LEARN, OWNER } from './people';

/**
 * The T342 gate's in-place findings, run the way they were found (T343).
 * Every step is a real click or key on the page.
 */

const FIGURE_52 = 'one thousand two hundred learners in four continents';
const LABEL_80 = `Begin ${'y'.repeat(66)} IMETAIL`;

const PAGE = pageOf([
  { id: 'h', kind: 'heading', level: 2, text: 'T343 heading' },
  { id: 'S', kind: 'stats', columns: 3, items: [{ id: 's1', value: FIGURE_52, label: 'Learners' }, { id: 's2', value: '20', label: 'Twenty things' }] },
  { id: 'B', kind: 'buttons', align: 'left', buttons: [{ label: LABEL_80, href: 'https://example.org/one', style: 'primary' }] },
  {
    id: 'P',
    kind: 'people',
    style: 'cards',
    columns: 2,
    people: [
      {
        id: 'p1',
        name: 'Ada Person',
        role: 'First role',
        bio: 'A short bio with a [link](/team).',
      },
    ],
  },
]);

test.beforeEach(() => resetLearn(PAGE));

test.afterEach(async ({ page: _unused }, info) => {
  if (info.status !== info.expectedStatus && SHOTS) {
    const pages = (_unused.context().browser()?.contexts() ?? []).flatMap((c) => c.pages()).filter((p) => p !== _unused);
    for (const [i, p] of pages.entries()) await p.screenshot({ path: `${SHOTS}/t343-failed-${info.title.slice(0, 40).replace(/\W+/g, '-')}-${i}.png` }).catch(() => {});
  }
});

test.describe('N1, N2, B2: a field over its limit keeps its words', () => {
  for (const [who, width] of [
    [OWNER, 1280],
    [LEARN, 390],
  ] as const) {
    test(`Backspace and Delete in an over-limit figure remove one character each, and it says it is over (${width})`, async ({ browser }) => {
      const { ctx, page } = await editor(browser, { email: who, width });
      const fig = field(page, 'S:s:s1:value');
      await clickWords(page, 'one thousand', 'S');
      // The figure wraps, so the ends of the field, not of the line.
      await page.keyboard.press('Meta+ArrowDown');
      await page.keyboard.press('Backspace');
      await expect(fig).toHaveText(FIGURE_52.slice(0, -1));
      // The field says so itself, while the caret is in it.
      await expect(fig).toHaveAttribute('data-limit-over', '');
      await expect(fig).toHaveAttribute('data-limit-note', '51 characters; the limit is 40. Shorten it to publish.');
      await page.keyboard.press('Meta+ArrowUp');
      await page.keyboard.press('Delete');
      await expect(fig).toHaveText(FIGURE_52.slice(1, -1));
      // Typing into it adds nothing and cuts nothing.
      await page.keyboard.type('ZZ');
      await expect(fig).toHaveText(FIGURE_52.slice(1, -1));
      await waitSaved(page);
      expect(((await draftBlock('S'))?.items as { value: string }[])[0].value).toBe(FIGURE_52.slice(1, -1));
      expect(errorsOf(page)).toEqual([]);
      await ctx.close();
    });
  }

  test('composed (IME) text in the middle of a full label cuts none of its words, and the field says it is over (N2)', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Begin', 'B');
    await page.keyboard.press('Home');
    for (let i = 0; i < 'Begin '.length; i++) await page.keyboard.press('ArrowRight');
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: 'かな', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: 'かな' });
    const label = field(page, 'B:btn:0');
    const want = `Begin かな${'y'.repeat(66)} IMETAIL`;
    await expect(label).toHaveText(want);
    await expect(label).toHaveAttribute('data-limit-note', '82 characters; the limit is 80. Shorten it to publish.');
    await waitSaved(page);
    expect(((await draftBlock('B'))?.buttons as { label: string }[])[0].label).toBe(want);
    await ctx.close();
  });

  test('typing at a full label says where the limit is, and a paste keeps the words after the caret (N-H)', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    const label = field(page, 'B:btn:0');
    await clickWords(page, 'Begin', 'B');
    await page.keyboard.press('End');
    await page.keyboard.type('Q');
    await expect(label).toHaveText(LABEL_80);
    await expect(label).toHaveAttribute('data-limit-note', 'The limit is 80 characters.');
    await expect(label).not.toHaveAttribute('data-limit-over', '');
    // Space made in the middle, then a long paste there: only what fits goes in, and the end stays.
    await page.keyboard.press('Home');
    for (let i = 0; i < 'Begin '.length; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Delete');
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const dt = new DataTransfer();
      dt.setData('text/plain', 'PASTED-WORDS');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(label).toHaveText(`Begin PAST${'y'.repeat(62)} IMETAIL`);
    await waitSaved(page);
    await expect(block(page, 'B')).toHaveCount(1);
    expect(await caretField(page)).toBe('B:btn:0');
    await ctx.close();
  });
});

test.describe('N6: a click in a link puts the caret there', () => {
  test('a second click on a link soon after typing in it places a caret, and the next words are added, not swapped in', async ({ browser }) => {
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Ada Person', 'P');
    const at = await wordsAt(page, 'link', 'P');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.type('W1');
    // The same spot again within half a second, as the fuzz did: ProseMirror counted it as a double click.
    await page.mouse.click(at.x, at.y);
    const sel = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(sel).toBe('');
    await page.keyboard.type('W2');
    await waitSaved(page);
    const bio = JSON.stringify((await draftBlock('P'))?.people);
    expect(bio).toContain('W1');
    expect(bio).toContain('W2');
    expect(bio).toContain('/team');
    await ctx.close();
  });
});

test.describe('N4: on a phone, the tap that closes a sheet lands where it was aimed', () => {
  const TABLE = { id: 'T', kind: 'table', striped: false, doc: tableDoc(row('tableHeader', 'Head A', 'Head B'), row('tableCell', 'Cell A', 'Cell B')) };
  const BUTTONS = { id: 'B', kind: 'buttons', align: 'left', buttons: [{ label: 'Learn more', href: 'https://example.org/one', style: 'primary' }] };

  for (const pause of [60, 300, 800]) {
    test(`with the last block's button sheet open, "+ Add button" adds one and takes the words (${pause} ms)`, async ({ browser }) => {
      await resetLearn(pageOf([{ id: 'h', kind: 'heading', level: 2, text: 'Phone page' }, TABLE, BUTTONS]));
      const { ctx, page } = await editor(browser, { email: LEARN, width: 390 });
      await clickWords(page, 'Learn more', 'B');
      await expect(page.locator('.lp-pop').first()).toBeVisible();
      await page.waitForTimeout(pause);
      const add = block(page, 'B').getByRole('button', { name: /Add button/ });
      const box = (await add.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(pause);
      await page.keyboard.type('Apply now');
      await waitSaved(page);
      const labels = ((await draftBlock('B'))?.buttons as { label: string }[]).map((b) => b.label);
      expect(labels).toEqual(['Learn more', 'Apply now']);
      await ctx.close();
    });

    test(`with a button sheet open, a tap on a table cell puts the caret in it (${pause} ms)`, async ({ browser }) => {
      await resetLearn(pageOf([{ id: 'h', kind: 'heading', level: 2, text: 'Phone page' }, BUTTONS, TABLE]));
      const { ctx, page } = await editor(browser, { email: LEARN, width: 390 });
      await clickWords(page, 'Learn more', 'B');
      // On a Mac, End scrolls; Cmd+Down is the end of the field.
      await page.keyboard.press('Meta+ArrowDown');
      await page.keyboard.type(' P2');
      await expect(page.locator('.lp-pop').first()).toBeVisible();
      await page.waitForTimeout(pause);
      const at = await wordsAt(page, 'Cell B', 'T');
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(pause);
      await page.keyboard.type('Q2cell');
      expect(await caretField(page)).toMatch(/^T:/);
      await waitSaved(page);
      expect(tableCells(await draftBlock('T')).flat().join('|')).toContain('Q2cell');
      expect(((await draftBlock('B'))?.buttons as { label: string }[])[0].label).toBe('Learn more P2');
      await ctx.close();
    });
  }
});

test.describe('N-B2: keys sent in the same moment as the click', () => {
  const TABLE = { id: 'T', kind: 'table', striped: false, doc: tableDoc(row('tableHeader', 'Head A', 'Head B'), row('tableCell', 'Cell A', 'Cell B')) };

  test('x on the last card, then Backspace twice at once: the block and the section stay', async ({ browser }) => {
    await resetLearn(
      pageOf([
        { id: 'h', kind: 'heading', level: 2, text: 'Zero page' },
        { id: 'K', kind: 'cards', columns: 3, items: [{ id: 'k1', title: 'Only card', text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Card words' }] }] } }] },
      ]),
    );
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Card words', 'K');
    const card = block(page, 'K').locator('li.lp-card').first();
    await card.hover();
    const x = (await card.getByRole('button', { name: 'Remove this card' }).boundingBox())!;
    // Click and keys in one go, no pause.
    await page.mouse.click(x.x + x.width / 2, x.y + x.height / 2);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);
    await expect(block(page, 'K')).toHaveCount(1);
    await waitSaved(page);
    expect((await draft()).sections.map((x) => x.id)).toEqual(['main']);
    expect(await draftBlock('K')).toBeTruthy();
    await ctx.close();
  });

  test('a click on another cell, then Cmd+A and typing at once, replaces that cell only', async ({ browser }) => {
    await resetLearn(pageOf([{ id: 'h', kind: 'heading', level: 2, text: 'Zero page' }, TABLE]));
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Cell A', 'T');
    const b = await wordsAt(page, 'Cell B', 'T');
    await page.mouse.click(b.x, b.y);
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('Zed');
    await waitSaved(page);
    expect(tableCells(await draftBlock('T'))).toEqual([
      ['Head A', 'Head B'],
      ['Cell A', 'Zed'],
    ]);
    await ctx.close();
  });

  test('switching between a text block and a list at once keeps every word in order', async ({ browser }) => {
    await resetLearn(
      pageOf([
        { id: 'X', kind: 'text', text: 'Text words' },
        { id: 'L', kind: 'list', ordered: false, items: [{ id: 'a', text: 'List words' }] },
      ]),
    );
    const { ctx, page } = await editor(browser);
    for (let r = 0; r < 3; r++) {
      await clickWords(page, 'Text words', 'X', 0);
      await page.keyboard.press('Meta+ArrowDown');
      await page.keyboard.type(` t${r}`);
      await clickWords(page, 'List words', 'L', 0);
      await page.keyboard.press('Meta+ArrowDown');
      await page.keyboard.type(` l${r}`);
    }
    // The words reach the page at once; the autosave starts a moment later.
    await expect(block(page, 'X')).toContainText('Text words t0 t1 t2');
    await expect(block(page, 'L')).toContainText('List words l0 l1 l2');
    await expect(saveChip(page)).not.toHaveText(/^Saved/, { timeout: 5000 }).catch(() => {});
    await waitSaved(page);
    const all = JSON.stringify([await draftBlock('X'), await draftBlock('L')]);
    expect(all).toContain('Text words t0 t1 t2');
    expect(all).toContain('List words l0 l1 l2');
    await ctx.close();
  });
});

test.describe('Should-fixes', () => {
  const TABLE = { id: 'T', kind: 'table', striped: false, doc: tableDoc(row('tableHeader', 'Head A', 'Head B'), row('tableCell', 'Cell A', 'Cell B')) };
  const BUTTONS = { id: 'B', kind: 'buttons', align: 'left', buttons: [{ label: 'Learn more', href: 'https://example.org/one', style: 'primary' }] };

  test('ArrowDown in the last row keeps the caret in its cell (E N-F)', async ({ browser }) => {
    await resetLearn(pageOf([{ id: 'h', kind: 'heading', level: 2, text: 'Arrow page' }, TABLE]));
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Cell B', 'T');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.type('Down');
    await waitSaved(page);
    expect(tableCells(await draftBlock('T'))).toEqual([
      ['Head A', 'Head B'],
      ['Cell A', 'Cell BDown'],
    ]);
    await ctx.close();
  });

  test('on a wide screen the "Goes to" box covers nothing below it: a click on the table under it types in the table (D N-S1, E N-E)', async ({ browser }) => {
    await resetLearn(pageOf([{ id: 'h', kind: 'heading', level: 2, text: 'Cover page' }, BUTTONS, TABLE]));
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Learn more', 'B');
    await expect(page.locator('.lp-link-pop')).toBeVisible();
    const pop = (await page.locator('.lp-link-pop').boundingBox())!;
    const table = (await block(page, 'T').boundingBox())!;
    expect(table.y).toBeGreaterThanOrEqual(pop.y + pop.height);
    await clickWords(page, 'Head A', 'T');
    await page.keyboard.type('Q2');
    await waitSaved(page);
    expect(tableCells(await draftBlock('T'))[0].join('|')).toContain('Q2');
    expect(((await draftBlock('B'))?.buttons as { href: string }[])[0].href).toBe('https://example.org/one');
    await ctx.close();
  });

  test("a press on the table bubble's background keeps the caret in the cell (E N-E)", async ({ browser }) => {
    await resetLearn(pageOf([{ id: 'h', kind: 'heading', level: 2, text: 'Bubble page' }, TABLE]));
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Cell A', 'T');
    const bubble = page.locator('.rt-bubble-floating').first();
    await expect(bubble).toBeVisible();
    const box = (await bubble.boundingBox())!;
    // The bubble's own edge, clear of its buttons.
    await page.mouse.click(box.x + 2, box.y + box.height / 2);
    await page.keyboard.type('Kept');
    await waitSaved(page);
    expect(tableCells(await draftBlock('T'))[1][0]).toContain('Kept');
    await ctx.close();
  });

  test("the LinkedIn box leaves the person's role free to click (D F5)", async ({ browser }) => {
    await resetLearn(PAGE);
    const { ctx, page } = await editor(browser);
    await clickWords(page, 'Ada Person', 'P');
    await block(page, 'P').getByRole('button', { name: /LinkedIn link/ }).click();
    await expect(page.locator('.lp-li-pop')).toBeVisible();
    const role = await wordsAt(page, 'First role', 'P');
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-lp-field]')?.getAttribute('data-lp-field') ?? 'none', role);
    expect(hit).toBe('P:p:p1:role');
    await ctx.close();
  });

  test('on a phone every item x is on top and inside the page (D F7)', async ({ browser }) => {
    await resetLearn(
      pageOf([
        { id: 'h', kind: 'heading', level: 2, text: 'Phone x page' },
        { id: 'K', kind: 'cards', columns: 3, items: ['one', 'two', 'three'].map((w, i) => ({ id: `k${i}`, title: `Card ${w}`, text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Words ${w}` }] }] } })) },
        { id: 'S', kind: 'stats', columns: 3, items: [{ id: 's1', value: '10', label: 'Ten things' }, { id: 's2', value: '20', label: 'Twenty things' }] },
        { id: 'P', kind: 'people', style: 'cards', columns: 2, people: [{ id: 'p1', name: 'Ada Person', role: 'First role' }, { id: 'p2', name: 'Bo Person', role: 'Second role' }] },
      ]),
    );
    const { ctx, page } = await editor(browser, { email: LEARN, width: 390 });
    for (const [id, words] of [
      ['K', 'Words one'],
      ['S', 'Ten things'],
      ['P', 'Ada Person'],
    ] as const) {
      await clickWords(page, words, id);
      const xs = block(page, id).locator('.lp-item-remove');
      const n = await xs.count();
      expect(n, id).toBeGreaterThan(1);
      for (let i = 0; i < n; i++) {
        await xs.nth(i).scrollIntoViewIfNeeded();
        const on = await xs.nth(i).evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return Boolean(top && (top === el || el.contains(top)));
        });
        expect(on, `${id} x ${i} is on top`).toBe(true);
      }
    }
    await ctx.close();
  });
});
