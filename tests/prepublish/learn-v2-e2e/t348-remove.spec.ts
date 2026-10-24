import { expect, test, type Page } from '@playwright/test';
import { errorsOf, SHOTS, waitSaved } from './helpers';
import { block, caretField, doc, draft, draftBlock, editor, field, pageOf, PREVIEW, resetLearn, wordsAt } from './inline-helpers';
import { LEARN, OWNER } from './people';

/**
 * The T344 gate's remove findings (T348): after any Remove, x or "Remove
 * button", the focus stays on the block, and Backspace then never deletes the
 * block or its section. Every step is a real click or key on the page.
 */

const img = (id: string, alt: string) => ({ id, src: '/kgc/wave-3.png', alt, width: 400, height: 300 });
const pic = (alt: string) => ({ src: '/kgc/wave-3.png', alt, width: 400, height: 300 });

const TEAM = (blocks: unknown[]) => ({ id: 'team', label: 'Team', background: 'plain', width: 'normal', paddingTop: 'medium', paddingBottom: 'medium', blocks });

test.afterEach(async ({ page: _unused }, info) => {
  if (info.status !== info.expectedStatus && SHOTS) {
    const pages = (_unused.context().browser()?.contexts() ?? []).flatMap((c) => c.pages()).filter((p) => p !== _unused);
    for (const [i, p] of pages.entries()) await p.screenshot({ path: `${SHOTS}/t348-failed-${info.title.slice(0, 40).replace(/\W+/g, '-')}-${i}.png` }).catch(() => {});
  }
});

/** What has the focus, named well enough to read in a failure. */
const focusOf = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return 'BODY';
    const f = a.closest('[data-lp-field]')?.getAttribute('data-lp-field');
    return f ?? `${a.tagName}.${[...a.classList].join('.')}`;
  });

/** A block is drawn for editing once it is selected: a first click selects it. */
async function editing(page: Page, key: string) {
  if (await field(page, key).count()) return;
  const b = block(page, key.split(':')[0]);
  await b.scrollIntoViewIfNeeded();
  // On its corner: a click on an empty picture there opens the media library.
  await b.click({ position: { x: 2, y: 2 } });
  await expect(field(page, key)).toHaveCount(1);
}

/** Opens a picture's bar and presses its Remove. */
async function removePicture(page: Page, key: string) {
  await editing(page, key);
  const hit = field(page, key).locator('.lp-img-hit');
  await hit.scrollIntoViewIfNeeded();
  // The click that selected the block may have opened the bar already.
  if (!(await field(page, key).locator('.lp-img-bar').count())) await hit.click();
  const bar = field(page, key).locator('.lp-img-bar');
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Remove', exact: true }).click();
}

/** The item's own x. */
async function removeItem(page: Page, blockId: string, name: string) {
  if (!(await block(page, blockId).locator('[data-lp-field]').count())) await block(page, blockId).click({ position: { x: 2, y: 2 } });
  const x = block(page, blockId).getByRole('button', { name, exact: true }).first();
  await x.scrollIntoViewIfNeeded();
  await x.locator('xpath=..').hover();
  await x.click();
}

/** A button's or link's "Remove …" in its address box. */
async function removeLink(page: Page, key: string, name: string) {
  await editing(page, key);
  const f = field(page, key);
  await f.scrollIntoViewIfNeeded();
  await f.click();
  await page.locator(`${PREVIEW} .lp-link-pop`).getByRole('button', { name, exact: true }).click();
}

/** Waits, says where the focus is, then presses Backspace twice: the block and every section stay. */
async function backspaceAfter(page: Page, blockId: string, delay: number, what: string) {
  const sections = await page.locator(`${PREVIEW} [data-block-id]`).count();
  await page.waitForTimeout(delay);
  const focus = await focusOf(page);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  expect.soft(focus, `${what}: focus after ${delay} ms`).not.toBe('BODY');
  await expect.soft(block(page, blockId), `${what}: block kept`).toHaveCount(1);
  expect.soft(await page.locator(`${PREVIEW} [data-block-id]`).count(), `${what}: no block deleted`).toBe(sections);
  return focus;
}

test.describe('K3 (D-B1): Remove in a gallery photo bar', () => {
  const PAGE = pageOf([{ id: 'h', kind: 'heading', level: 2, text: 'Remove page' }], [
    TEAM([
      { id: 'th', kind: 'heading', level: 2, text: 'Team heading' },
      { id: 'G', kind: 'gallery', layout: 'grid', columns: 3, lightbox: false, images: [img('g1', 'Photo one'), img('g2', 'Photo two')] },
    ]),
  ]);
  for (const [who, width] of [
    [OWNER, 1280],
    [LEARN, 390],
  ] as const) {
    for (const delay of [300, 800]) {
      test(`photo 1 removed, ${delay} ms, Backspace twice: the gallery and its section stay (${width})`, async ({ browser }) => {
        await resetLearn(PAGE);
        const { ctx, page } = await editor(browser, { email: who, width });
        await removePicture(page, 'G:g:g1');
        await page.waitForTimeout(delay);
        // The next photo has the focus, not the page.
        expect(await focusOf(page)).toBe('G:g:g2');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(150);
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(500);
        await expect(block(page, 'G')).toHaveCount(1);
        await expect(block(page, 'G').locator('.lp-img-hit')).toHaveCount(1);
        await waitSaved(page);
        const d = await draft();
        expect(d.sections.map((s) => s.id)).toEqual(['main', 'team']);
        expect(((await draftBlock('G'))?.images as { id: string }[]).map((i) => i.id)).toEqual(['g2']);
        expect(errorsOf(page)).toEqual([]);
        await ctx.close();
      });
    }
  }
});

test.describe('K3 audit: every per-item remove keeps the focus on the block', () => {
  const PAGE = pageOf([
    { id: 'h', kind: 'heading', level: 2, text: 'Audit page' },
    { id: 'G', kind: 'gallery', layout: 'grid', columns: 3, lightbox: false, images: [img('g1', 'One'), img('g2', 'Two'), img('g3', 'Three')] },
    { id: 'O', kind: 'logos', grayscale: false, items: [img('o1', 'Logo one'), img('o2', 'Logo two')] },
    {
      id: 'P',
      kind: 'people',
      style: 'cards',
      columns: 3,
      people: [
        { id: 'p1', name: 'Ada Person', role: 'First role', photo: pic('Ada') },
        { id: 'p2', name: 'Bo Person', role: 'Second role' },
      ],
    },
    {
      id: 'K',
      kind: 'cards',
      columns: 3,
      items: [
        { id: 'k1', title: 'Card one', text: doc('Card one words'), image: pic('Card picture'), link: { label: 'Card link', href: '/agenda', style: 'text' } },
        { id: 'k2', title: 'Card two', text: doc('Card two words') },
      ],
    },
    {
      id: 'C',
      kind: 'columns',
      columns: 3,
      items: [
        { id: 'c1', title: 'Column one', text: 'Column one words', image: pic('Column picture'), link: { label: 'Column link', href: '/agenda', style: 'text' } },
        { id: 'c2', title: 'Column two', text: 'Column two words' },
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
    { id: 'TB', kind: 'tabs', items: [{ id: 't1', title: 'Tab one', text: doc('Tab one words') }, { id: 't2', title: 'Tab two', text: doc('Tab two words') }] },
    { id: 'S', kind: 'stats', columns: 3, items: [{ id: 's1', value: '10', label: 'Ten things' }, { id: 's2', value: '20', label: 'Twenty things' }] },
    {
      id: 'L',
      kind: 'list',
      ordered: false,
      items: [
        { id: 'a', text: 'Alpha words' },
        { id: 'b', text: 'Beta words', link: { label: 'Beta link', href: '/agenda', style: 'text' } },
      ],
    },
    { id: 'B', kind: 'buttons', align: 'left', buttons: [{ label: 'First button', href: '/one', style: 'primary' }, { label: 'Second button', href: '/two', style: 'secondary' }] },
    { id: 'QT', kind: 'quote', style: 'card', text: 'Quoted words', name: 'Quote Person', role: 'Quote role', photo: pic('Quote face') },
  ]);

  const steps: [string, string, (page: Page) => Promise<void>][] = [
    ['gallery photo 1 (next)', 'G', (p) => removePicture(p, 'G:g:g1')],
    ['gallery last photo (previous)', 'G', (p) => removePicture(p, 'G:g:g3')],
    ['gallery only photo (+ Add photo)', 'G', (p) => removePicture(p, 'G:g:g2')],
    ['logo 1', 'O', (p) => removePicture(p, 'O:l:o1')],
    ['only logo', 'O', (p) => removePicture(p, 'O:l:o2')],
    ['person photo', 'P', (p) => removePicture(p, 'P:p:p1:photo')],
    ['person x', 'P', (p) => removeItem(p, 'P', 'Remove Ada Person')],
    ['only person x (N-N1)', 'P', (p) => removeItem(p, 'P', 'Remove Bo Person')],
    ['card picture', 'K', (p) => removePicture(p, 'K:k:k1:img')],
    ['card link', 'K', (p) => removeLink(p, 'K:k:k1:link', 'Remove link')],
    ['card x', 'K', (p) => removeItem(p, 'K', 'Remove this card')],
    ['column picture', 'C', (p) => removePicture(p, 'C:c:c1:img')],
    ['column link', 'C', (p) => removeLink(p, 'C:c:c1:link', 'Remove link')],
    ['column x', 'C', (p) => removeItem(p, 'C', 'Remove this column')],
    ['question x', 'Q', (p) => removeItem(p, 'Q', 'Remove this question')],
    ['tab x', 'TB', (p) => removeItem(p, 'TB', 'Remove this tab')],
    ['number x', 'S', (p) => removeItem(p, 'S', 'Remove this number')],
    ['list link', 'L', (p) => removeLink(p, 'L:li:b:link', 'Remove link')],
    ['list item x', 'L', (p) => removeItem(p, 'L', 'Remove this item')],
    ['button 1', 'B', (p) => removeLink(p, 'B:btn:0', 'Remove button')],
    ['only button', 'B', (p) => removeLink(p, 'B:btn:0', 'Remove button')],
    ['quote photo', 'QT', (p) => removePicture(p, 'QT:photo')],
  ];

  for (const [who, width, delays] of [
    [OWNER, 1280, [300, 800, 1500]],
    [LEARN, 390, [800]],
  ] as const) {
    for (const delay of delays) {
      test(`each remove, then Backspace twice at ${delay} ms: nothing else is deleted (${width})`, async ({ browser }) => {
        test.setTimeout(300_000);
        await resetLearn(PAGE);
        const { ctx, page } = await editor(browser, { email: who, width });
        const seen: string[] = [];
        for (const [what, id, act] of steps) {
          await act(page);
          seen.push(`${what}: ${await backspaceAfter(page, id, delay, what)}`);
          console.log(`[t348 ${width} ${delay}] ${seen[seen.length - 1]}`);
          await expect(page.getByRole('dialog')).toHaveCount(0);
        }
        await waitSaved(page);
        expect((await draft()).sections[0].blocks.map((b) => b.id)).toEqual((PAGE.sections[0].blocks as { id: string }[]).map((b) => b.id));
        await ctx.close();
      });
    }
  }
});

test.describe("Should-fix (H N3): a person's Photo tools never cover a Name", () => {
  test('with the bar open, a click on its own name or the next card\'s name types there (1280)', async ({ browser }) => {
    const people = ['Ada', 'Bo', 'Cy', 'Di', 'Ed'].map((n, i) => ({ id: `p${i + 1}`, name: `${n} Person`, role: `${n} role`, photo: pic(n) }));
    await resetLearn(pageOf([{ id: 'h', kind: 'heading', level: 2, text: 'Bar page' }, { id: 'P', kind: 'people', style: 'cards', columns: 4, people }]));
    const { ctx, page } = await editor(browser);
    for (const [open, target] of [
      ['p1', 'p1'],
      ['p1', 'p2'],
      ['p3', 'p4'],
      ['p1', 'p5'],
    ]) {
      await editing(page, `P:p:${open}:photo`);
      const hit = field(page, `P:p:${open}:photo`).locator('.lp-img-hit');
      await hit.scrollIntoViewIfNeeded();
      if (!(await field(page, `P:p:${open}:photo`).locator('.lp-img-bar').count())) await hit.click();
      await expect(field(page, `P:p:${open}:photo`).locator('.lp-img-bar')).toBeVisible();
      // On the photo itself, not under it.
      const bar = (await field(page, `P:p:${open}:photo`).locator('.lp-img-bar').boundingBox())!;
      const photo = (await field(page, `P:p:${open}:photo`).locator('img').boundingBox())!;
      expect(bar.y + bar.height).toBeLessThanOrEqual(photo.y + photo.height + 1);
      const name = people.find((p) => p.id === target)!.name;
      const at = await wordsAt(page, name, 'P');
      const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-lp-field], .lp-img-bar')?.getAttribute('data-lp-field') ?? 'the bar', at);
      expect(under, `${open} bar open, ${target} name`).toBe(`P:p:${target}:name`);
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(150);
      expect(await caretField(page)).toBe(`P:p:${target}:name`);
      await page.keyboard.press('End');
      await page.keyboard.type(`Q${open}`);
      await expect(field(page, `P:p:${target}:name`)).toContainText(`Q${open}`);
    }
    await waitSaved(page);
    await ctx.close();
  });
});

test.describe('Should-fix (D-N6): a long figure stays in its column', () => {
  for (const [who, width] of [
    [OWNER, 1280],
    [LEARN, 390],
  ] as const) {
    test(`a 40-character figure wraps inside its own column (${width})`, async ({ browser }) => {
      const LONG = '500+Qnumber0r1zQnumber0r1zQnumber0r1zQnu';
      const DIGITS = '1234567890123456789012345678901234567890';
      await resetLearn(
        pageOf([
          { id: 'h', kind: 'heading', level: 2, text: 'Number page' },
          { id: 'S', kind: 'stats', columns: 3, items: [{ id: 's1', value: LONG, label: 'Long' }, { id: 's2', value: DIGITS, label: 'Digits' }, { id: 's3', value: '7', label: 'Seven things' }] },
        ]),
      );
      const { ctx, page } = await editor(browser, { email: who, width });
      // Every figure in the block, drawn as on the page and then selected for typing.
      const measure = () =>
        block(page, 'S').evaluate((b) =>
          [...b.querySelectorAll<HTMLElement>('.lp-stat-value')].map((el) => {
            const li = el.closest('li')!.getBoundingClientRect();
            const r = document.createRange();
            r.selectNodeContents(el);
            const words = r.getBoundingClientRect();
            return words.left >= li.left - 1 && words.right <= li.right + 1 && el.scrollWidth <= el.clientWidth + 1;
          }),
        );
      await block(page, 'S').scrollIntoViewIfNeeded();
      expect(await measure(), 'not selected').toEqual([true, true, true]);
      await editing(page, 'S:s:s1:value');
      expect(await measure(), 'selected').toEqual([true, true, true]);
      await ctx.close();
    });
  }
});
