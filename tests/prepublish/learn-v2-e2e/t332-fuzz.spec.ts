import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { errorsOf, fsDelete, fsList, fsSet, learnDoc, openEditor, SHOTS, signedIn, waitSaved, webLearnHtml } from './helpers';
import { publish } from './editor-moves';
import { LEARN, OWNER } from './people';

/**
 * A fuzz of in-place editing (T332): random sequences of clicks on words,
 * typing, Enter, Backspace, Tab, Shift+Tab, the arrows, Cmd+A, Cmd+Up and
 * Cmd+Down, undo, redo, the + and x of repeating items and the table's edge
 * buttons, across every block kind on a page that has them all.
 *
 * What it holds the editor to, after every step:
 * - Words typed with the caret in a field appear there at once, whole.
 * - A word on the page only goes on a step that can delete words: Backspace,
 *   typing over a selection, an item's x, undo or redo.
 * - The caret is not dropped onto the page by a key or a click inside a
 *   block (the T331 X1 class), and no block is ever deleted. (Backspace is
 *   only pressed with the caret in a field: with none, it deletes the
 *   selected block on purpose.)
 * Every few steps, and at the end, once saved: every word on the page is in
 * the draft, and every word in the draft is on the page (X4). At the end the
 * page is published and every word in the draft is on www.
 *
 * LEARN_FUZZ_SEEDS=1,2,3 and LEARN_FUZZ_STEPS=150 set how long it runs.
 */

type Json = Record<string, unknown>;
type Section = { id: string; blocks: (Json & { id: string; kind: string })[] } & Json;

const PREVIEW = '.le-pane-preview .le-frame';
const FIXTURES = JSON.parse(readFileSync(path.join(__dirname, '.fixtures.json'), 'utf8')) as { sink24: { sections: Section[] } & Json };
const SEEDS = (process.env.LEARN_FUZZ_SEEDS ?? '1,2,3,4').split(',').map(Number);
const STEPS = Number(process.env.LEARN_FUZZ_STEPS ?? 120);
const CHECK_EVERY = 12;

/**
 * Every kind, minus what www deliberately does not draw (a link it refuses, a
 * saved section, a block for one device only), so "in the draft" and "on
 * www" mean the same words.
 */
function fuzzPage() {
  const page = structuredClone(FIXTURES.sink24);
  page.seoTitle = 'T332 fuzz';
  page.sections = page.sections.map((s) => ({
    ...s,
    blocks: s.blocks.filter((b) => !JSON.stringify(b).includes('NOT ALLOWED') && b.kind !== 'reusable' && !b.visibleOn),
  }));
  return page;
}

/** A small seeded random source, so a failing run can be run again exactly. */
function rng(seed: number) {
  let a = seed * 2654435761;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: T[]) => xs[Math.floor(next() * xs.length)] };
}

const squash = (s: string) => s.replace(/\s+/g, '');

/** Keys whose values are not words on the page. */
const NOT_WORDS = new Set([
  'id', 'kind', 'type', 'href', 'src', 'style', 'url', 'provider', 'anchor', 'align', 'background', 'width', 'height', 'shape', 'size',
  'tone', 'layout', 'aspect', 'level', 'imageSide', 'imageWidth', 'textColor', 'visibleOn', 'spaceAbove', 'spaceBelow', 'maxWidth',
  'paddingTop', 'paddingBottom', 'libraryId', 'color', 'attrs', 'alt', 'doneText',
]);

/** The words of a block in page order, with nothing between the halves of a word split by Enter. */
function words(v: unknown, key = ''): string {
  if (typeof v === 'string') return NOT_WORDS.has(key) ? '' : v;
  if (Array.isArray(v)) return v.map((x) => words(x, key)).join('');
  if (v && typeof v === 'object') return Object.entries(v as Json).map(([k, x]) => words(x, k)).join('');
  return '';
}

/** The draft's words: its blocks', not the sections' own names, which the page does not draw. */
const draftText = (draft: { sections: Section[] }) => squash(draft.sections.map((s) => words(s.blocks)).join(''));

/**
 * Gaps in the test runner's own clock. When the test machine sleeps (a Mac
 * with its display off goes into idle sleep, then wakes for a few seconds at
 * a time), the browser stops with it: the save chip sits on "Unsaved" and the
 * page "stops answering", which is not the editor's doing (T343 N7: all three
 * stalls in T342 lined up to the second with `pmset -g log` sleeps). A page
 * cannot stop this process's timers, so a gap here names the machine.
 */
const hostGaps: string[] = [];
function watchHost() {
  let last = Date.now();
  const t = setInterval(() => {
    const now = Date.now();
    if (now - last > 10_000) hostGaps.push(`${Math.round((now - last) / 1000)} s ending ${new Date(now).toLocaleTimeString()}`);
    last = now;
  }, 1000);
  t.unref();
  return () => clearInterval(t);
}
const hostNote = () =>
  hostGaps.length ? `\nThe test machine itself was frozen (asleep?) for ${hostGaps.join(', ')}: not a page failure. Run under \`caffeinate -i -s\`.` : '';

/**
 * The preview's words. A page that stops answering is a failure of its own:
 * after 15 seconds its script is paused and where it is stuck is reported.
 */
async function pageText(page: Page): Promise<string> {
  const read = page.evaluate((sel) => (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ''), PREVIEW);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'hung'>((res) => (timer = setTimeout(() => res('hung'), 15_000)));
  const got = await Promise.race([read, late]);
  clearTimeout(timer);
  if (got !== 'hung') return got;
  const cdp = await page.context().newCDPSession(page);
  const paused = new Promise<{ callFrames: { functionName: string; url: string; location: { lineNumber: number } }[] }>((res) => cdp.once('Debugger.paused', res));
  await cdp.send('Debugger.enable');
  await cdp.send('Debugger.setAsyncCallStackDepth', { maxDepth: 16 });
  await cdp.send('Debugger.pause');
  const at = await Promise.race([paused, new Promise<null>((res) => setTimeout(() => res(null), 5000))]);
  const where = at ? at.callFrames.slice(0, 12).map((f) => `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.location.lineNumber}`).join('\n') : 'no stack';
  throw new Error(`the page stopped answering; its script was at:\n${where}${hostNote()}`);
}

/** Where the focus is: a field on the page, or what else. */
const focusKind = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return 'body';
    if (a.isContentEditable && a.closest('.le-pane-preview')) return 'field';
    // With no words left in a block, its own "+ Add" button holds the focus.
    if (a.matches('.lp-item-add') && a.closest('.le-pane-preview')) return 'block-control';
    if (a.closest('.le-pane-preview')) return 'preview-other';
    return 'outside';
  });

const draftBlockIds = async () => {
  const d = (await learnDoc())?.draft as { sections: Section[] };
  return new Set(d.sections.flatMap((s) => s.blocks.map((b) => b.id)));
};

/** Clicks a random spot in the words of a random block, as a person picks where to type. */
async function clickRandomWords(page: Page, r: ReturnType<typeof rng>): Promise<boolean> {
  const spot = await page.evaluate(
    ({ sel, roll }) => {
      const frame = document.querySelector(sel)!;
      const pane = document.querySelector('.le-pane-preview')!.getBoundingClientRect();
      const blocks = [...frame.querySelectorAll<HTMLElement>('[data-block-id]')].filter(
        (b) => !b.closest('[data-block-id] [data-block-id]') && !/lp-block-(embed|video|gallery|logos|image|divider|spacer)/.test(b.className),
      );
      if (!blocks.length) return null;
      const b = blocks[Math.floor(roll[0] * blocks.length)];
      const nodes: Text[] = [];
      const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode as Text;
        // Words, not the editor's own controls (+ Add, x, hints, tags).
        if (!n.data.trim() || n.parentElement?.closest('button, .lp-tag, .lp-edit-hint, .lp-item-add, [aria-hidden="true"], .lp-tabpanel')) continue;
        nodes.push(n);
      }
      if (!nodes.length) return null;
      const n = nodes[Math.floor(roll[1] * nodes.length)];
      const i = Math.floor(roll[2] * n.data.length);
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, Math.min(n.data.length, i + 1));
      n.parentElement?.scrollIntoView({ block: 'center' });
      const rect = range.getBoundingClientRect();
      const x = rect.left + Math.max(1, rect.width / 2);
      const y = rect.top + rect.height / 2;
      if (x < pane.left || x > pane.right || y < pane.top || y > pane.bottom) return null;
      return { x, y };
    },
    { sel: PREVIEW, roll: [r.next(), r.next(), r.next()] },
  );
  if (!spot) return false;
  await page.mouse.click(spot.x, spot.y);
  return true;
}

/** Clicks a random visible control of the selected block: + Add, an item's x, or a table edge. */
async function clickRandomControl(page: Page, r: ReturnType<typeof rng>, kind: 'add' | 'remove' | 'table'): Promise<boolean> {
  const sel =
    kind === 'add'
      ? `${PREVIEW} [data-selected] .lp-item-add`
      : kind === 'remove'
        ? `${PREVIEW} [data-selected] .lp-item-remove`
        : `${PREVIEW} [data-selected] .lp-table-plus`;
  const all = page.locator(sel);
  const n = await all.count();
  const options: number[] = [];
  for (let i = 0; i < n; i++) {
    const text = (await all.nth(i).textContent()) ?? '';
    // Adding a photo or a logo opens the media library: not a typing step. A
    // new button or link has no address yet, which Publish rightly refuses.
    if (/photo|logo|picture|button|link/i.test(text)) continue;
    options.push(i);
  }
  if (!options.length) return false;
  const target = all.nth(r.pick(options));
  if (process.env.LEARN_FUZZ_TRACE) {
    console.log(`   ${kind}: "${await target.textContent()}" in`, await target.evaluate((el) => el.closest('[data-block-id]')?.getAttribute('data-block-id')));
  }
  await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  // An x shows on hover; hover its item first, as a person's pointer would.
  if (kind === 'remove') await target.locator('xpath=..').hover({ timeout: 2000 }).catch(() => {});
  if (kind === 'table') await target.locator('xpath=ancestor::*[contains(@class,"lp-table-wrap")][1]').hover({ timeout: 2000 }).catch(() => {});
  const ok = await target.click({ timeout: 2000 }).then(
    () => true,
    () => false,
  );
  return ok;
}

for (const [i, seed] of SEEDS.entries()) {
  const width = i % 4 === 3 ? 390 : 1280;
  const who = i % 2 ? LEARN : OWNER;
  test(`fuzz seed ${seed} at ${width} as ${who === OWNER ? 'owner' : 'learn member'}`, async ({ browser }) => {
    test.setTimeout(Math.max(600_000, STEPS * 6_000));
    for (const sub of ['versions', 'library', 'media']) {
      for (const d of await fsList(`pageLayouts/learn/${sub}`)) await fsDelete(`pageLayouts/learn/${sub}/${d.id}`);
    }
    const seeded = fuzzPage();
    await fsSet('pageLayouts/learn', { draft: seeded, published: seeded, revision: 1, draftUpdatedAt: Date.now(), draftUpdatedBy: OWNER });
    const blocksAtStart = await draftBlockIds();

    const ctx = await signedIn(browser, who, { width, height: width < 600 ? 844 : 900 });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('kgc-learn-tour-v3', '1');
      } catch {}
    });
    const page = await openEditor(ctx);
    if (width < 600) await page.locator('#le-tab-preview').click();

    const r = rng(seed);
    const log: string[] = [];
    const typed: string[] = [];
    let selecting = false;
    hostGaps.length = 0;
    const stopWatch = watchHost();
    const fail = async (why: string) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/t332-fuzz-${seed}-fail.png` });
      throw new Error(`seed ${seed}: ${why}\nlast steps:\n${log.slice(-15).join('\n')}${hostNote()}`);
    };

    const checkSaved = async (label: string) => {
      if (hostGaps.length) throw new Error(`seed ${seed}: machine slept before ${label}, run void.${hostNote()}`);
      await waitSaved(page, 40_000).catch((e: Error) => {
        if (hostGaps.length) e.message = `seed ${seed}: machine slept, run void. ${e.message}`;
        e.message += hostNote();
        throw e;
      });
      const d = (await learnDoc())?.draft as { sections: Section[] };
      const inDraft = draftText(d);
      const shown = await pageText(page);
      for (const t of typed) {
        if (shown.includes(t) && !inDraft.includes(t)) await fail(`${label}: "${t}" is on the page but not in the saved draft`);
        if (inDraft.includes(t) && !shown.includes(t)) await fail(`${label}: "${t}" is in the saved draft but not on the page`);
      }
      const ids = await draftBlockIds();
      for (const id of blocksAtStart) if (!ids.has(id)) await fail(`${label}: block ${id} was deleted`);
    };

    for (let step = 0; step < STEPS; step++) {
      // A sleep voids the run: stop at once rather than hold the shared harness for its timeouts.
      if (hostGaps.length) throw new Error(`seed ${seed}: machine slept at step ${step}, run void.${hostNote()}`);
      const before = await pageText(page);
      const focusBefore = await focusKind(page);
      // With no caret, a person mostly clicks on some words next.
      const roll = focusBefore !== 'field' && r.next() < 0.75 ? 0 : r.next();
      let op = '';
      let mayDelete = false;
      let keepsFocus = false;
      let token = '';

      if (roll < 0.2) {
        op = 'click words';
        if (!(await clickRandomWords(page, r))) continue;
        selecting = false;
      } else if (roll < 0.45) {
        const focused = await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          if (!a?.isContentEditable || !a.closest('.le-pane-preview')) return null;
          const field = a.closest<HTMLElement>('[data-lp-field]');
          const max = Number(field?.getAttribute('data-maxlength') ?? a.getAttribute('data-maxlength') ?? 0);
          return { room: max ? max - (a.textContent ?? '').length : 1e9 };
        });
        if (!focused || focused.room < 20) continue;
        token = `Q${seed}x${step}y`;
        op = `type ${token}`;
        mayDelete = selecting;
        keepsFocus = true;
        if (process.env.LEARN_FUZZ_TRACE) console.log('   into', await page.evaluate(() => document.activeElement?.closest('[data-lp-field]')?.getAttribute('data-lp-field')));
        await page.keyboard.type(token);
        typed.push(token);
        selecting = false;
      } else if (roll < 0.52) {
        op = 'Enter';
        mayDelete = selecting;
        keepsFocus = true;
        await page.keyboard.press('Enter');
        selecting = false;
      } else if (roll < 0.61) {
        // Backspace with no caret deletes the selected block, as the editor's
        // shortcut means it to; that is a choice, not lost words.
        if (focusBefore !== 'field') continue;
        op = 'Backspace';
        mayDelete = true;
        keepsFocus = true;
        await page.keyboard.press('Backspace');
        selecting = false;
      } else if (roll < 0.66) {
        op = r.next() < 0.5 ? 'Tab' : 'Shift+Tab';
        await page.keyboard.press(op);
        mayDelete = selecting;
        // Tab into a table cell selects the cell's words, as in Word (T342 H F4),
        // so the next letters may replace them. Anywhere else Tab only moves.
        selecting = await page.evaluate(() => {
          const s = getSelection();
          const cell = (n: Node | null | undefined) => (n instanceof Element ? n : n?.parentElement)?.closest('td, th');
          return !!document.querySelector('.le-pane-preview .selectedCell') || (!!s && !s.isCollapsed && !!cell(s.anchorNode) && cell(s.anchorNode) === cell(s.focusNode));
        });
      } else if (roll < 0.74) {
        op = r.pick(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
        keepsFocus = true;
        await page.keyboard.press(op);
        selecting = false;
      } else if (roll < 0.77) {
        op = 'Meta+a';
        keepsFocus = true;
        await page.keyboard.press(op);
        selecting = true;
      } else if (roll < 0.8) {
        op = r.pick(['Meta+ArrowDown', 'Meta+ArrowUp']);
        keepsFocus = true;
        await page.keyboard.press(op);
        selecting = false;
      } else if (roll < 0.84) {
        op = r.next() < 0.7 ? 'Meta+z' : 'Meta+Shift+z';
        mayDelete = true;
        await page.keyboard.press(op);
        // The browser selects what an undo puts back, so the next letters may replace it.
        selecting = true;
      } else if (roll < 0.89) {
        op = 'click add';
        keepsFocus = true;
        if (!(await clickRandomControl(page, r, 'add'))) continue;
        selecting = false;
      } else if (roll < 0.93) {
        op = 'click x';
        mayDelete = true;
        keepsFocus = true;
        if (!(await clickRandomControl(page, r, 'remove'))) continue;
        selecting = false;
      } else if (roll < 0.95) {
        op = 'click table edge';
        keepsFocus = true;
        if (!(await clickRandomControl(page, r, 'table'))) continue;
        selecting = false;
      } else if (roll < 0.98) {
        op = 'click away';
        await page.locator('.le-pane-preview').click({ position: { x: 3, y: 3 } });
        selecting = false;
      } else {
        op = 'Escape';
        await page.keyboard.press('Escape');
        selecting = false;
      }
      await page.waitForTimeout(120);
      log.push(`${step}: ${op} (focus ${focusBefore})`);
      if (process.env.LEARN_FUZZ_TRACE) console.log(log[log.length - 1]);

      // A word typed into the middle of an earlier one splits it; read past the new word.
      const after = (await pageText(page)).split(token || '\u0000').join('');
      if (token && !(await pageText(page)).includes(token)) await fail(`step ${step}: typed "${token}" with the caret in a field, and it is not on the page`);
      if (!mayDelete) {
        for (const t of typed) {
          if (before.includes(t) && !after.includes(t)) {
            const d = JSON.stringify((await learnDoc())?.draft ?? {});
            const i = d.indexOf(t);
            await fail(`step ${step} (${op}): "${t}" went from the page; saved draft around it: ${i < 0 ? 'not in draft' : d.slice(Math.max(0, i - 300), i + 100)}`);
          }
        }
      }
      if (keepsFocus && focusBefore === 'field' && (await focusKind(page)) === 'body') {
        await fail(`step ${step} (${op}): the caret was dropped onto the page`);
      }
      if (step % CHECK_EVERY === CHECK_EVERY - 1) await checkSaved(`step ${step}`);
    }

    // Done: put the block away, so every block is drawn as the website draws it, and check once more.
    await page.keyboard.press('Escape');
    await page.locator('.le-pane-preview').click({ position: { x: 3, y: 3 } });
    await page.waitForTimeout(300);
    await checkSaved('the end');
    const d = (await learnDoc())?.draft as { sections: Section[] };
    const kept = typed.filter((t) => draftText(d).includes(t));
    // The embedded YouTube player's own console notes are not the editor's.
    expect(errorsOf(page).filter((e) => !/Permissions policy violation/.test(e))).toEqual([]);

    // Published, every word of the draft is on www.
    await publish(page);
    await expect
      .poll(async () => {
        const html = squash((await webLearnHtml()).replace(/<[^>]+>/g, ''));
        return kept.filter((t) => !html.includes(t));
      }, { timeout: 90_000, intervals: [1000, 2000, 3000] })
      .toEqual([]);
    console.log(`seed ${seed}: ${STEPS} steps, ${typed.length} words typed, ${kept.length} kept to the end${hostNote()}`);
    stopWatch();
    await ctx.close();
  });
}
