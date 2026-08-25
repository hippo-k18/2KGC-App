/**
 * Compares our rendered pages against the live site, property by property.
 *
 *   node scripts/diff-styles.mjs                 # every page with a plate
 *   node scripts/diff-styles.mjs speakers        # one page
 *
 * The overlay in `reference-overlay.tsx` is the tool for judging spacing and
 * alignment by eye. This is its counterpart for the things an eye is bad at: a
 * 2px type size, a weight one step off, a colour that is nearly right. Those are
 * what made the site read as wrong while every individual page looked fine, and
 * they do not survive being measured.
 *
 * It compares *semantic anchors* rather than trying to pair up elements between
 * two completely different DOMs — the live site is WordPress and Elementor, ours
 * is React, and there is no correspondence between their markup. What both have
 * is a first `h1`, a body paragraph, a nav link. Those are comparable; their
 * `div` trees are not.
 *
 * Needs the dev server running on 3210. Live pages are fetched fresh, so this is
 * also the check for the live site having changed under us.
 */
import { createRequire } from 'node:module';

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
const LIVE = 'https://www.knowledgegraph.tech';
const WIDTH = 1440;

const PAGES = {
  home: ['/', `${LIVE}/`],
  speakers: ['/speakers', `${LIVE}/2026-speakers/`],
  about: ['/about', `${LIVE}/about-kgc/`],
  team: ['/team', `${LIVE}/team/`],
  community: ['/community', `${LIVE}/community/`],
  hcls: ['/hcls', `${LIVE}/hcls/`],
  tickets: ['/tickets', `${LIVE}/tickets/`],
  blog: ['/blog', `${LIVE}/blog/`],
  learn: ['/learn', `${LIVE}/knowledge-graph-learning-program/`],
  agenda: ['/agenda', `${LIVE}/agenda/`],
  awards: ['/kgc-lifetime-achievement-awards', `${LIVE}/kgc-lifetime-achievement-awards/`],
};

/**
 * Runs in the page. Returns one record per anchor.
 *
 * `body` deliberately samples the *longest* paragraph rather than the first:
 * the first is often a one-line eyebrow or a widget label styled unlike the
 * page's actual copy, and it is the copy we care about.
 */
const PROBE = () => {
  const read = (el) => {
    if (!el) return null;
    const c = getComputedStyle(el);
    return {
      /*
       * The element's own text, so a mismatch can be checked rather than
       * trusted. Without it there is no way to tell a real difference from the
       * probe having picked two unrelated elements — which it often does, because
       * the two DOMs have nothing in common. Reported, never compared.
       */
      _text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 42),
      fontSize: c.fontSize,
      fontWeight: c.fontWeight,
      fontStyle: c.fontStyle,
      lineHeight: c.lineHeight,
      fontFamily: c.fontFamily.replace(/["']/g, '').split(',')[0].trim(),
      color: c.color,
      textTransform: c.textTransform,
      letterSpacing: c.letterSpacing,
    };
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  const longestText = (sel, min) =>
    [...document.querySelectorAll(sel)]
      .filter((e) => visible(e) && (e.textContent || '').trim().length >= min)
      .sort((a, b) => b.textContent.trim().length - a.textContent.trim().length)[0] ?? null;

  const firstVisible = (sel) => [...document.querySelectorAll(sel)].find(visible) ?? null;

  const bodyEl = document.body;
  const bodyCs = getComputedStyle(bodyEl);

  return {
    page: { backgroundColor: bodyCs.backgroundColor, ...read(bodyEl) },
    h1: read(firstVisible('h1')),
    h2: read(firstVisible('h2')),
    h3: read(firstVisible('h3')),
    paragraph: read(longestText('p', 120)),
    navLink: read(firstVisible('header nav a, .site-header nav a')),
    link: read(longestText('main a, article a, .entry-content a', 3)),
  };
};

async function probe(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: 1 });
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90_000 });
    await new Promise((r) => setTimeout(r, 1200));
    return await page.evaluate(PROBE);
  } finally {
    await page.close();
  }
}

const only = process.argv[2];
const wanted = only ? { [only]: PAGES[only] } : PAGES;
if (only && !PAGES[only]) {
  console.error(`Unknown page "${only}". Known: ${Object.keys(PAGES).join(', ')}`);
  process.exit(1);
}

const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome' });
let total = 0;

for (const [name, [ourPath, liveUrl]] of Object.entries(wanted)) {
  let ours, live;
  try {
    [ours, live] = await Promise.all([probe(browser, OURS + ourPath), probe(browser, liveUrl)]);
  } catch (err) {
    console.log(`\n## ${name}\n  SKIPPED — ${err.message}`);
    continue;
  }

  const lines = [];
  for (const anchor of Object.keys(live)) {
    const l = live[anchor];
    const o = ours[anchor];
    if (!l) continue;
    if (!o) {
      lines.push(`  ${anchor.padEnd(11)} MISSING on ours (live has one)`);
      continue;
    }
    const props = [];
    for (const prop of Object.keys(l)) {
      if (prop.startsWith('_')) continue;
      if (l[prop] === undefined || o[prop] === undefined) continue;
      if (String(l[prop]) !== String(o[prop]))
        props.push(`  ${anchor.padEnd(11)} ${prop.padEnd(14)} live ${String(l[prop]).padEnd(24)} ours ${o[prop]}`);
    }
    if (props.length) {
      // Show what was actually compared, once, above that anchor's differences.
      lines.push(`  ${anchor.padEnd(11)} ${'~'.padEnd(14)} live "${l._text}"  |  ours "${o._text}"`);
      lines.push(...props);
    }
  }

  total += lines.length;
  console.log(`\n## ${name}  (${lines.length} mismatches)`);
  console.log(lines.length ? lines.join('\n') : '  no mismatches');
}

console.log(`\nTOTAL: ${total} mismatches`);
await browser.close();
