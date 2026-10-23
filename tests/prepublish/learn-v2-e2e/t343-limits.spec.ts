import { expect, test, type Browser, type Page } from '@playwright/test';
import { errorsOf, fsDelete, fsList, fsSet, learnDoc, openEditor, SHOTS, signedIn, waitSaved } from './helpers';
import { OWNER } from './people';

/**
 * T342 N3 and H F3, run the way they were found (T343): a real clipboard
 * paste of 2,470 characters into a heading (limit 500) and 44,400 into a text
 * block (limit 10,000) is cut to the limit and the page goes on saving; a
 * heading stored over its limit no longer stops every later save, and Publish
 * names it; a person with a role and no name is named at Publish instead of
 * vanishing from www.
 */

const PREVIEW = '.le-pane-preview .le-frame';
type Json = Record<string, unknown>;

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] });

function pageWith(extra: { heading?: unknown; people?: Json[] } = {}) {
  const blocks: Json[] = [
    { id: 'h', kind: 'heading', level: 2, text: extra.heading ?? 'Find the program' },
    { id: 't', kind: 'text', text: doc('T343 text words') },
    { id: 'o', kind: 'text', text: doc('Other block words') },
  ];
  if (extra.people) blocks.push({ id: 'P', kind: 'people', style: 'cards', columns: 2, people: extra.people });
  return {
    seoTitle: 'T343 page',
    seoDescription: '',
    sections: [{ id: 'main', label: 'Main', background: 'plain', width: 'normal', paddingTop: 'medium', paddingBottom: 'medium', blocks }],
  };
}

async function seed(content: Json) {
  for (const sub of ['versions', 'library', 'media']) {
    for (const d of await fsList(`pageLayouts/learn/${sub}`)) await fsDelete(`pageLayouts/learn/${sub}/${d.id}`);
  }
  await fsDelete('pageLayouts/learn');
  await fsSet('pageLayouts/learn', { draft: content, published: pageWith(), revision: 1, draftUpdatedAt: Date.now(), draftUpdatedBy: OWNER });
}

test.afterEach(async ({ page: _unused }, info) => {
  if (info.status !== info.expectedStatus && SHOTS) {
    const pages = (_unused.context().browser()?.contexts() ?? []).flatMap((c) => c.pages()).filter((p) => p !== _unused);
    for (const [i, p] of pages.entries()) await p.screenshot({ path: `${SHOTS}/t343-limits-failed-${info.title.slice(0, 40).replace(/\W+/g, '-')}-${i}.png` }).catch(() => {});
  }
});

async function editor(browser: Browser) {
  const ctx = await signedIn(browser, OWNER, { width: 1280, height: 900 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('kgc-learn-tour-v3', '1');
    } catch {}
  });
  return { ctx, page: await openEditor(ctx) };
}

/** Clicks words on the page, on the words themselves: the click selects the block and puts the caret in them. */
async function clickWords(page: Page, text: string, within: string) {
  const scope = `${PREVIEW} [data-block-id="${within}"]`;
  await page.locator(scope).first().getByText(text, { exact: false }).first().scrollIntoViewIfNeeded();
  const at = await page.evaluate(
    ({ scope, text }) => {
      const root = document.querySelector(scope);
      const walker = root && document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker?.nextNode()) {
        const node = walker.currentNode as Text;
        const i = node.data.indexOf(text);
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
  await page.waitForTimeout(400);
}

/** Puts `text` on the real clipboard and pastes it with the keyboard, as a person does. */
async function paste(page: Page, text: string) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(500);
}

/** Characters of text in a stored field, as the server counts them. */
function chars(v: unknown): number {
  if (typeof v === 'string') return v.length;
  if (!v || typeof v !== 'object') return 0;
  const n = v as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text') return n.text?.length ?? 0;
  return (n.content ?? []).reduce((sum: number, c) => sum + chars(c), 0);
}

const draftBlock = async (id: string) =>
  (((await learnDoc())?.draft ?? { sections: [] }) as { sections: { blocks: (Json & { id: string })[] }[] }).sections
    .flatMap((s) => s.blocks)
    .find((b) => b.id === id);

/** Types at the end of the Other block and waits for it to save. */
async function editOther(page: Page, words: string) {
  await clickWords(page, 'Other block words', 'o');
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.type(words);
  await waitSaved(page);
}

async function openPublish(page: Page) {
  await page.locator('.le-bar').getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.locator('.le-modal[role=dialog]');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('N3: a real paste of 2,470 characters into a heading and 44,400 into a text block is cut to the limit, and the page goes on saving', async ({
  browser,
}) => {
  await seed(pageWith());
  const { ctx, page } = await editor(browser);

  // The heading: limit 500, with "Find the program" (16) already there.
  await clickWords(page, 'Find the program', 'h');
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await page.keyboard.press('End');
  await paste(page, 'y'.repeat(2470));
  await waitSaved(page);
  const h = await draftBlock('h');
  expect(chars(h?.text)).toBe(500);
  expect(JSON.stringify(h?.text)).toContain('Find the program');

  // The text block: limit 10,000, pasted as paragraphs.
  const para = 'z'.repeat(440);
  const long = Array.from({ length: 100 }, () => para).join('\n\n') + 'z'.repeat(400);
  expect(long.replace(/\n/g, '')).toHaveLength(44_400);
  await clickWords(page, 'T343 text words', 't');
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await paste(page, long);
  await waitSaved(page);
  const t = await draftBlock('t');
  expect(chars(t?.text)).toBe(10_000);
  expect(JSON.stringify(t?.text)).toContain('T343 text words');

  // Typing in the full heading adds nothing; the field keeps its 500.
  await clickWords(page, 'Find the program', 'h');
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.type('QQQ');
  await page.waitForTimeout(400);
  await expect(page.locator(`${PREVIEW} [data-block-id="h"]`).first()).not.toContainText('QQQ');

  // Another block still saves, and is there after a reload.
  await editOther(page, ' edited343');
  await page.reload();
  await expect(page.locator(PREVIEW)).toContainText('Other block words edited343', { timeout: 30_000 });
  expect(JSON.stringify(await draftBlock('o'))).toContain('Other block words edited343');
  expect(chars((await draftBlock('h'))?.text)).toBe(500);
  expect(chars((await draftBlock('t'))?.text)).toBe(10_000);
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});

test('N3: a heading stored over its limit keeps its words, the page still saves, and Publish names it', async ({ browser }) => {
  await seed(pageWith({ heading: doc('x'.repeat(2470)) }));
  const { ctx, page } = await editor(browser);
  await editOther(page, ' saved343');
  await expect(page.locator('.whova-banner.danger')).toHaveCount(0);
  await page.reload();
  await expect(page.locator(PREVIEW)).toContainText('Other block words saved343', { timeout: 30_000 });
  const d = await learnDoc();
  expect(JSON.stringify(d?.draft)).toContain('Other block words saved343');
  expect(chars((await draftBlock('h'))?.text)).toBe(2470);

  const dialog = await openPublish(page);
  await expect(dialog).toContainText('The Heading block in "Main" has a heading of 2470 characters; the limit is 500.');
  await expect(dialog.getByRole('button', { name: 'Publish now' })).toBeDisabled();
  await page.keyboard.press('Escape');
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});

test('H F3: a person with a role and no name is named at Publish, never dropped quietly', async ({ browser }) => {
  await seed(
    pageWith({
      people: [
        { id: 'p1', name: 'Ada Person', role: 'First role' },
        { id: 'p2', name: '', role: 'Programme chair', bio: doc('Runs the programme.') },
      ],
    }),
  );
  const { ctx, page } = await editor(browser);
  const dialog = await openPublish(page);
  await expect(dialog).toContainText('The People block in "Main" has a person with no name. Add a name or remove them.');
  await expect(dialog.getByRole('button', { name: 'Publish now' })).toBeDisabled();
  await page.keyboard.press('Escape');
  const before = await learnDoc();
  expect(JSON.stringify(before?.published)).not.toContain('Programme chair');
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});
