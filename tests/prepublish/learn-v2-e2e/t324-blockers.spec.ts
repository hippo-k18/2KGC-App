import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { OWNER } from './people';
import { WEB, errorsOf, fsDelete, fsList, fsSet, learnDoc, openEditor, openMoreOptions, shot, signedIn, waitForWeb, waitSaved, webLearnHtml } from './helpers';
import { SETTINGS, addBlock, publish } from './editor-moves';

/**
 * The four blockers the T324 gate found, each run the way it was found (T325):
 * a stored countdown date out of range, a scheduled publish with an empty Saved
 * section, a new button with no address, and a normal Google Maps link.
 */

const DASH = process.env.E2E_URL ?? 'http://localhost:3323';

async function resetLearn() {
  for (const sub of ['versions', 'library', 'media']) {
    for (const d of await fsList(`pageLayouts/learn/${sub}`)) await fsDelete(`pageLayouts/learn/${sub}/${d.id}`);
  }
  await fsDelete('pageLayouts/learn');
}

test.beforeEach(async ({ context }) => {
  await resetLearn();
  await context.addInitScript(() => {
    try {
      localStorage.setItem('kgc-learn-tour-v3', '1');
    } catch {}
  });
});

async function editor(browser: import('@playwright/test').Browser) {
  const ctx = await signedIn(browser, OWNER);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('kgc-learn-tour-v3', '1');
    } catch {}
  });
  return { ctx, page: await openEditor(ctx) };
}

const FIXTURES = JSON.parse(readFileSync(path.join(__dirname, '.fixtures.json'), 'utf8')) as { sink: { sections: Record<string, unknown>[] } };

/** The kitchen sink with one more section holding `blocks` after a heading that marks the page. */
function page1(blocks: Record<string, unknown>[]) {
  const p = structuredClone(FIXTURES.sink);
  p.sections.push({ id: 't324', label: 'T324', background: 'plain', width: 'normal', paddingTop: 'medium', paddingBottom: 'medium', blocks: [{ id: 't324-h', kind: 'heading', text: 'T324 page', level: 2 }, ...blocks] });
  return p;
}

test('1: a stored countdown date out of range leaves /learn and the preview link at 200', async () => {
  const token = randomBytes(32).toString('base64url');
  const bad = page1([{ id: 'c', kind: 'countdown', until: 1e16 }]);
  await fsSet('pageLayouts/learn', { draft: bad, published: bad, revision: 1, previewToken: token, marker: Date.now() });
  const preview = await fetch(`${WEB}/learn/preview/${token}`);
  expect(preview.status).toBe(200);
  expect(await preview.text()).toContain('T324 page');
  // /learn renders the stored page on its next rebuild, without throwing.
  await waitForWeb((h) => h.includes('T324 page'));
  expect((await fetch(`${WEB}/learn`)).status).toBe(200);
});

test('2: a scheduled publish with an empty Saved section fails cleanly instead of a 500 every minute', async () => {
  const failedRuns = async () => (await fsList('auditLog')).filter((a) => a.action === 'learnPage.scheduledPublishFailed').length;
  const before = await failedRuns();
  const draft = page1([{ id: 'r', kind: 'reusable', libraryId: '' }]);
  await fsSet('pageLayouts/learn', { draft, published: null, revision: 1, scheduledPublishAt: Date.now() - 1000, scheduledRevision: 1 });
  const cron = () =>
    fetch(`${DASH}/api/cron/learn-page`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? 'learn-v2-e2e-cron-secret'}` },
    });
  expect((await cron()).status).toBe(200);
  const doc = await learnDoc();
  expect(doc?.scheduledPublishAt).toBeUndefined();
  expect(JSON.stringify(doc?.scheduleFailure)).toMatch(/Saved section/);
  expect(doc?.published ?? null).toBeNull();
  // The next tick has nothing to do.
  expect((await cron()).status).toBe(200);
  expect(await failedRuns()).toBe(before + 1);
});

test('3: a new button with no address, or half an address, still saves; publish names it', async ({ browser }) => {
  const { ctx, page } = await editor(browser);
  await addBlock(page, 'Programmes', 'Buttons');
  await waitSaved(page);
  await openMoreOptions(page);
  await page.locator(SETTINGS).getByRole('button', { name: '+ Add button' }).click();
  await waitSaved(page);
  const newLink = page.locator(`${SETTINGS} .le-set-item`).last().getByLabel('Link', { exact: true });
  await newLink.fill('example');
  await waitSaved(page);
  expect(JSON.stringify((await learnDoc())?.draft)).toContain('"href":"example"');
  await page.locator('.le-bar').getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.locator('.le-modal[role=dialog]');
  await expect(dialog).toContainText(/Buttons block .* link that is not finished/);
  await expect(dialog.getByRole('button', { name: 'Publish now' })).toBeDisabled();
  await shot(page, 't325-unfinished-link-publish');
  await page.keyboard.press('Escape');
  await newLink.fill('https://example.com/t325');
  await waitSaved(page);
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});

test('4: a normal Google Maps link saves, publishes as a map, and an empty title is fine', async ({ browser }) => {
  const { ctx, page } = await editor(browser);
  await addBlock(page, 'Programmes', 'Map, form or video');
  await waitSaved(page);
  await page.locator(`${SETTINGS} input[type=url]`).first().fill('https://www.google.com/maps/place/Bryant+Park/@40.7536,-73.9832,17z/data=!3m1');
  await waitSaved(page);
  await expect(page.locator(`${SETTINGS} .le-set-status.ok`)).toBeVisible();
  await page.locator(SETTINGS).getByLabel('Title for screen readers').fill('');
  await waitSaved(page);
  await shot(page, 't325-maps-place-link');
  await publish(page);
  await waitForWeb((h) => h.includes('output=embed'));
  const html = await webLearnHtml();
  expect(html).toMatch(/src="https:\/\/www\.google\.com\/maps\?q=[^"]*output=embed"/);
  expect(html).toMatch(/<iframe[^>]*title="Map"/);

  // A short share link cannot be converted without asking Google; it saves and the editor says what to do.
  await page.locator(`${SETTINGS} input[type=url]`).first().fill('https://maps.app.goo.gl/abc123');
  await waitSaved(page);
  await expect(page.locator(`${SETTINGS} .le-set-status.bad`)).toContainText(/address bar/);
  expect(errorsOf(page)).toEqual([]);
  await ctx.close();
});
