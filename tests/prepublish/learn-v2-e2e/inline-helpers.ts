import type { Browser, Page } from '@playwright/test';
import { fsDelete, fsList, fsSet, learnDoc, openEditor, signedIn, type Json } from './helpers';
import { OWNER } from './people';

/** Moves shared by the in-place editing specs from T343 on (t332-inline.spec.ts keeps its own copies). */

export const PREVIEW = '.le-pane-preview .le-frame';

export const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] });
const cell = (type: 'tableHeader' | 'tableCell', text: string) => ({ type, content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] });
export const row = (type: 'tableHeader' | 'tableCell', ...texts: string[]) => ({ type: 'tableRow', content: texts.map((t) => cell(type, t)) });
export const tableDoc = (...rows: ReturnType<typeof row>[]) => ({ type: 'doc', content: [{ type: 'table', content: rows }] });

/** A page of one section holding `blocks`, stored as both the draft and the published page. */
export function pageOf(blocks: Json[], more: Json[] = []) {
  return {
    seoTitle: 'T343 page',
    seoDescription: '',
    sections: [
      { id: 'main', label: 'Main', background: 'plain', width: 'normal', paddingTop: 'medium', paddingBottom: 'medium', blocks },
      ...more,
    ],
  };
}

export async function resetLearn(page: Json) {
  for (const sub of ['versions', 'library', 'media']) {
    for (const d of await fsList(`pageLayouts/learn/${sub}`)) await fsDelete(`pageLayouts/learn/${sub}/${d.id}`);
  }
  await fsDelete('pageLayouts/learn');
  await fsSet('pageLayouts/learn', { draft: page, published: page, revision: 1, draftUpdatedAt: Date.now(), draftUpdatedBy: OWNER });
}

export async function editor(browser: Browser, opts: { email?: string; width?: number } = {}) {
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

export const field = (page: Page, key: string) => page.locator(`${PREVIEW} [data-lp-field="${key}"]`).first();
export const block = (page: Page, id: string) => page.locator(`${PREVIEW} [data-block-id="${id}"]`).first();

/** Where the words `text` are drawn on the page, as a point on their first letters. */
export async function wordsAt(page: Page, text: string, within?: string) {
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
  return at;
}

/** Clicks words on the page, on the words themselves: the click selects the block and puts the caret in them. */
export async function clickWords(page: Page, text: string, within?: string, pause = 300) {
  const at = await wordsAt(page, text, within);
  await page.mouse.click(at.x, at.y);
  if (pause) await page.waitForTimeout(pause);
}

/** What has the caret: the `data-lp-field` of the field around it, or the tag of whatever else. */
export const caretField = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return 'BODY';
    return a.closest('[data-lp-field]')?.getAttribute('data-lp-field') ?? a.tagName;
  });

export const draft = async () => ((await learnDoc())?.draft ?? {}) as { sections: { id: string; blocks: (Json & { id: string })[] }[] };
export const draftBlock = async (id: string) => (await draft()).sections.flatMap((s) => s.blocks).find((b) => b.id === id);
export const draftText = async () => JSON.stringify(await draft());

/** The words of a stored table, row by row. */
export function tableCells(b: Json | undefined): string[][] {
  const d = b?.doc as { content: { type: string; content?: { content: { content?: { content?: { text: string }[] }[] }[] }[] }[] };
  const table = d.content.find((n) => n.type === 'table');
  return (table?.content ?? []).map((r) => r.content.map((c) => (c.content ?? []).flatMap((p) => p.content ?? []).map((t) => t.text).join('')));
}
