import { expect, test, type Page } from '@playwright/test';
import { errorsOf, learnDoc, waitSaved } from './helpers';
import { clickWords, editor, field, pageOf, PREVIEW, resetLearn } from './inline-helpers';
import { LEARN } from './people';

/**
 * T343 N7: the T342 gate saw the save chip stay on "Unsaved: Your latest
 * changes save in a moment." and then the page stop answering. Each of those
 * stalls lined up to the second with a sleep of the test machine in
 * `pmset -g log` (display off, then idle or maintenance sleep), so the
 * browser was frozen, not looping. This pins the editor half of it: after
 * the moves that came just before one stall (typing in a callout title,
 * Cmd+A, Backspace, clicks in other fields), the editor saves once and then
 * goes quiet. A loop that keeps re-arming the save timer, re-rendering or
 * re-dispatching would show here as more saves, a preview that keeps
 * changing, long tasks, or a chip that never says Saved.
 */

const PAGE = pageOf([
  { id: 'C', kind: 'callout', tone: 'warning', title: 'Warning', text: 'Seats are limited to 30 per cohort.' },
  { id: 'T', kind: 'text', text: 'Plain words to click in, then more words after them.' },
]);

test.beforeEach(() => resetLearn(PAGE));

/** Counts, from inside the page, what a busy loop would leave behind. */
async function startCounting(page: Page) {
  await page.evaluate((sel) => {
    const w = window as unknown as { __n7: { mutations: number; longTasks: number; longest: number } };
    w.__n7 = { mutations: 0, longTasks: 0, longest: 0 };
    new MutationObserver((m) => (w.__n7.mutations += m.length)).observe(document.querySelector(sel)!, { subtree: true, childList: true, characterData: true, attributes: true });
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          w.__n7.longTasks += 1;
          w.__n7.longest = Math.max(w.__n7.longest, e.duration);
        }
      }).observe({ type: 'longtask', buffered: false });
    } catch {}
  }, PREVIEW);
}
const counts = (page: Page) => page.evaluate(() => (window as unknown as { __n7: { mutations: number; longTasks: number; longest: number } }).__n7);

for (const width of [1280, 390]) {
  test(`after Cmd+A and Backspace in a callout title the editor saves once and goes quiet (${width})`, async ({ browser }) => {
    const { ctx, page } = await editor(browser, { email: LEARN, width });
    const saves: number[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/content/learn-page')) saves.push(Date.now());
    });

    await clickWords(page, 'Warning', 'C');
    await clickWords(page, 'Warning', 'C');
    await expect(field(page, 'C:title')).toBeFocused();
    await page.keyboard.type('N7a');
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('N7b');
    await clickWords(page, 'Seats', 'C');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('N7c');
    await page.keyboard.press('Tab');
    await clickWords(page, 'Plain words', 'T');
    await page.keyboard.press('Backspace');
    await clickWords(page, 'more words', 'T');

    await waitSaved(page, 10_000);
    await expect.poll(async () => JSON.stringify((await learnDoc())?.draft ?? {}), { timeout: 5000 }).toContain('N7b');

    // Quiet from here: nothing typed, so nothing should save, redraw or work.
    await startCounting(page);
    const savesBefore = saves.length;
    const t0 = Date.now();
    await page.waitForTimeout(4000);
    const answered = Date.now();
    const c = await counts(page);
    expect(Date.now() - answered, 'the page answers at once').toBeLessThan(1000);
    expect(Date.now() - t0, 'the test machine did not stall').toBeLessThan(8000);
    expect(saves.length - savesBefore, 'no save once saved').toBe(0);
    expect(c.mutations, 'the preview does not keep redrawing').toBe(0);
    expect(c.longTasks, `no long tasks (longest ${c.longest} ms)`).toBe(0);
    await expect(page.locator('.le-chips .le-chip').first()).toHaveText(/Saved/);
    expect(errorsOf(page)).toEqual([]);
    await ctx.close();
  });
}
