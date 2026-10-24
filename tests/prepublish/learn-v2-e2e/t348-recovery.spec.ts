import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { errorsOf, fsSet, learnDoc, openEditor, SHOTS, waitSaved } from './helpers';
import { clickWords, draftText, editor, pageOf, PREVIEW, resetLearn } from './inline-helpers';
import { LEARN, OWNER } from './people';

/**
 * The T344 gate's recovery copy findings, run the way they were found (T348):
 * K2 / E R1, "Restore them" must keep the words typed since the editor opened,
 * and E R2, two tabs of one person keep a copy each.
 */

const PAGE = pageOf([
  { id: 'A', kind: 'text', text: 'Alpha words to start from.' },
  { id: 'Bt', kind: 'text', text: 'Beta words to start from.' },
  { id: 'C', kind: 'text', text: 'Gamma words to start from.' },
]);

test.use({ actionTimeout: 20_000 });
test.beforeEach(() => resetLearn(PAGE));

test.afterEach(async ({ page: _unused }, info) => {
  if (info.status !== info.expectedStatus && SHOTS) {
    const pages = (_unused.context().browser()?.contexts() ?? []).flatMap((c) => c.pages()).filter((p) => p !== _unused);
    for (const [i, p] of pages.entries()) await p.screenshot({ path: `${SHOTS}/t348-failed-${info.title.slice(0, 40).replace(/\W+/g, '-')}-${i}.png` }).catch(() => {});
  }
});

const recoveryBanner = (page: Page) => page.locator('.le-recovery');
const conflictBanner = (page: Page) => page.locator('.whova-banner.danger', { hasText: 'Someone else saved this page' });

/** Every save (a server action) from this page or context fails, as offline. */
async function refuseSaves(target: Page | BrowserContext) {
  await target.route('**/content/learn-page**', (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.headers()['next-action']) return route.abort('internetdisconnected');
    return route.fallback();
  });
}

/** Clicks into a text block's words and types at their end. */
async function typeAtEnd(page: Page, words: string, at: string, blockId: string) {
  await clickWords(page, at, blockId);
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(words);
}

/** The recovery copies in this browser, as one string to search. */
const storedCopies = (page: Page) =>
  page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('kgc-learn-recovery:'))
      .map((k) => localStorage.getItem(k))
      .join('\n'),
  );

/** A tab dies without pagehide or beforeunload (crash, OS kill, flat battery). */
async function crash(ctx: BrowserContext, page: Page) {
  if (page.isClosed()) return;
  const crashed = new Promise((r) => page.once('crash', r));
  try {
    const cdp = await ctx.newCDPSession(page);
    // The answer never comes: the page is gone.
    void cdp.send('Page.crash').catch(() => {});
    await Promise.race([crashed, new Promise((r) => setTimeout(r, 5000))]);
  } catch {
    // Already gone with a renderer it shared.
  }
  await page.close().catch(() => {});
}

async function reopen(ctx: BrowserContext, width: number) {
  const page = await openEditor(ctx);
  if (width < 600) await page.locator('#le-tab-preview').click();
  return page;
}

/** Leaves unsaved words in a crashed tab: `words` typed into block A while saves fail. */
async function leaveCopy(ctx: BrowserContext, page: Page, words: string) {
  await refuseSaves(page);
  await typeAtEnd(page, words, 'Alpha words', 'A');
  await expect.poll(() => storedCopies(page), { timeout: 10_000 }).toContain(words);
  await crash(ctx, page);
  expect(await draftText()).not.toContain(words);
}

test.describe('K2 / E R1: Restore keeps the words typed since opening', () => {
  for (const [who, width] of [
    [OWNER, 1280],
    [LEARN, 390],
  ] as const) {
    test(`type in another block while the offer shows, then Restore: both kept (${width})`, async ({ browser }) => {
      const { ctx, page: first } = await editor(browser, { email: who, width });
      await leaveCopy(ctx, first, ' RCold');

      const page = await reopen(ctx, width);
      await expect(recoveryBanner(page)).toContainText('that were not saved');
      // Not answering the offer: typing goes on and saves.
      await typeAtEnd(page, ' RCnew', 'Beta words', 'Bt');
      await waitSaved(page);
      await expect.poll(draftText, { timeout: 10_000 }).toContain('RCnew');

      await recoveryBanner(page).getByRole('button', { name: 'Restore them' }).click();
      await expect(recoveryBanner(page)).toHaveCount(0);
      await expect(page.locator(PREVIEW)).toContainText('RCold');
      await expect(page.locator(PREVIEW)).toContainText('RCnew');
      await waitSaved(page);
      await expect.poll(draftText, { timeout: 10_000 }).toContain('RCold');
      expect(await draftText()).toContain('RCnew');
      expect(await conflictBanner(page).count()).toBe(0);

      await page.reload();
      await page.waitForSelector('.le-root');
      await page.waitForTimeout(800);
      if (width < 600) await page.locator('#le-tab-preview').click();
      await expect(page.locator(PREVIEW)).toContainText('RCold');
      await expect(page.locator(PREVIEW)).toContainText('RCnew');
      await expect(recoveryBanner(page)).toHaveCount(0);
      expect(errorsOf(page)).toEqual([]);
      await ctx.close();
    });

    test(`someone saved in between: Restore, conflict, Keep mine keeps both (${width})`, async ({ browser }) => {
      const { ctx, page: first } = await editor(browser, { email: who, width });
      await leaveCopy(ctx, first, ' RCold');

      // The owner saves the copy's block and another one before the editor opens again.
      const doc = await learnDoc();
      const draft = JSON.parse(JSON.stringify(doc!.draft)) as { sections: { blocks: unknown[] }[] };
      draft.sections[0].blocks[0] = { id: 'A', kind: 'text', text: 'Alpha words from the owner.' };
      draft.sections[0].blocks[2] = { id: 'C', kind: 'text', text: 'Gamma words from the owner.' };
      await fsSet('pageLayouts/learn', { ...doc!, draft, revision: 2, draftUpdatedAt: Date.now(), draftUpdatedBy: OWNER });

      const page = await reopen(ctx, width);
      await expect(recoveryBanner(page)).toContainText('that were not saved');
      await typeAtEnd(page, ' RCnew', 'Beta words', 'Bt');
      await waitSaved(page);
      await expect.poll(draftText, { timeout: 10_000 }).toContain('RCnew');

      await recoveryBanner(page).getByRole('button', { name: 'Restore them' }).click();
      await expect(page.locator(PREVIEW)).toContainText('RCold');
      await expect(page.locator(PREVIEW)).toContainText('RCnew');
      // The owner's block the copy did not touch keeps the owner's words.
      await expect(page.locator(PREVIEW)).toContainText('Gamma words from the owner.');
      // The copy replaces the owner's words in block A, so the conflict asks.
      await expect(conflictBanner(page)).toBeVisible({ timeout: 20_000 });
      await conflictBanner(page).getByRole('button', { name: 'Keep mine and replace their saved changes' }).click();
      await waitSaved(page);
      await expect.poll(draftText, { timeout: 10_000 }).toContain('RCold');
      expect(await draftText()).toContain('RCnew');
      expect(await draftText()).toContain('Gamma words from the owner.');
      await expect(page.locator(PREVIEW)).toContainText('RCnew');
      expect(errorsOf(page)).toEqual([]);
      await ctx.close();
    });
  }
});

test.describe('E R2: each tab keeps its own copy', () => {
  test('R2a: two tabs cannot save and both die: both tabs\' words are offered', async ({ browser }) => {
    const { ctx, page: a } = await editor(browser);
    await refuseSaves(ctx);
    const b = await openEditor(ctx);
    await typeAtEnd(a, ' RC2tabA', 'Alpha words', 'A');
    await typeAtEnd(b, ' RC2tabB', 'Beta words', 'Bt');
    await expect.poll(() => storedCopies(a), { timeout: 10_000 }).toContain('RC2tabA');
    await expect.poll(() => storedCopies(a), { timeout: 10_000 }).toContain('RC2tabB');
    await crash(ctx, a);
    await crash(ctx, b);
    await ctx.unroute('**/content/learn-page**');

    const page = await reopen(ctx, 1280);
    await expect(recoveryBanner(page)).toContainText('in 2 tabs');
    await recoveryBanner(page).getByRole('button', { name: 'Restore them' }).click();
    await expect(page.locator(PREVIEW)).toContainText('RC2tabA');
    await expect(page.locator(PREVIEW)).toContainText('RC2tabB');
    await waitSaved(page);
    await expect.poll(draftText, { timeout: 10_000 }).toContain('RC2tabA');
    expect(await draftText()).toContain('RC2tabB');
    // Saved, so nothing is left to offer.
    await expect.poll(() => storedCopies(page), { timeout: 10_000 }).toBe('');
    expect(errorsOf(page)).toEqual([]);
    await ctx.close();
  });

  test('R2b: a save in tab B leaves tab A\'s copy, and A\'s words are offered after A dies', async ({ browser }) => {
    const { ctx, page: b } = await editor(browser);
    const a = await openEditor(ctx);
    await refuseSaves(a);
    await typeAtEnd(a, ' RC2tabKeepA', 'Alpha words', 'A');
    await expect.poll(() => storedCopies(a), { timeout: 10_000 }).toContain('RC2tabKeepA');

    await typeAtEnd(b, ' RC2tabSavedB', 'Beta words', 'Bt');
    await waitSaved(b);
    await expect.poll(draftText, { timeout: 10_000 }).toContain('RC2tabSavedB');
    await b.waitForTimeout(1000);
    expect(await storedCopies(b)).toContain('RC2tabKeepA');

    await crash(ctx, a);
    // A new tab while B is still open: B's copy is B's, A's is offered.
    const page = await reopen(ctx, 1280);
    await expect(recoveryBanner(page)).toContainText('that were not saved');
    await recoveryBanner(page).getByRole('button', { name: 'Restore them' }).click();
    await expect(page.locator(PREVIEW)).toContainText('RC2tabKeepA');
    await expect(page.locator(PREVIEW)).toContainText('RC2tabSavedB');
    // B's save came after A's words and the merge keeps it, so there is nothing to ask.
    await waitSaved(page);
    expect(await conflictBanner(page).count()).toBe(0);
    await expect.poll(draftText, { timeout: 10_000 }).toContain('RC2tabKeepA');
    expect(await draftText()).toContain('RC2tabSavedB');
    expect(errorsOf(page)).toEqual([]);
    await ctx.close();
  });
});

test.describe('T351: no word of a copy is dropped by Restore', () => {
  const flash = (page: Page) => page.locator('.le-flash');

  for (const [who, width] of [
    [LEARN, 1280],
    [OWNER, 390],
  ] as const) {
    test(`R1: the copy's block was deleted by someone else since: Restore puts it back with the words and says so (${width})`, async ({ browser }) => {
      const { ctx, page: first } = await editor(browser, { email: who, width });
      await leaveCopy(ctx, first, ' Hxyz');

      // The owner deletes block A after the copy was made.
      const doc = await learnDoc();
      const draft = JSON.parse(JSON.stringify(doc!.draft)) as { sections: { blocks: { id: string }[] }[] };
      draft.sections[0].blocks = draft.sections[0].blocks.filter((b) => b.id !== 'A');
      await fsSet('pageLayouts/learn', { ...doc!, draft, revision: 2, draftUpdatedAt: Date.now(), draftUpdatedBy: OWNER });

      const page = await reopen(ctx, width);
      await expect(recoveryBanner(page)).toContainText('that were not saved');
      await recoveryBanner(page).getByRole('button', { name: 'Restore them' }).click();
      await expect(flash(page)).toContainText('A part of the page someone removed was put back with your words.');
      await expect(page.locator(PREVIEW)).toContainText('Alpha words to start from. Hxyz');
      // Back in its old place, before Beta.
      const order = await page.locator(PREVIEW).innerText();
      expect(order.indexOf('Hxyz')).toBeLessThan(order.indexOf('Beta words'));
      await waitSaved(page);
      await expect.poll(draftText, { timeout: 10_000 }).toContain('Hxyz');
      await expect.poll(() => storedCopies(page), { timeout: 10_000 }).toBe('');
      expect(errorsOf(page)).toEqual([]);
      await ctx.close();
    });
  }

  test('E2 (H7): offline twice in the same paragraph: Restore keeps both copies\' words and blames nobody', async ({ browser }) => {
    const { ctx, page: first } = await editor(browser, { email: LEARN, width: 1280 });
    await leaveCopy(ctx, first, ' First1');
    // Reopened, the offer is left alone, and more words are typed in the same paragraph while saves still fail.
    const second = await reopen(ctx, 1280);
    await expect(recoveryBanner(second)).toContainText('that were not saved');
    await leaveCopy(ctx, second, ' Second2');

    const page = await reopen(ctx, 1280);
    await expect(recoveryBanner(page)).toContainText('in 2 tabs');
    await recoveryBanner(page).getByRole('button', { name: 'Restore them' }).click();
    await expect(flash(page)).toContainText('One place had words from two copies, and both were kept.');
    await expect(flash(page)).not.toContainText('since opening');
    await expect(page.locator(PREVIEW)).toContainText('Alpha words to start from. First1 Second2');
    await waitSaved(page);
    await expect.poll(draftText, { timeout: 10_000 }).toContain('First1 Second2');
    await expect.poll(() => storedCopies(page), { timeout: 10_000 }).toBe('');
    expect(errorsOf(page)).toEqual([]);
    await ctx.close();
  });
});
