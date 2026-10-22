import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { OWNER } from './people';
import { WEB, fsDelete, fsList, fsSet, shot, signedIn, watch } from './helpers';

/**
 * What a Learn page document written straight to Firestore can do (T325).
 *
 * The save and publish actions validate everything, but the website, the
 * preview link and the editor all read whatever is stored. So a stored doc
 * full of hostile values must draw as plain text with no script, inline
 * handler, unsafe link, foreign image or injected style; and a doc with any
 * field of the wrong type must still answer 200, never an error page.
 *
 * Every hostile value points at `evil.test` or sets `window.__kgcCanary`,
 * so the checks only have to look for those two.
 */

type Json = Record<string, unknown>;
type Section = { blocks: Json[] } & Json;
type Page_ = { sections: Section[] } & Json;

const FIXTURES = JSON.parse(readFileSync(path.join(__dirname, '.fixtures.json'), 'utf8')) as { sink: Page_ };

const CANARY = 'window.__kgcCanary=1';
const UNSAFE_LINKS = [
  `javascript:${CANARY}`,
  ` JaVaScRiPt:${CANARY}`,
  `\u0001javascript:${CANARY}`,
  'data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19rZ2NDYW5hcnk9MTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'https:/\\evil.test/a',
  'https:\\\\evil.test/b',
  '\\\\evil.test/c',
  '//evil.test/d',
  '\u0001https://evil.test/e',
  'https://evil.test/f',
];
const UNSAFE_IMAGES = ['https://evil.test/x.png', 'http://evil.test/y.png', '//evil.test/z.png', `javascript:${CANARY}`, 'data:image/svg+xml,<svg onload="window.__kgcCanary=1"/>'];
const MARKUP = `<img src="https://evil.test/i.png" onerror="${CANARY}"><script>${CANARY}</script><style>body{background:url(https://evil.test/s)}</style> KGCSHOWN`;
const CSS = 'red;background-image:url(https://evil.test/css)';

const LINK_KEY = /href|url|link|linkedin|website|action/i;
const IMAGE_KEY = /src|image|photo|logo|avatar|poster|background(image)?$/i;
const STYLE_KEY = /colou?r|tone|highlight|width|height|padding|align|size|style/i;

/** Every string in the page swapped for a hostile one picked by its key; rich text also gets hostile nodes and marks. */
function hostile(v: unknown, key = '', n = { i: 0 }): unknown {
  if (Array.isArray(v)) return v.map((x) => hostile(x, key, n));
  if (v && typeof v === 'object') {
    const o = v as Json;
    const out: Json = {};
    for (const [k, x] of Object.entries(o)) out[k] = k === 'id' || k === 'kind' || k === 'type' ? x : hostile(x, k, n);
    if (o.type === 'doc' && Array.isArray(o.content)) {
      out.content = [
        ...(out.content as unknown[]),
        {
          type: 'paragraph',
          attrs: { style: `background:url(https://evil.test/p)`, onclick: CANARY, class: 'x" onmouseover="' + CANARY },
          content: UNSAFE_LINKS.map((href) => ({
            type: 'text',
            text: `link ${href.length} KGCSHOWN `,
            marks: [
              { type: 'link', attrs: { href, target: '_blank', onclick: CANARY, rel: 'opener' } },
              { type: 'textStyle', attrs: { color: CSS, fontSize: CSS } },
              { type: 'highlight', attrs: { color: CSS } },
            ],
          })),
        },
        { type: 'image', attrs: { src: 'https://evil.test/rich.png', onerror: CANARY } },
        { type: 'iframe', attrs: { src: 'https://evil.test/frame' } },
        { type: 'heading', attrs: { level: 2, id: `"><img src=x onerror=${CANARY}>` }, content: [{ type: 'text', text: MARKUP }] },
      ];
    }
    return out;
  }
  if (typeof v !== 'string') return v;
  n.i++;
  if (key === 'id' || key === 'kind') return v;
  if (LINK_KEY.test(key)) return UNSAFE_LINKS[n.i % UNSAFE_LINKS.length];
  if (IMAGE_KEY.test(key)) return UNSAFE_IMAGES[n.i % UNSAFE_IMAGES.length];
  if (STYLE_KEY.test(key)) return CSS;
  if (/anchor|slug/i.test(key)) return `"><img src=x onerror=${CANARY}>`;
  return MARKUP;
}

const token = () => randomBytes(32).toString('base64url');

async function resetLearn() {
  for (const sub of ['versions', 'library', 'media']) {
    for (const d of await fsList(`pageLayouts/learn/${sub}`)) await fsDelete(`pageLayouts/learn/${sub}/${d.id}`);
  }
  await fsDelete('pageLayouts/learn');
}

/** Everything the page says about itself that would mean the hostile doc got through. */
async function leaks(page: Page): Promise<string[]> {
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    if (/evil\.test|^javascript:|^data:/i.test(f.url())) return [`frame ${f.url()}`];
  }
  return page.evaluate(() => {
    const out: string[] = [];
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
        if (['href', 'src', 'srcset', 'action', 'formaction', 'poster', 'xlink:href', 'data'].includes(name) && bad(a.value)) {
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
  });
}

/** Opens a page, collects dialogs and errors, and returns what leaked. */
async function visit(browser: Browser, url: string, opts: { as?: string; then?: (p: Page) => Promise<void>; shotName?: string } = {}) {
  const ctx = opts.as ? await signedIn(browser, opts.as) : await browser.newContext();
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('kgc-learn-tour-v2', '1');
    } catch {}
  });
  const page = await ctx.newPage();
  const errors = watch(page);
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
  const found = await leaks(page);
  if (opts.shotName) await shot(page, opts.shotName, { fullPage: true });
  const text = await page.locator('body').innerText();
  await ctx.close();
  return { found, errors: errors.filter((e) => !/evil\.test|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL|net::/.test(e)), dialogs, text };
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000);

test('a stored doc full of hostile values draws safely on www, the preview link and in the editor', async ({ browser }) => {
  await resetLearn();
  const bad = hostile(FIXTURES.sink) as Page_;
  const t = token();
  // The draft stays valid so the editor opens; published, the kept version and the preview link carry the hostile page.
  await fsSet('pageLayouts/learn', {
    draft: structuredClone(FIXTURES.sink),
    published: bad,
    revision: 4,
    draftUpdatedAt: Date.now(),
    draftUpdatedBy: OWNER,
    previewToken: t,
  });
  await fsSet('pageLayouts/learn/versions/v-hostile', { content: bad, publishedAt: Date.now(), publishedBy: OWNER, note: MARKUP });

  // The website caches /learn for a few seconds; read it until it has caught up with the hostile copy.
  await expect
    .poll(async () => (await (await fetch(`${WEB}/learn`)).text()).includes('KGCSHOWN'), { timeout: 90_000, intervals: [2000] })
    .toBe(true);
  const www = await visit(browser, `${WEB}/learn`, { shotName: 'hostile-www' });
  expect(www.found, 'www /learn').toEqual([]);
  expect(www.errors, 'www /learn').toEqual([]);
  expect(www.dialogs).toEqual([]);
  expect(www.text).toContain('KGCSHOWN');

  // Now the hostile page as the draft, behind the preview link.
  await fsSet('pageLayouts/learn', { draft: bad, published: structuredClone(FIXTURES.sink), revision: 5, previewToken: t });
  const preview = await visit(browser, `${WEB}/learn/preview/${t}`, { shotName: 'hostile-preview-link' });
  expect(preview.found, 'preview link').toEqual([]);
  expect(preview.errors, 'preview link').toEqual([]);
  expect(preview.dialogs).toEqual([]);

  // The editor with the hostile draft: either the draft draws safely or it says it cannot be read.
  const editor = await visit(browser, '/content/learn-page', { as: OWNER, shotName: 'hostile-editor' });
  expect(editor.found, 'editor').toEqual([]);
  expect(editor.errors, 'editor').toEqual([]);
  expect(editor.dialogs).toEqual([]);

  // Compare and History draw the hostile kept version.
  await fsSet('pageLayouts/learn', { draft: structuredClone(FIXTURES.sink), published: bad, revision: 6 });
  for (const item of ['Compare with a published version', 'History']) {
    const r = await visit(browser, '/content/learn-page', {
      as: OWNER,
      shotName: `hostile-${item.split(' ')[0].toLowerCase()}`,
      then: async (page) => {
        await page.waitForSelector('.le-root');
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: item }).click();
        await page.waitForSelector('[role="dialog"]');
        const option = page.locator('[role="dialog"] [role="option"]').first();
        if (await option.count()) await option.click();
        await page.waitForTimeout(1500);
      },
    });
    expect(r.found, item).toEqual([]);
    expect(r.errors, item).toEqual([]);
    expect(r.dialogs, item).toEqual([]);
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

function setAt(root: unknown, p: (string | number)[], value: unknown): unknown {
  const copy = structuredClone(root) as Json;
  let cur = copy as Record<string | number, unknown>;
  for (const k of p.slice(0, -1)) {
    // A parent already set to a wrong value has nothing left to reach into.
    if (!cur[k] || typeof cur[k] !== 'object') return copy;
    cur = cur[k] as Record<string | number, unknown>;
  }
  cur[p[p.length - 1]] = value;
  return copy;
}

test('a stored doc with any field of the wrong type still answers 200 on the preview link, www and the editor', async ({ browser }) => {
  await resetLearn();
  const sink = structuredClone(FIXTURES.sink);
  const t = token();
  const all = paths(sink);
  const failures: string[] = [];

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
  expect(failures, 'preview link').toEqual([]);

  // One doc per wrong type with every block field wrong at once, on www and in the editor.
  for (const w of [1e16, null, 'not-a-thing', [1, 'a', null, {}], { a: { b: [1] } }]) {
    let page: unknown = sink;
    for (const p of all) if (p.length > 4) page = setAt(page, p, w);
    await fsSet('pageLayouts/learn', { draft: page as Json, published: page as Json, revision: 2, previewToken: t, marker: Date.now() });
    // Wait out the website's cache so the next read is a fresh render of this doc.
    await new Promise((r) => setTimeout(r, 16_000));
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${WEB}/learn`);
      if (r.status !== 200) failures.push(`www /learn, every field ${JSON.stringify(w)}: ${r.status}`);
      await new Promise((res) => setTimeout(res, 1500));
    }
    const ed = await visit(browser, '/content/learn-page', { as: OWNER });
    if (ed.errors.length) failures.push(`editor, every field ${JSON.stringify(w)}: ${ed.errors.join(' | ').slice(0, 300)}`);
    if (/Application error|Internal Server Error/.test(ed.text)) failures.push(`editor, every field ${JSON.stringify(w)}: error page`);
  }
  expect(failures, 'www and editor').toEqual([]);
});
