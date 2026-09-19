// Usage: node shot.mjs <dash|web|app> <outDir> <width> <path> [<path>...]
// Writes <outDir>/<slug>-<width>.png (full page, capped) and <outDir>/metrics-<width>.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ORIGINS = {
  dash: 'https://kgc27-dashboard.netlify.app',
  web: 'https://kgc27-website.netlify.app',
  app: 'https://kgc27-app.netlify.app',
};
const [site, outDir, widthArg, ...paths] = process.argv.slice(2);
const width = Number(widthArg);
const origin = ORIGINS[site];
if (!origin || !width || !paths.length) {
  console.error('usage: node shot.mjs <dash|web|app> <outDir> <width> <path>...');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const mobile = width < 700;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: { width, height: mobile ? 844 : 900 },
  deviceScaleFactor: 1,
  isMobile: mobile,
  hasTouch: mobile,
  userAgent: mobile
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    : undefined,
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));

if (site === 'dash') {
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name=email]', 'demo@knowledgegraph.tech');
  await page.fill('input[name=passphrase]', 'kgc2027');
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type=submit]')]);
}

const results = [];
for (const p of paths) {
  const slug = (p.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '_') || 'home');
  const entry = { path: p, slug, shot: path.join(outDir, `${slug}-${width}.png`) };
  consoleErrors.length = 0;
  try {
    const resp = await page.goto(origin + p, { waitUntil: 'networkidle', timeout: 45000 }).catch(async () =>
      page.goto(origin + p, { waitUntil: 'domcontentloaded', timeout: 45000 }));
    entry.status = resp ? resp.status() : null;
    entry.finalUrl = page.url().replace(origin, '');
    await page.waitForTimeout(800);
    entry.metrics = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const sel = (el) => {
        const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (c ? '.' + c : '');
      };
      const txt = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = getComputedStyle(el);
        return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
      };
      const all = [...document.body.querySelectorAll('*')].filter(visible);
      // an element inside a horizontally scrollable ancestor is allowed to be wide
      const inScroller = (el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if ((ox === 'auto' || ox === 'scroll') && a.scrollWidth > a.clientWidth) return true;
        }
        return false;
      };
      const overflowing = all
        .filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 2 || r.left < -2; })
        .filter((el) => !inScroller(el))
        .slice(0, 12)
        .map((el) => { const r = el.getBoundingClientRect(); return { el: sel(el), left: Math.round(r.left), right: Math.round(r.right), text: txt(el) }; });
      const tappable = all.filter((el) => el.matches('a[href],button,[role=button],input:not([type=hidden]),select,textarea,[onclick]'));
      const smallTaps = tappable
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width < 32 || r.height < 32; })
        .slice(0, 15)
        .map((el) => { const r = el.getBoundingClientRect(); return { el: sel(el), w: Math.round(r.width), h: Math.round(r.height), text: txt(el) }; });
      const leafText = all.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1));
      const tinyText = leafText
        .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12)
        .slice(0, 10)
        .map((el) => ({ el: sel(el), px: parseFloat(getComputedStyle(el).fontSize), text: txt(el) }));
      const clipped = leafText
        .filter((el) => { const s = getComputedStyle(el); return (s.overflow === 'hidden' || s.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1; })
        .slice(0, 10)
        .map((el) => ({ el: sel(el), text: txt(el) }));
      const words = (document.body.innerText || '').trim().split(/\s+/).filter(Boolean).length;
      const brokenImgs = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.slice(0, 120)).slice(0, 8);
      return {
        viewportWidth: vw,
        docScrollWidth: document.documentElement.scrollWidth,
        horizontalScroll: document.documentElement.scrollWidth > vw + 1,
        pageHeight: document.documentElement.scrollHeight,
        words,
        emDashes: ((document.body.innerText || '').match(/—/g) || []).length,
        overflowing, smallTaps, tinyText, clipped, brokenImgs,
        title: document.title,
        h1: [...document.querySelectorAll('h1')].map((h) => h.innerText.trim().slice(0, 80)).slice(0, 3),
      };
    });
    entry.consoleErrors = [...new Set(consoleErrors)].slice(0, 6);
    const h = Math.min(entry.metrics.pageHeight, mobile ? 5000 : 3000);
    await page.screenshot({ path: entry.shot, fullPage: false, clip: { x: 0, y: 0, width, height: Math.max(h, 400) } }).catch(async () => {
      await page.screenshot({ path: entry.shot });
    });
  } catch (e) {
    entry.error = String(e).slice(0, 300);
  }
  results.push(entry);
  console.log(`${entry.status ?? 'ERR'} ${p}${entry.metrics?.horizontalScroll ? '  [H-SCROLL]' : ''}${entry.error ? '  ' + entry.error : ''}`);
}
fs.writeFileSync(path.join(outDir, `metrics-${width}.json`), JSON.stringify(results, null, 1));
await browser.close();
