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
 *   - speaker addresses (/blog/speakers*, the speaker year pages): they move
 *     onto this site in T040, which owns their redirects;
 *   - rows the archive patterns in old-site.ts already send to the same place;
 *   - rule rows that are not a single path (wildcards, the media folder).
 * Paths are stored without their trailing slash, which is how old-site.ts looks
 * them up. Targets are written as given, so an archive target should carry the
 * trailing slash the archive serves without a second redirect.
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
const SPEAKERS = [/^\/blog\/speakers(-category)?(\/|$)/, /^\/conference-2019\/speakers(\/|$)/, /^\/speakers-2021(\/|$)/, /^\/speakers-2022-page(\/|$)/, /^\/kgc-2023-speakers(\/|$)/, /^\/2026-speakers(\/|$)/, /^\/speakers(\/|$)/];

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
const skipped = { speakers: 0, pattern: 0, rule: 0, noTarget: 0, otherAction: 0 };
for (const r of rows) {
  const action = (r[iAction] ?? '').trim().toUpperCase();
  if (!['CHANGE', 'FIX-CHAIN', 'ADD'].includes(action)) { skipped.otherAction++; continue; }
  let path = (r[iPath] ?? '').trim();
  const target = (r[iTarget] ?? '').trim();
  if (!target) { skipped.noTarget++; continue; }
  try { if (/^https?:/.test(path)) path = new URL(path).pathname; } catch {}
  if (!path.startsWith('/') || /[*?]/.test(path) || path.startsWith('/wp-content/')) { skipped.rule++; continue; }
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (SPEAKERS.some((re) => re.test(p))) { skipped.speakers++; continue; }
  if (ARCHIVED_SECTIONS.some((s) => (p + '/').startsWith(s) && p + '/' !== s) && target.replace(/\/?$/, '/') === `${ARCHIVE}${p}/`) { skipped.pattern++; continue; }
  out[p] = target;
}

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
console.log(`${Object.keys(sorted).length} addresses; skipped ${JSON.stringify(skipped)}`);
if (flag === '--check') {
  for (const [k, v] of Object.entries(sorted)) console.log(`  ${k} -> ${v}`);
} else {
  writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`wrote ${OUT}`);
}
