import { expect, type Page } from '@playwright/test';

/** Moves the editor's tests share: adding blocks, driving the RichEditor, publishing. */

export const SETTINGS = '.le-pane-settings';

/** Adds a block of `label` (the picker's name for it) at the end of the section named `section`. */
export async function addBlock(page: Page, section: string, label: string) {
  const outline = page.locator('.le-pane-outline');
  const sectionItem = outline.locator('li', { has: page.locator(`[role=treeitem][aria-label^="Section: ${section}"]`) }).first();
  await sectionItem.getByRole('button', { name: 'Add a block' }).last().click();
  await page.locator('.le-pick .le-pick-item', { has: page.locator('.le-pick-label', { hasText: new RegExp(`^${label}$`) }) }).first().click();
  await page.waitForTimeout(250);
}

/** Selects the text from `a` to the end of `z` (or just `a`) inside the RichEditor under `scope`. */
export async function selectText(page: Page, scope: string, a: string, z = a) {
  // Focus first: an editor that gains focus puts back its own last selection a moment later, which would
  // replace the one set here. A toolbar panel hands focus back to the editor on a delay, so wait for that.
  await page
    .waitForFunction((scope) => !!document.activeElement?.closest(`${scope} .rt-content`), scope, { timeout: 1000 })
    .catch(() => {});
  await page.evaluate((scope) => {
    const ed = document.querySelector<HTMLElement>(`${scope} .rt-content`);
    if (ed && !ed.contains(document.activeElement)) ed.focus();
  }, scope);
  await page.waitForTimeout(100);
  await page.evaluate(
    ({ scope, a, z }) => {
      const find = (t: string) => {
        for (const root of Array.from(document.querySelectorAll(`${scope} .rt-content`))) {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const i = walker.currentNode.textContent!.indexOf(t);
            if (i >= 0) return { root: root as HTMLElement, n: walker.currentNode, i };
          }
        }
        return null;
      };
      const s1 = find(a);
      const s2 = find(z);
      if (!s1 || !s2) throw new Error(`text not found: ${a} / ${z}`);
      s1.root.focus();
      const r = document.createRange();
      r.setStart(s1.n, s1.i);
      r.setEnd(s2.n, s2.i + z.length);
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
    },
    { scope, a, z },
  );
  await page.waitForTimeout(150);
}

/** Puts the caret at the very end of the RichEditor under `scope`. */
export async function caretEnd(page: Page, scope: string) {
  await page.locator(`${scope} .rt-content`).first().click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.press('End');
}

export const tool = (page: Page, scope: string, label: string) => page.locator(`${scope} [aria-label="${label}"]`).first();

/** Opens Publish, types a note, publishes, and closes the "Published" dialog. */
export async function publish(page: Page, note = '') {
  // Every action has a timeout, and a refused publish fails at once with its reasons, not after the test's (T348 N4).
  await page.locator('.le-bar').getByRole('button', { name: 'Publish', exact: true }).click({ timeout: 20_000 });
  const dialog = page.locator('.le-modal[role=dialog]');
  if (note) await dialog.locator('#le-publish-note').fill(note, { timeout: 10_000 });
  const now = dialog.getByRole('button', { name: 'Publish now' });
  if (!(await expect(now).toBeEnabled({ timeout: 10_000 }).then(() => true, () => false))) {
    const why = (await dialog.locator('.le-problems li').allTextContents()).join(' | ');
    throw new Error(`Publish now is disabled: ${why || 'no blockers listed (nothing changed?)'}`);
  }
  await now.click({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Done' }).click({ timeout: 60_000 });
  await expect(dialog).toHaveCount(0);
}

/** Opens a page tool from the More menu (below 1400px wide the bar keeps them there). */
export async function moreMenu(page: Page, item: string) {
  await page.locator('.le-bar').getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}
