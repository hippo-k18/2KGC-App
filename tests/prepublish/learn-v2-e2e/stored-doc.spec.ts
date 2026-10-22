import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { OWNER } from './people';
import { WEB, fsDelete, fsList, fsSet, shot, signedIn, watch } from './helpers';
import { MARKUP, OFFSITE_LINK, hostile, setAt } from './payloads';

/**
 * What a Learn page document written straight to Firestore can do (T325, T328).
 *
 * The save and publish actions validate everything, but the website, the
 * preview link and the editor all read whatever is stored. So a stored doc
 * full of hostile values must draw as plain text with no script, inline
 * handler, unsafe link, foreign image or injected style; and a doc with any
 * field of the wrong type must still answer 200, never an error page.
 *
 * Two hostile pages: `hostile()` of the 24-kind sink, which only a direct
 * write can store, and `hostileValid`, the most hostile copy the save check
 * accepts (built in seed.mts), which is what the editor, Compare and History
 * actually draw. Values are in `payloads.ts`.
 */

type Json = Record<string, unknown>;
type Section = { blocks: Json[] } & Json;
type Page_ = { sections: Section[] } & Json;

const FIXTURES = JSON.parse(readFileSync(path.join(__dirname, '.fixtures.json'), 'utf8')) as {
  sink24: Page_;
  library: Record<string, Section>;
  hostileValid: Page_;
  hostileLibrary: Record<string, Section>;
};

const token = () => randomBytes(32).toString('base64url');

async function resetLearn() {
  for (const sub of ['versions', 'library', 'media']) {
    for (const d of await fsList(`pageLayouts/learn/${sub}`)) await fsDelete(`pageLayouts/learn/${sub}/${d.id}`);
  }
  await fsDelete('pageLayouts/learn');
}

/** Everything the page says about itself that would mean the hostile doc got through. */
async function leaks(page: Page, requests: string[] = []): Promise<string[]> {
  if (requests.length) return requests.map((u) => `request ${u.slice(0, 80)}`);
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    if (/evil\.test|^javascript:|^data:/i.test(f.url())) return [`frame ${f.url()}`];
  }
  return page.evaluate((offsite) => {
    const out: string[] = [];
    const okLink = new RegExp(offsite);
    if ((window as unknown as { __kgcCanary?: number }).__kgcCanary) out.push('canary ran');
    const bad = (s: string) => {
      // What a browser does to a URL before reading its scheme: strip controls and spaces, drop tabs and newlines.
      const t = s.replace(/[\u0000- ]/g, '').toLowerCase();
      return /^(javascript|data|vbscript):/.test(t) || t.includes('evil.test') || /^[/\\]{2}/.test(t) || /^https?:[/\\]*\\/.test(t);
    };
    for (const el of Array.from(document.querySelectorAll('*'))) {
      for (const a of Array.from(el.attributes)) {
        const name = a.name.toLowerCase();
        if (name.startsWith('on')) out.push(`<${el.tagName.toLowerCase()} ${name}>`);
        // A plain off-site https link is a real thing a page may hold; only a link element may carry it.
        const realLink = el.tagName === 'A' && name === 'href' && okLink.test(a.value);
        if (['href', 'src', 'srcset', 'action', 'formaction', 'poster', 'xlink:href', 'data'].includes(name) && bad(a.value) && !realLink) {
          out.push(`<${el.tagName.toLowerCase()} ${name}="${a.value.slice(0, 80)}">`);
        }
        if (name === 'style' && /evil\.test|javascript:|expression\(/i.test(a.value)) out.push(`<${el.tagName.toLowerCase()} style="${a.value.slice(0, 80)}">`);
      }
    }
    // Next's own payload scripts carry the page's text as escaped JSON data; any other script holding the canary was injected.
    for (const s of Array.from(document.querySelectorAll('script'))) {
      const t = s.textContent ?? '';
      if (t.includes('__kgcCanary') && !/^\s*self\.__next_f\.push\(/.test(t)) out.push(`injected <script>: ${t.slice(0, 80)}`);
    }
    for (const s of Array.from(document.querySelectorAll('style'))) if (s.textContent?.includes('evil.test')) out.push('injected <style>');
    // An off-site link opened in a new tab must not hand over the opener (noreferrer implies noopener).
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      if (a.target === '_blank' && !/noopener|noreferrer/.test(a.rel)) out.push(`target=_blank without noopener: ${a.href.slice(0, 80)}`);
    }
    return out;
  }, OFFSITE_LINK.source);
}

/** Opens a page, collects dialogs and errors, and returns what leaked. */
async function visit(browser: Browser, url: string, opts: { as?: string; then?: (p: Page) => Promise<void>; shotName?: string; textOf?: string } = {}) {
  const ctx = opts.as ? await signedIn(browser, opts.as) : await browser.newContext();
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('kgc-learn-tour-v2', '1');
    } catch {}
  });
  const page = await ctx.newPage();
  const errors = watch(page);
  // Nothing on the page may fetch from evil.test: no image, frame, style or script.
  const requests: string[] = [];
  page.on('request', (r) => {
    if (/evil\.test/i.test(r.url())) requests.push(r.url());
  });
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
  const res = await page.goto(url);
  expect(res?.status(), url).toBe(200);
  await page.waitForLoadState('networkidle').catch(() => {});
  if (opts.then) await opts.then(page);
  await page.waitForTimeout(500);
  const found = await leaks(page, requests);
  if (opts.shotName) await shot(page, opts.shotName, { fullPage: true });
  const text = await page.locator(opts.textOf ?? 'body').first().innerText();
  await ctx.close();
  return { found, errors: errors.filter((e) => !/evil\.test|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL|net::|Permissions policy violation/.test(e)), dialogs, text };
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000);

/** Saved sections: the sample made as hostile as the save allows, and a raw hostile one only a direct write can store. */
async function seedLibrary() {
  const at = Date.now();
  for (const [id, section] of Object.entries(FIXTURES.hostileLibrary)) {
    await fsSet(`pageLayouts/learn/library/${id}`, { name: `${MARKUP} saved`, section, createdAt: at, createdBy: OWNER });
  }
  await fsSet('pageLayouts/learn/library/lib-raw', {
    name: MARKUP,
    section: hostile(FIXTURES.library['lib-cta']) as Json,
    createdAt: at + 1,
    createdBy: OWNER,
  });
}

/** A page with one more section that links the raw hostile saved section. */
function withRawLink(page: Page_): Page_ {
  const p = structuredClone(page);
  p.sections.push({ ...structuredClone(p.sections[0]), id: 'raw-link', anchor: 'raw-link', blocks: [{ id: 'raw-link-b', kind: 'reusable', libraryId: 'lib-raw' }] });
  return p;
}

const quiet = (r: { found: string[]; errors: string[]; dialogs: string[] }, where: string) => {
  expect(r.found, where).toEqual([]);
  expect(r.errors, where).toEqual([]);
  expect(r.dialogs, where).toEqual([]);
};

test('a stored doc full of hostile values draws safely on www and the preview link', async ({ browser }) => {
  await resetLearn();
  await seedLibrary();
  const bad = withRawLink(hostile(FIXTURES.sink24) as Page_);
  const t = token();
  await fsSet('pageLayouts/learn', {
    draft: structuredClone(FIXTURES.sink24),
    published: bad,
    revision: 4,
    draftUpdatedAt: Date.now(),
    draftUpdatedBy: OWNER,
    previewToken: t,
  });

  // The website caches /learn for a few seconds; read it until it has caught up with the hostile copy.
  await expect
    .poll(async () => (await (await fetch(`${WEB}/learn`)).text()).includes('KGCSHOWN'), { timeout: 90_000, intervals: [2000] })
    .toBe(true);
  const www = await visit(browser, `${WEB}/learn`, { shotName: 'hostile-www' });
  quiet(www, 'www /learn');
  expect(www.text).toContain('KGCSHOWN');

  // Now the hostile page as the draft, behind the preview link: it must be the draft that draws, with the bar.
  await fsSet('pageLayouts/learn', { draft: bad, published: structuredClone(FIXTURES.sink24), revision: 5, previewToken: t });
  const preview = await visit(browser, `${WEB}/learn/preview/${t}`, {
    shotName: 'hostile-preview-link',
    then: async (page) => {
      await expect(page.locator('.learn-preview-bar')).toBeVisible();
    },
  });
  quiet(preview, 'preview link');
  expect(preview.text).toContain('KGCSHOWN');
});

test('the most hostile page the save accepts draws safely in the editor, with hostile saved sections', async ({ browser }) => {
  await resetLearn();
  await seedLibrary();
  const draft = withRawLink(FIXTURES.hostileValid);
  await fsSet('pageLayouts/learn', { draft, published: null, revision: 3, draftUpdatedAt: Date.now(), draftUpdatedBy: OWNER });
  const kinds = new Set(draft.sections.flatMap((s) => s.blocks.map((b) => b.kind)));
  expect(kinds.size).toBe(24);
  let clicked = 0;
  const editor = await visit(browser, '/content/learn-page', {
    as: OWNER,
    shotName: 'hostile-valid-editor',
    then: async (page) => {
      await page.waitForSelector('.le-root');
      await expect(page.getByText('This draft could not be read')).toHaveCount(0);
      // Select every block in turn, so each kind's settings panel draws its hostile values too.
      const blocks = page.locator('.le-pane-preview [data-block-id]');
      const n = await blocks.count();
      for (let i = 0; i < n; i++) {
        const b = blocks.nth(i);
        if (!(await b.isVisible())) continue;
        await b.scrollIntoViewIfNeeded();
        await b.click({ position: { x: 4, y: 4 }, force: true });
        clicked++;
      }
    },
  });
  quiet(editor, 'editor');
  expect(clicked).toBeGreaterThanOrEqual(24);
  expect(editor.text).toContain('KGCSHOWN');
});

test('Compare and History draw a hostile kept version, valid or not', async ({ browser }) => {
  await resetLearn();
  await seedLibrary();
  const raw = withRawLink(hostile(FIXTURES.sink24) as Page_);
  const valid = withRawLink(FIXTURES.hostileValid);
  await fsSet('pageLayouts/learn', { draft: structuredClone(FIXTURES.sink24), published: valid, revision: 6 });
  const now = Date.now();
  // Ids Firestore would make, so the editor reads them (T326 G2).
  await fsSet('pageLayouts/learn/versions/vHostileValid0000001', { content: valid, publishedAt: now, publishedBy: OWNER, note: MARKUP });
  await fsSet('pageLayouts/learn/versions/vHostileRaw000000002', { content: raw, publishedAt: now - 60_000, publishedBy: OWNER, note: MARKUP });

  for (const which of [0, 1]) {
    for (const item of ['Compare with a published version', 'History']) {
      const r = await visit(browser, '/content/learn-page', {
        as: OWNER,
        shotName: `hostile-${item.split(' ')[0].toLowerCase()}-${which ? 'raw' : 'valid'}`,
        textOf: '[role="dialog"]',
        then: async (page) => {
          await page.waitForSelector('.le-root');
          await page.getByRole('button', { name: 'More', exact: true }).click();
          await page.getByRole('menuitem', { name: item }).click();
          const dialog = page.locator('[role="dialog"]');
          await dialog.waitFor();
          if (item === 'History') await dialog.getByRole('option').nth(which).click();
          else await dialog.locator('select').first().selectOption({ index: which });
          await expect(dialog).toContainText('KGCSHOWN', { timeout: 15_000 });
          await expect(dialog).not.toContainText('no longer exists');
        },
      });
      quiet(r, `${item}, ${which ? 'raw' : 'valid'} version`);
      expect(r.text).toContain('KGCSHOWN');
    }
  }
});

/** One wrong value of each type: numbers out of every range, the other scalars, and the wrong containers. */
const WRONG: unknown[] = [1e16, -1, 0.5, true, null, '', 'not-a-thing', [1, 'a', null, {}], { a: { b: [1] } }];

/** Every place a value can be wrong: each key of the page, of a section, of each block, and of a block's first list item. */
function paths(sink: Page_): (string | number)[][] {
  const out: (string | number)[][] = [];
  for (const k of Object.keys(sink)) out.push([k]);
  out.push(['sections', 0]);
  for (const k of Object.keys(sink.sections[0])) if (k !== 'id') out.push(['sections', 0, k]);
  sink.sections.forEach((s, si) =>
    s.blocks.forEach((b, bi) => {
      out.push(['sections', si, 'blocks', bi]);
      for (const [k, v] of Object.entries(b)) {
        if (k === 'id') continue;
        out.push(['sections', si, 'blocks', bi, k]);
        if (Array.isArray(v) && v[0] && typeof v[0] === 'object') {
          for (const sub of Object.keys(v[0] as Json)) out.push(['sections', si, 'blocks', bi, k, 0, sub]);
        }
      }
    }),
  );
  return out;
}

test('a stored doc with any field of the wrong type still answers 200 on the preview link, www and the editor', async ({ browser }) => {
  await resetLearn();
  const sink = structuredClone(FIXTURES.sink24);
  const t = token();
  const all = paths(sink);
  const failures: string[] = [];
  // About 4,000 preview-link reads and five fresh www renders: longer than the file's limit.
  test.setTimeout(2_400_000);
  const started = Date.now();

  // Every field, every wrong type, through the preview link, which reads the stored draft on each request.
  for (const p of all) {
    for (const w of WRONG) {
      // Firestore cannot store an array directly inside an array, so no stored doc can hold that shape.
      if (Array.isArray(w) && typeof p[p.length - 1] === 'number') continue;
      await fsSet('pageLayouts/learn', { draft: setAt(sink, p, w) as Json, published: null, revision: 1, previewToken: t });
      const r = await fetch(`${WEB}/learn/preview/${t}`);
      if (r.status !== 200) failures.push(`${p.join('.')} = ${JSON.stringify(w).slice(0, 40)}: ${r.status}`);
    }
  }
  console.log(`[sweep] ${all.length} paths through the preview link in ${Math.round((Date.now() - started) / 1000)} s`);
  expect(failures, 'preview link').toEqual([]);

  // One doc per wrong type with every block field wrong at once, on www and in the editor. Each doc
  // carries its own page title, and /learn is read until it shows that title: a render that throws
  // leaves the cached page (and its old title) in place, so it shows up here as a failure (T326 G7).
  for (const [i, w] of ([1e16, null, 'not-a-thing', [1, 'a', null, {}], { a: { b: [1] } }] as unknown[]).entries()) {
    // Every block wrong at once leaves nothing www can draw, so it would fall back to the built-in page;
    // one untouched section after them carries the title and keeps the page its own.
    const title = `Sweep ${i} ${Date.now()}`;
    const marker = { ...structuredClone(sink.sections[0]), id: 'sweep-marker', anchor: 'sweep-marker', blocks: [{ id: 'sweep-h', kind: 'heading', text: title, level: 2 }] };
    let page: unknown = { ...sink, seoTitle: title, sections: [...sink.sections, marker] };
    for (const p of all) if (p.length > 4) page = setAt(page, p, w);
    await fsSet('pageLayouts/learn', { draft: page as Json, published: page as Json, revision: 2, previewToken: t, marker: title });
    const deadline = Date.now() + 60_000;
    let fresh = false;
    while (!fresh && Date.now() < deadline) {
      const r = await fetch(`${WEB}/learn`);
      if (r.status !== 200) failures.push(`www /learn, every field ${JSON.stringify(w)}: ${r.status}`);
      fresh = (await r.text()).includes(title);
      if (!fresh) await new Promise((res) => setTimeout(res, 2000));
    }
    if (!fresh) failures.push(`www /learn, every field ${JSON.stringify(w)}: never drew the new doc (a render error keeps the old page)`);
    console.log(`[sweep] www ${JSON.stringify(w)} fresh=${fresh} at ${Math.round((Date.now() - started) / 1000)} s`);
    const ed = await visit(browser, '/content/learn-page', { as: OWNER });
    if (ed.errors.length) failures.push(`editor, every field ${JSON.stringify(w)}: ${ed.errors.join(' | ').slice(0, 300)}`);
    if (/Application error|Internal Server Error/.test(ed.text)) failures.push(`editor, every field ${JSON.stringify(w)}: error page`);
  }
  expect(failures, 'www and editor').toEqual([]);
});
