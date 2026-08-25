/**
 * Captures full-page screenshots of the live knowledgegraph.tech for the
 * development overlay in `src/components/reference-overlay.tsx`.
 *
 *   node scripts/capture-reference.mjs             # every page
 *   node scripts/capture-reference.mjs speakers    # one, by our route name
 *
 * Writes `public/reference/<name>-<width>.webp`.
 *
 * Three things here are not incidental and will silently produce a useless
 * plate if changed:
 *
 * **`deviceScaleFactor: 1`.** At 2, a page this tall exceeds Chrome's ~16384px
 * screenshot limit and `captureScreenshot` fails outright rather than degrading.
 *
 * **The scroll pass.** Everything below the fold is lazy loaded and photographs
 * as blank space unless it has been scrolled into view first.
 *
 * **Neutralising sticky and fixed elements.** A sticky header is re-composited
 * at every scroll position, so in a full-page capture it smears down the whole
 * plate. Setting it `static` photographs it once, where it belongs.
 *
 * `puppeteer-core` is resolved from the chrome-devtools-mcp plugin rather than
 * added as a dependency of this app: this is a one-off authoring tool, and the
 * website should not carry a browser automation library in its lockfile.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'public', 'reference');

const require = createRequire(import.meta.url);
const PUPPETEER_CANDIDATES = [
  '/Users/hartigan/.claude/plugins/cache/claude-plugins-official/chrome-devtools-mcp/1.7.0/node_modules/puppeteer-core',
  'puppeteer-core',
];

/** Our route → the live page it should be compared against. */
const PAGES = {
  home: { route: '/', live: 'https://www.knowledgegraph.tech/' },
  speakers: { route: '/speakers', live: 'https://www.knowledgegraph.tech/2026-speakers/' },
  about: { route: '/about', live: 'https://www.knowledgegraph.tech/about-kgc/' },
  team: { route: '/team', live: 'https://www.knowledgegraph.tech/team/' },
  community: { route: '/community', live: 'https://www.knowledgegraph.tech/community/' },
  hcls: { route: '/hcls', live: 'https://www.knowledgegraph.tech/hcls/' },
  tickets: { route: '/tickets', live: 'https://www.knowledgegraph.tech/tickets/' },
  blog: { route: '/blog', live: 'https://www.knowledgegraph.tech/blog/' },
  learn: {
    route: '/learn',
    live: 'https://www.knowledgegraph.tech/knowledge-graph-learning-program/',
  },
  agenda: { route: '/agenda', live: 'https://www.knowledgegraph.tech/agenda/' },
  awards: {
    route: '/kgc-lifetime-achievement-awards',
    live: 'https://www.knowledgegraph.tech/kgc-lifetime-achievement-awards/',
  },
};

const WIDTH = 1440;

async function loadPuppeteer() {
  for (const id of PUPPETEER_CANDIDATES) {
    try {
      return require(id);
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    'puppeteer-core not found. Install it, or point PUPPETEER_CANDIDATES at a copy —\n' +
      'the chrome-devtools-mcp plugin ships one.',
  );
}

async function prepare(page) {
  // Load everything below the fold, then return to the top.
  await page.evaluate(async () => {
    const h = () => document.documentElement.scrollHeight;
    for (let y = 0; y < h(); y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 1500));

  await page.evaluate(() => {
    document.querySelectorAll('*').forEach((el) => {
      const c = getComputedStyle(el);
      if (c.position === 'fixed' || c.position === 'sticky')
        el.style.setProperty('position', 'static', 'important');
      // Entrance animations that finish off-screen leave elements at opacity 0.
      if (parseFloat(c.opacity) === 0 && el.getBoundingClientRect().height > 0)
        el.style.setProperty('opacity', '1', 'important');
    });
    for (const sel of [
      '[id*=cookie]',
      '[class*=cookie]',
      '[id*=consent]',
      '[class*=consent]',
      '[id*=intercom]',
      '[class*=drift]',
      '[id*=livechat]',
    ]) {
      document.querySelectorAll(sel).forEach((e) => e.remove());
    }
  });
  await new Promise((r) => setTimeout(r, 600));
}

const only = process.argv[2];
const wanted = only ? { [only]: PAGES[only] } : PAGES;
if (only && !PAGES[only]) {
  console.error(`Unknown page "${only}". Known: ${Object.keys(PAGES).join(', ')}`);
  process.exit(1);
}

const puppeteer = await loadPuppeteer();
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  channel: 'chrome',
  args: [`--window-size=${WIDTH},900`],
});

let failures = 0;
for (const [name, { live }] of Object.entries(wanted)) {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: 1 });
  try {
    await page.goto(live, { waitUntil: 'networkidle2', timeout: 90_000 });
    await prepare(page);
    const file = join(OUT, `${name}-${WIDTH}.webp`);
    await page.screenshot({ path: file, fullPage: true, type: 'webp', quality: 82 });
    const { width, height } = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    console.log(`ok    ${name.padEnd(10)} ${width}x${height}  <- ${live}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name.padEnd(10)} ${err.message}  <- ${live}`);
  } finally {
    await page.close();
  }
}

await browser.close();
process.exit(failures ? 1 : 0);
