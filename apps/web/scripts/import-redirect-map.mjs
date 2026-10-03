#!/usr/bin/env node
/**
 * Turns the SEO review's redirect-map.csv into src/lib/old-content-redirects.json,
 * the exact-address table the middleware checks first (see src/lib/old-site.ts).
 *
 *   node scripts/import-redirect-map.mjs path/to/redirect-map.csv          # writes
 *   node scripts/import-redirect-map.mjs path/to/redirect-map.csv --check  # prints, writes nothing
 *
 * Takes the rows whose `action` is CHANGE, FIX-CHAIN or ADD and whose
 * `recommended_target` is set. Skips:
 *   - the past-speaker addresses (/blog/speakers/<slug>/, the four speaker year
 *     pages, /blog/speakers-category/<year>/): `pastSpeakerTarget` in
 *     src/lib/old-site.ts owns them and is checked first anyway;
 *   - rows the archive patterns or the feed rule in old-site.ts already send to
 *     the same place (a different CSV target is imported, and reported);
 *   - addresses this site serves itself (/blog, /tickets, ...): an old-address
 *     redirect must never shadow a live page;
 *   - rule rows that are not a single path (wildcards, the media folder, which
 *     Apache serves; see the T044 cutover runbook).
 * Rewrites:
 *   - a speaker category for one year's subset (/blog/speakers-category/2022-keynote/
 *     and the like) goes to that year's list, /past-speakers?year=2022, which holds
 *     everyone in it, rather than to an archive listing or the events hub;
 *   - a target on www.knowledgegraph.tech becomes a relative path, so it is one
 *     hop on whichever host the site answers (staging today, www after cutover);
 *   - an archive target gets the trailing slash the archive serves without a
 *     second redirect.
 * Paths are stored without their trailing slash, which is how old-site.ts looks
 * them up.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , file, flag] = process.argv;
if (!file) {
  console.error('usage: node scripts/import-redirect-map.mjs <redirect-map.csv> [--check]');
  process.exit(1);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'old-content-redirects.json');
const ARCHIVE = 'https://archive.knowledgegraph.tech';
const ARCHIVED_SECTIONS = ['/blog/agenda/', '/blog/partners/', '/blog/portfolio/'];
const PAST_SPEAKERS = [/^\/blog\/speakers(\/|$)/, /^\/blog\/speakers-category\/\d{4}(\/page\/\d+)?$/, /^\/conference-2019\/speakers$/, /^\/speakers-2021$/, /^\/speakers-2022-page$/, /^\/kgc-2023-speakers$/];
const YEAR_SUBSET = /^\/blog\/speakers-category\/(\d{4})-[^/]+$/;
const WWW = /^https:\/\/(www\.)?knowledgegraph\.tech(?=\/|$)/;
// The blog is `/blog` on the main site; the middleware sends it on to the blog
// host while `BLOG_ORIGIN` gives it one. No target names the blog host itself.
const BLOG = /^https:\/\/blog\.knowledgegraph\.tech(?=\/|$)/;
/** Top-level routes of this site (src/app), whose own address must not be redirected. */
const LIVE = new Set(readdirSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app')).filter((n) => !n.includes('.') && !n.startsWith('[')).map((n) => `/${n}`));

/** RFC 4180 enough for a spreadsheet export: quoted fields, doubled quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

const [head, ...rows] = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const col = (re) => head.findIndex((h) => re.test(h.trim()));
const iPath = [col(/^(old_?)?(url|path)$/i), col(/url|path/i), 0].find((i) => i >= 0);
const iAction = col(/^action$/i);
const iTarget = col(/^recommended_target$/i);
if (iAction < 0 || iTarget < 0) {
  console.error(`expected "action" and "recommended_target" columns; got: ${head.join(', ')}`);
  process.exit(1);
}

const out = {};
const skipped = { pastSpeakers: 0, pattern: 0, feedPattern: 0, liveRoute: 0, rule: 0, noTarget: 0, otherAction: 0 };
const rewritten = [];
const live = [];
for (const r of rows) {
  const action = (r[iAction] ?? '').trim().toUpperCase();
  if (!['CHANGE', 'FIX-CHAIN', 'ADD'].includes(action)) { skipped.otherAction++; continue; }
  let path = (r[iPath] ?? '').trim();
  const target = (r[iTarget] ?? '').trim();
  if (!target) { skipped.noTarget++; continue; }
  try { if (/^https?:/.test(path)) path = new URL(path).pathname; } catch {}
  if (!path.startsWith('/') || /[*?]/.test(path) || path.startsWith('/wp-content/')) { skipped.rule++; continue; }
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (PAST_SPEAKERS.some((re) => re.test(p))) { skipped.pastSpeakers++; continue; }
  if (LIVE.has(p) || p === '/') { skipped.liveRoute++; live.push(`${p} (CSV: ${target})`); continue; }
  if (ARCHIVED_SECTIONS.some((s) => (p + '/').startsWith(s) && p + '/' !== s)) {
    if (target.replace(/\/?$/, '/') === `${ARCHIVE}${p}/`) { skipped.pattern++; continue; }
    console.log(`  ! pattern mismatch, importing the CSV target: ${p} -> ${target}`);
  }
  if ((p === '/feed' || p === '/blog/feed') && /\/feed\.xml$/.test(target)) { skipped.feedPattern++; continue; }
  const year = YEAR_SUBSET.exec(p);
  let to = target;
  if (year) { to = `/past-speakers?year=${year[1]}`; rewritten.push(`${p}: ${target} -> ${to}`); }
  else if (WWW.test(to)) to = to.replace(WWW, '') || '/';
  else if (BLOG.test(to)) to = `/blog${to.replace(BLOG, '').replace(/^\/$/, '')}`;
  else if (to.startsWith(ARCHIVE)) to = to.replace(/\/?$/, '/');
  out[p] = to;
}

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
console.log(`${Object.keys(sorted).length} addresses; skipped ${JSON.stringify(skipped)}`);
for (const r of rewritten) console.log(`  rewritten ${r}`);
for (const r of live) console.log(`  live route kept: ${r}`);
if (flag === '--check') {
  for (const [k, v] of Object.entries(sorted)) console.log(`  ${k} -> ${v}`);
} else {
  writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`wrote ${OUT}`);
}
