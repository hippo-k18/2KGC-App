/**
 * Captures our pages and pairs each with its live reference plate.
 *
 *   node scripts/compare-pages.mjs            # every page
 *   node scripts/compare-pages.mjs tickets    # one
 *
 * Writes our shots to `<out>/ours/` and leaves the composing to
 * `compose-pages.py`, which stitches each pair into one side-by-side image.
 *
 * This is the third tool in the set and it answers the question the other two
 * cannot. The overlay is for judging one page by eye; `diff-styles.mjs` is for
 * type sizes and colours. Neither shows *composition* — a section the live page
 * has and we do not, a band that is white where theirs is navy, a photograph
 * where we have a list. Those only show up when the two full pages are next to
 * each other.
 *
 * The capture settings are deliberately identical to `capture-reference.mjs`
 * (1440 wide, DPR 1, scrolled to load lazily, sticky elements neutralised) —
 * if they drift, the two halves of every comparison stop being comparable.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const puppeteer = (() => {
  for (const id of [
    '/Users/hartigan/.claude/plugins/cache/claude-plugins-official/chrome-devtools-mcp/1.7.0/node_modules/puppeteer-core',
    'puppeteer-core',
  ]) {
    try {
      return require(id);
    } catch {
      /* next */
    }
  }
  throw new Error('puppeteer-core not found');
})();

const OURS = process.env.WEB_ORIGIN ?? 'http://localhost:3210';
const OUT = process.env.COMPARE_OUT ?? join(HERE, '..', '..', '..', '.compare');
const WIDTH = 1440;

/** Our route per plate name. Mirrors `PAGES` in `capture-reference.mjs`. */
const ROUTES = {
  home: '/',
  speakers: '/speakers',
  about: '/about',
  team: '/team',
  community: '/community',
  hcls: '/hcls',
  tickets: '/tickets',
  blog: '/blog',
  learn: '/learn',
  agenda: '/agenda',
  awards: '/kgc-lifetime-achievement-awards',
};

async function prepare(page) {
  await page.evaluate(async () => {
    const h = () => document.documentElement.scrollHeight;
    for (let y = 0; y < h(); y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach((el) => {
      const c = getComputedStyle(el);
      if (c.position === 'fixed' || c.position === 'sticky')
        el.style.setProperty('position', 'static', 'important');
    });
    // Our own consent banner and the dev overlay's toggle are not the design.
    for (const sel of ['[class*=cookie]', '[id*=cookie]', '[class*=consent]']) {
      document.querySelectorAll(sel).forEach((e) => e.remove());
    }
    [...document.querySelectorAll('button')]
      .filter((b) => /Overlay live site/.test(b.textContent || ''))
      .forEach((b) => b.remove());
  });
  await new Promise((r) => setTimeout(r, 500));
}

const only = process.argv[2];
const wanted = only ? { [only]: ROUTES[only] } : ROUTES;
if (only && !ROUTES[only]) {
  console.error(`Unknown page "${only}". Known: ${Object.keys(ROUTES).join(', ')}`);
  process.exit(1);
}

await mkdir(join(OUT, 'ours'), { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome' });

for (const [name, route] of Object.entries(wanted)) {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: 1 });
  try {
    await page.goto(OURS + route, { waitUntil: 'networkidle2', timeout: 90_000 });
    await prepare(page);
    const file = join(OUT, 'ours', `${name}-${WIDTH}.webp`);
    await page.screenshot({ path: file, fullPage: true, type: 'webp', quality: 82 });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`ok    ${name.padEnd(10)} ${WIDTH}x${height}  <- ${route}`);
  } catch (err) {
    console.error(`FAIL  ${name.padEnd(10)} ${err.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();
