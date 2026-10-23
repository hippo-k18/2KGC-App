import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { LEARN, OWNER } from './people';
import { WEB, errorsOf, storageClear, storageList, fsDelete, fsGet, fsList, fsPatch, fsSet, learnDoc, openEditor, openMoreOptions, shot, signedIn, waitForWeb, waitSaved, webLearnHtml } from './helpers';
import { SETTINGS, addBlock, caretEnd, moreMenu, publish, selectText, tool } from './editor-moves';

/**
 * The Learn editor v2 release, end to end on a private emulator (T323).
 * `run.sh` brings up Firestore and Storage emulators, the dashboard and the
 * website. Every test starts from no Learn page document at all.
 */

async function resetLearn() {
  for (const sub of ['versions', 'library', 'media']) {
    for (const d of await fsList(`pageLayouts/learn/${sub}`)) await fsDelete(`pageLayouts/learn/${sub}/${d.id}`);
  }
  await fsDelete('pageLayouts/learn');
  // The library re-indexes files it finds in the bucket, so the files go too.
  await storageClear();
}

test.beforeEach(async ({ context }) => {
  await resetLearn();
  // The first-run tour would sit over the panes.
  await context.addInitScript(() => {
    // Embedded iframes have an opaque origin, where localStorage throws.
    try {
      localStorage.setItem('kgc-learn-tour-v3', '1');
    } catch {}
  });
});

async function editorAs(browser: import('@playwright/test').Browser, email: string, viewport?: { width: number; height: number }) {
  const ctx = await signedIn(browser, email, viewport);
  await ctx.addInitScript(() => {
    // Embedded iframes have an opaque origin, where localStorage throws.
    try {
      localStorage.setItem('kgc-learn-tour-v3', '1');
    } catch {}
  });
  return { ctx, page: await openEditor(ctx) };
}

function noErrors(page: Page) {
  expect(errorsOf(page), errorsOf(page).join('\n')).toEqual([]);
}

test('rich text: every toolbar feature is saved, published and drawn on /learn', async ({ browser }) => {
  const { ctx, page } = await editorAs(browser, OWNER);
  await addBlock(page, 'Programmes', 'Text');
  await openMoreOptions(page);
  const field = page.locator(`${SETTINGS} .rt-content`).first();
  await field.click();
  await page.keyboard.press('Meta+a');
  const lines = [
    'Marks BOLDW ITALW UNDERW STRIKEW SUPW SUBW CODEW COLORW HIGHW BIGW LINKW PHONEW',
    'Heading three line',
    'Centred line',
    'Bullet one',
    'Numbered four',
    'Quoted line',
  ];
  await page.keyboard.type(lines.join('\n'));

  await selectText(page, SETTINGS, 'BOLDW');
  await page.keyboard.press('Meta+b');
  await selectText(page, SETTINGS, 'ITALW');
  await page.keyboard.press('Meta+i');
  for (const [word, label] of [
    ['UNDERW', 'Underline'],
    ['STRIKEW', 'Strikethrough'],
    ['SUPW', 'Superscript'],
    ['SUBW', 'Subscript'],
    ['CODEW', 'Inline code'],
  ] as const) {
    await selectText(page, SETTINGS, word);
    await tool(page, SETTINGS, label).click();
  }
  await selectText(page, SETTINGS, 'COLORW');
  await tool(page, SETTINGS, 'Text colour').click();
  await page.locator(`${SETTINGS} .rt-panel [aria-label="Orange"]`).click();
  await selectText(page, SETTINGS, 'HIGHW');
  await tool(page, SETTINGS, 'Highlight colour').click();
  await page.locator(`${SETTINGS} .rt-panel .rt-swatches button`).nth(2).click();
  await selectText(page, SETTINGS, 'BIGW');
  await page.locator(`${SETTINGS} select[aria-label="Text size"]`).selectOption('large');

  await selectText(page, SETTINGS, 'LINKW');
  await tool(page, SETTINGS, 'Link').click();
  await page.locator('.rt-dialog input[data-autofocus]').fill('https://example.com/learn-more');
  await page.locator('.rt-dialog .rt-primary').click();
  await selectText(page, SETTINGS, 'PHONEW');
  await tool(page, SETTINGS, 'Link').click();
  await page.locator('.rt-dialog [role="radio"]', { hasText: 'Phone' }).click();
  await page.locator('.rt-dialog input[data-autofocus]').fill('+1 (212) 555-0100');
  await page.locator('.rt-dialog .rt-primary').click();

  await selectText(page, SETTINGS, 'Heading three line');
  await page.locator(`${SETTINGS} select[aria-label="Paragraph style"]`).selectOption('h3');
  await selectText(page, SETTINGS, 'Centred line');
  await tool(page, SETTINGS, 'Align center').click();
  await selectText(page, SETTINGS, 'Bullet one');
  await tool(page, SETTINGS, 'Bulleted list').click();
  await selectText(page, SETTINGS, 'Numbered four');
  await tool(page, SETTINGS, 'Numbered list').click();
  await page.locator(`${SETTINGS} input[aria-label="Numbered list starts at"]`).fill('4');
  await page.keyboard.press('Tab');
  await selectText(page, SETTINGS, 'Quoted line');
  await tool(page, SETTINGS, 'Quote').click();

  await caretEnd(page, SETTINGS);
  await tool(page, SETTINGS, 'Divider line').click();
  await tool(page, SETTINGS, 'Table').click();
  await page.locator(`${SETTINGS} [aria-label="2 by 2"]`).click();
  await page.keyboard.type('CELLW');
  await tool(page, SETTINGS, 'Special characters').click();
  await page.locator(`${SETTINGS} .rt-panel [aria-label="Copyright"]`).click();

  await waitSaved(page);
  await shot(page, '01-rich-text-editor');
  const draft = JSON.stringify((await learnDoc())?.draft);
  for (const needle of [
    '"bold"', '"italic"', '"underline"', '"strike"', '"superscript"', '"subscript"', '"code"',
    '"color":"orange"', '"highlight"', '"size":"large"', 'https://example.com/learn-more', 'tel:+12125550100',
    '"level":3', '"align":"center"', '"bulletList"', '"start":4', '"blockquote"', '"horizontalRule"', '"table"', '©',
  ]) expect(draft, needle).toContain(needle);

  await publish(page, 'Rich text');
  await waitForWeb((h) => h.includes('BOLDW'));
  const html = await webLearnHtml();
  for (const re of [
    /<strong>BOLDW<\/strong>/, /<em>ITALW<\/em>/, /<u>UNDERW<\/u>/, /<s>STRIKEW<\/s>/, /<sup>SUPW<\/sup>/, /<sub>SUBW<\/sub>/,
    /<code>CODEW<\/code>/, /lp-tc-orange[^>]*>COLORW/, /lp-hl[^>]*>HIGHW/, /lp-fs-large[^>]*>BIGW/,
    /href="https:\/\/example.com\/learn-more"[^>]*>LINKW/, /href="tel:\+12125550100"[^>]*>PHONEW/,
    /<h3[^>]*>Heading three line<\/h3>/, /lp-ta-center[^>]*>Centred line/, /<ul class="lp-rlist"><li><p>Bullet one/,
    /<ol class="lp-rlist" start="4"><li><p>Numbered four/, /<blockquote class="lp-rquote"><p>Quoted line/, /<hr class="lp-rrule"/,
    /<table class="lp-rtable[^"]*">[\s\S]*CELLW/, /©/,
  ]) expect(html, String(re)).toMatch(re);
  const web = await ctx.newPage();
  await web.goto(`${WEB}/learn`);
  await web.locator('text=BOLDW').scrollIntoViewIfNeeded();
  await shot(web, '02-rich-text-on-learn');
  noErrors(page);
  await ctx.close();
});

const V2_KINDS: [label: string, kind: string][] = [
  ['Quote', 'quote'],
  ['Note box', 'callout'],
  ['Table', 'table'],
  ['Contents list', 'toc'],
  ['Image and text', 'imageText'],
  ['Gallery', 'gallery'],
  ['Logos', 'logos'],
  ['Cards', 'cards'],
  ['Numbers', 'stats'],
  ['Saved section', 'reusable'],
  ['Questions', 'accordion'],
  ['Tabs', 'tabs'],
  ['Countdown', 'countdown'],
  ['Map, form or video', 'embed'],
];

test('the block picker adds each of the 14 new kinds, and every one autosaves', async ({ browser }) => {
  const { ctx, page } = await editorAs(browser, OWNER);
  for (const [label, kind] of V2_KINDS) {
    await addBlock(page, 'Programmes', label);
    await waitSaved(page);
    const draft = (await learnDoc())?.draft as { sections: { label: string; blocks: { kind: string }[] }[] };
    expect(draft.sections.find((s) => s.label === 'Programmes')?.blocks.at(-1)?.kind, label).toBe(kind);
  }
  await expect(page.locator('.whova-banner.warning.le-banner')).toHaveCount(0);
  await page.locator('.le-pane-outline').getByRole('button', { name: 'Add a block' }).last().click();
  await shot(page, '03-block-picker');
  await page.keyboard.press('Escape');
  noErrors(page);
  await ctx.close();
});

type Sink = { sections: { blocks: { id: string; kind: string; hidden?: boolean; visibleOn?: string; text?: unknown }[] }[] };
/** Written by `seed.mts` from @kgc/shared: T319's v2 kitchen sink and its saved section. */
const FIXTURES = JSON.parse(readFileSync(path.resolve(__dirname, '.fixtures.json'), 'utf8')) as {
  sink: Sink;
  library: Record<string, Sink['sections'][number]>;
};
const LEARN_PAGE_KITCHEN_SINK_V2 = FIXTURES.sink;
const LEARN_LIBRARY_SAMPLE = FIXTURES.library;

/** The T319 kitchen sink without its deliberately disallowed embed, which the server rightly refuses. */
function kitchenSink() {
  const sink = structuredClone(LEARN_PAGE_KITCHEN_SINK_V2);
  for (const s of sink.sections) s.blocks = s.blocks.filter((b) => b.id !== 'v2-embed-bad');
  return sink;
}

test('all 14 new kinds publish from the editor and draw on /learn, saved section filled in', async ({ browser }) => {
  const sink = kitchenSink();
  await fsSet('pageLayouts/learn/library/lib-cta', {
    name: 'Call to action',
    section: LEARN_LIBRARY_SAMPLE['lib-cta'],
    createdAt: Date.now(),
    createdBy: OWNER,
  });
  await fsSet('pageLayouts/learn', { draft: sink, revision: 1, published: null, draftUpdatedAt: Date.now(), draftUpdatedBy: OWNER });
  const { ctx, page } = await editorAs(browser, OWNER);
  const preview = page.locator('.le-pane-preview');
  const kinds = new Set(sink.sections.flatMap((s) => s.blocks.map((b) => b.kind)));
  for (const [, kind] of V2_KINDS) expect(kinds, kind).toContain(kind);
  // Every v2 block is drawn in the preview by the website's own components.
  for (const s of sink.sections)
    for (const b of s.blocks) if (!b.hidden && b.kind !== 'reusable') await expect(preview.locator(`[data-lp-block="${b.id}"]`).first(), b.id).toBeAttached();
  await expect(preview.getByText(LEARN_LIBRARY_SAMPLE['lib-cta'].blocks.map((b) => ('text' in b && typeof b.text === 'string' ? b.text : '')).find(Boolean)!.slice(0, 20)).first()).toBeAttached();
  await shot(page, '04-kitchen-sink-preview');
  await publish(page, 'Every kind');
  const published = (await learnDoc())?.published as typeof sink;
  expect(JSON.stringify(published)).not.toContain('"reusable"');
  await waitForWeb((h) => h.includes('data-block-id="v2-'));
  const html = await webLearnHtml();
  for (const s of published.sections)
    for (const b of s.blocks) if (!b.hidden && b.visibleOn !== 'mobile') expect(html, `${b.kind} ${b.id}`).toContain(`data-block-id="${b.id}"`);
  for (const w of [1280, 390]) {
    const web = await browser.newPage({ viewport: { width: w, height: 900 } });
    await web.goto(`${WEB}/learn`);
    await web.waitForTimeout(1500);
    await shot(web, `05-kitchen-sink-on-learn-${w}`, { fullPage: true });
    await web.close();
  }
  noErrors(page);
  await ctx.close();
});

const PHOTO = path.resolve(__dirname, '../../../apps/web/public/kgc/tickets-hero.jpeg');

test('media library: upload, rename, use, refuse delete while used; crop and rotate an image', async ({ browser }) => {
  const { ctx, page } = await editorAs(browser, OWNER);
  await moreMenu(page, 'Media library');
  const lib = page.locator('[role=dialog]').filter({ hasText: 'Upload images' });
  await lib.locator('input[type=file]').setInputFiles(PHOTO);
  await expect.poll(async () => (await fsList('pageLayouts/learn/media')).length, { timeout: 30_000 }).toBe(1);
  const [row] = await fsList('pageLayouts/learn/media');
  await lib.locator('[aria-label^="Images"] button, [aria-label^="Images"] [role=option]').first().click();
  await lib.getByRole('button', { name: 'Rename' }).click();
  await lib.locator('input').filter({ hasNot: page.locator('[type=search]') }).locator('xpath=.').and(lib.getByLabel('File name')).fill('Bryant Park hero');
  await lib.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await fsGet(`pageLayouts/learn/media/${row.id}`))?.fileName).toBe('Bryant Park hero');
  await shot(page, '06-media-library');
  await lib.getByRole('button', { name: 'Done' }).click();

  // Use it in an Image block, from the library.
  await addBlock(page, 'Programmes', 'Image');
  await page.locator(SETTINGS).getByRole('button', { name: 'Choose from library' }).first().click();
  const picker = page.locator('[role=dialog]').filter({ hasText: 'Use this image' });
  await picker.getByText('Bryant Park hero').first().click();
  await picker.getByRole('button', { name: 'Use this image' }).click();
  await waitSaved(page);
  const src = (row.image as { src: string }).src;
  expect(JSON.stringify((await learnDoc())?.draft)).toContain(src.split('?')[0]);

  // Delete is refused while the draft uses it, and says where.
  await moreMenu(page, 'Media library');
  await lib.getByText('Bryant Park hero').first().click();
  await lib.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = lib.getByRole('button', { name: /Delete image/ });
  if (await confirm.count()) await confirm.click();
  await expect(lib).toContainText(/still used, so it cannot be deleted[\s\S]*Draft: Programmes/);
  expect(await fsGet(`pageLayouts/learn/media/${row.id}`)).not.toBeNull();
  await shot(page, '07-media-delete-refused');
  await lib.getByRole('button', { name: 'Done' }).click();

  // Crop to a square and rotate: a new file, the block points at it, the original stays.
  await page.locator(SETTINGS).getByRole('button', { name: 'Edit image' }).first().click();
  const ed = page.locator('[role=dialog]').filter({ hasText: 'Turn and flip' });
  await ed.getByRole('button', { name: /^1:1|Square/ }).first().click();
  await ed.getByRole('button', { name: 'Rotate right' }).click();
  await shot(page, '08-image-editor');
  await ed.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(ed).toHaveCount(0, { timeout: 60_000 });
  await waitSaved(page);
  await expect.poll(async () => (await fsList('pageLayouts/learn/media')).length, { timeout: 30_000 }).toBe(2);
  const edited = (await fsList('pageLayouts/learn/media')).find((m) => m.id !== row.id)!;
  const img = edited.image as { src: string; width: number; height: number };
  expect(String(edited.fileName)).toMatch(/\(edited\)/);
  expect(img.width).toBe(img.height);
  const draft = JSON.stringify((await learnDoc())?.draft);
  expect(draft).toContain(img.src.split('?')[0]);
  noErrors(page);
  await ctx.close();
});

test('saved sections: save one to the library, insert it linked, pick it in a block, publish it', async ({ browser }) => {
  const { ctx, page } = await editorAs(browser, OWNER);
  await page.locator('.le-pane-outline [role=treeitem][aria-label^="Section: Programmes"]').click();
  await page.locator(SETTINGS).getByRole('button', { name: 'Save to library' }).click();
  const save = page.locator('[role=dialog]').filter({ hasText: 'Save to library' });
  await save.getByLabel('Name').fill('Programmes band');
  await save.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await fsList('pageLayouts/learn/library')).length, { timeout: 20_000 }).toBe(1);
  const [item] = await fsList('pageLayouts/learn/library');

  await page.locator('.le-pane-outline').getByRole('button', { name: 'Add a section' }).click();
  const add = page.locator('[role=dialog]').filter({ hasText: 'Add a section' });
  await add.getByRole('button', { name: 'Saved sections' }).or(add.getByRole('tab', { name: 'Saved sections' })).first().click();
  await add.getByText('Programmes band').first().click();
  await add.getByRole('button', { name: 'Insert linked' }).click();
  await waitSaved(page);
  const draft = (await learnDoc())?.draft as { sections: { blocks: { kind: string; libraryId?: string }[] }[] };
  expect(draft.sections.at(-1)?.blocks[0]).toMatchObject({ kind: 'reusable', libraryId: item.id });
  // The linked section is drawn filled in: "Find the program" twice now.
  await expect(page.locator('.le-pane-preview').getByText('Find the program', { exact: false })).toHaveCount(2);
  await shot(page, '09-saved-section-linked');

  // An existing Saved section block: choose which saved section it shows.
  await addBlock(page, 'Team', 'Saved section');
  // With none chosen yet the list is open; otherwise "Choose a different saved section" opens it.
  const other = page.locator(SETTINGS).getByRole('button', { name: 'Choose a different saved section' });
  if (await other.isVisible()) await other.click();
  await page.locator(`${SETTINGS} .le-v2-lib-choice`, { hasText: 'Programmes band' }).click();
  await waitSaved(page);
  const after = (await learnDoc())?.draft as { sections: { label: string; blocks: { kind: string; libraryId?: string }[] }[] };
  const team = after.sections.find((s) => s.label === 'Team');
  expect(team?.blocks.at(-1)).toMatchObject({ kind: 'reusable', libraryId: item.id });
  await shot(page, '10-saved-section-picker');

  await publish(page, 'Saved sections');
  const pub = JSON.stringify((await learnDoc())?.published);
  expect(pub).not.toContain('"reusable"');
  await waitForWeb((h) => (h.match(/Find the program/g) ?? []).length >= 3);
  noErrors(page);
  await ctx.close();
});

async function runCron(): Promise<{ status: number; body: string }> {
  const r = await fetch(`${process.env.E2E_URL ?? 'http://localhost:3323'}/api/cron/learn-page`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? 'learn-v2-e2e-cron-secret'}` },
  });
  return { status: r.status, body: await r.text() };
}

test('schedule a publish, then the timer step publishes it; an unfinished draft is refused and said so', async ({ browser }) => {
  const { ctx, page } = await editorAs(browser, OWNER);
  await addBlock(page, 'Programmes', 'Text');
  await openMoreOptions(page);
  await page.locator(`${SETTINGS} .rt-content`).first().click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('SCHEDULEDW goes live by itself');
  await waitSaved(page);

  await page.locator('.le-bar').getByRole('button', { name: 'Schedule', exact: true }).click();
  const dlg = page.locator('[role=dialog]').filter({ hasText: /Schedule the publish/ });
  const at = new Date(Date.now() + 2 * 3600e3);
  const pad = (n: number) => String(n).padStart(2, '0');
  await dlg.locator('input[type=date]').fill(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`);
  await dlg.locator('input[type=time]').fill(`${pad(at.getHours())}:${pad(at.getMinutes())}`);
  await dlg.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect.poll(async () => (await learnDoc())?.scheduledPublishAt, { timeout: 15_000 }).toBeTruthy();
  await expect(page.locator('.le-chips')).toContainText('Scheduled');
  await shot(page, '11-scheduled');

  // Not due yet: the timer step does nothing.
  expect((await runCron()).status).toBe(200);
  expect((await learnDoc())?.published ?? null).toBeNull();
  expect((await fetch(`${process.env.E2E_URL ?? 'http://localhost:3323'}/api/cron/learn-page`, { method: 'POST' })).status).toBe(401);

  // Time passes (the stored time is moved into the past), and the step publishes.
  await fsPatch('pageLayouts/learn', { scheduledPublishAt: Date.now() - 1000 });
  expect((await runCron()).status).toBe(200);
  const doc = await learnDoc();
  expect(JSON.stringify(doc?.published)).toContain('SCHEDULEDW');
  expect(doc?.scheduledPublishAt).toBeUndefined();
  const versions = await fsList('pageLayouts/learn/versions');
  expect(versions.some((v) => String(v.note).startsWith('Scheduled'))).toBe(true);
  await waitForWeb((h) => h.includes('SCHEDULEDW'));
  await page.reload();
  await page.waitForSelector('.le-root');
  await expect(page.locator('.le-chips')).not.toContainText('Scheduled');

  // A draft with an empty Image block cannot go live by schedule: the schedule is cleared and the editor says why.
  await addBlock(page, 'Programmes', 'Image');
  await waitSaved(page);
  await page.locator('.le-bar').getByRole('button', { name: 'Schedule', exact: true }).click();
  await dlg.locator('input[type=date]').fill(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`);
  await dlg.locator('input[type=time]').fill(`${pad(at.getHours())}:${pad(at.getMinutes())}`);
  await dlg.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect.poll(async () => (await learnDoc())?.scheduledPublishAt, { timeout: 15_000 }).toBeTruthy();
  await fsPatch('pageLayouts/learn', { scheduledPublishAt: Date.now() - 1000 });
  expect((await runCron()).status).toBe(200);
  const failed = await learnDoc();
  expect(failed?.scheduledPublishAt).toBeUndefined();
  expect(failed?.scheduleFailure).toBeTruthy();
  expect(JSON.stringify(failed?.published)).not.toContain('"image","image":{"src":""');
  await page.reload();
  await page.waitForSelector('.le-root');
  await expect(page.locator('.le-root')).toContainText(/not filled in yet/);
  await shot(page, '12-schedule-failed');
  noErrors(page);
  await ctx.close();
});

test('a preview link shows the draft on www, then stops working when turned off', async ({ browser }) => {
  const { ctx, page } = await editorAs(browser, OWNER);
  await addBlock(page, 'Programmes', 'Text');
  await openMoreOptions(page);
  await page.locator(`${SETTINGS} .rt-content`).first().click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('DRAFTONLYW not live yet');
  await waitSaved(page);
  await moreMenu(page, 'Share the draft');
  const dlg = page.locator('[role=dialog]').filter({ hasText: 'Share the draft' });
  await dlg.getByRole('button', { name: 'Create a preview link' }).click();
  await expect.poll(async () => (await learnDoc())?.previewToken, { timeout: 15_000 }).toBeTruthy();
  const token = String((await learnDoc())?.previewToken);
  const url = `${WEB}/learn/preview/${token}`;
  await expect(dlg.locator('input, code, a').filter({ hasText: token }).or(dlg.locator(`input[value*="${token}"]`)).first()).toBeAttached();
  await shot(page, '13-preview-link');

  const r = await fetch(url);
  const html = await r.text();
  expect(html).toContain('DRAFTONLYW');
  expect(html).toMatch(/Preview, not published/);
  expect(r.headers.get('x-robots-tag')).toMatch(/noindex/);
  expect(await webLearnHtml()).not.toContain('DRAFTONLYW');
  const web = await browser.newPage();
  await web.goto(url);
  await web.getByText('DRAFTONLYW').scrollIntoViewIfNeeded();
  await shot(web, '14-preview-link-on-www');

  await dlg.getByRole('button', { name: 'Turn off the link' }).first().click();
  await dlg.getByRole('group', { name: 'Turn off the link' }).getByRole('button', { name: 'Turn off', exact: true }).click();
  await expect.poll(async () => (await learnDoc())?.previewToken, { timeout: 15_000 }).toBeUndefined();
  const after = await (await fetch(url)).text();
  expect(after).not.toContain('DRAFTONLYW');
  expect(after).not.toMatch(/Preview, not published/);
  await web.reload();
  await shot(web, '15-preview-link-revoked');
  await web.close();
  noErrors(page);
  await ctx.close();
});

test('a learn-only member can edit, use the media library and publish', async ({ browser }) => {
  const { ctx, page } = await editorAs(browser, LEARN);
  await addBlock(page, 'Programmes', 'Note box');
  await waitSaved(page);
  await moreMenu(page, 'Media library');
  const lib = page.locator('[role=dialog]').filter({ hasText: 'Upload images' });
  await lib.locator('input[type=file]').setInputFiles(PHOTO);
  await expect.poll(async () => (await fsList('pageLayouts/learn/media')).length, { timeout: 30_000 }).toBe(1);
  await lib.getByRole('button', { name: 'Done' }).click();
  await publish(page, 'By a course lead');
  expect(JSON.stringify((await learnDoc())?.published)).toContain('"callout"');
  await shot(page, '16-learn-member-published');
  noErrors(page);
  await ctx.close();
});

test('outline: row actions only on the selected row, in a menu; the editor at phone width', async ({ browser }) => {
  const { ctx, page } = await editorAs(browser, OWNER);
  const outline = page.locator('.le-pane-outline');
  const row = (label: string) => outline.locator('.le-ol-row', { has: page.locator(`[role=treeitem][aria-label^="${label}"]`) }).first();
  // Hovering a row that is not selected shows no action buttons over its label.
  await row('Text: Learn how knowledge').hover();
  await expect(row('Text: Learn how knowledge').getByRole('button')).toHaveCount(0);
  await shot(page, '17-outline-hover');
  await outline.locator('[role=treeitem][aria-label^="Text: Learn how knowledge"]').click();
  const more = row('Text: Learn how knowledge').getByRole('button', { name: /More actions/ });
  await expect(more).toBeVisible();
  await more.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await shot(page, '18-outline-row-menu');
  await menu.getByRole('menuitem', { name: /^Hide/ }).click();
  await waitSaved(page);
  const hero = ((await learnDoc())?.draft as { sections: { blocks: { hidden?: boolean; kind: string }[] }[] }).sections[0];
  expect(hero.blocks.some((b) => b.kind === 'text' && b.hidden)).toBe(true);
  noErrors(page);
  await ctx.close();

  // Phone width: the three panes are tabs, the bar is one row, and nothing scrolls sideways.
  const phone = await editorAs(browser, OWNER, { width: 390, height: 844 });
  for (const tab of ['Outline', 'Preview', 'Settings']) {
    await phone.page.getByRole('tab', { name: new RegExp(tab) }).click();
    await phone.page.waitForTimeout(300);
    expect(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(phone.page, `19-phone-${tab.toLowerCase()}`);
  }
  noErrors(phone.page);
  await phone.ctx.close();
});
