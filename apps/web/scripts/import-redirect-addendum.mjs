#!/usr/bin/env node
/**
 * Turns the SEO review's redirect addendum (2026-10-07, T198) into
 * src/lib/old-site-addendum.json, the first table `oldSiteTarget` checks.
 *
 *   node scripts/import-redirect-addendum.mjs path/to/redirect-map-addendum.csv          # writes
 *   node scripts/import-redirect-addendum.mjs path/to/redirect-map-addendum.csv --check  # prints, writes nothing
 *
 * Columns: old_url, clicks_16m, impressions_16m, status_now, recommended_target,
 * reason. Every row is imported, as an exact address:
 *   - the key is the old path without its trailing slash (how old-site.ts looks
 *     paths up, so both forms match) and with its case as given;
 *   - a target on www.knowledgegraph.tech becomes a relative path, so it is one
 *     hop on whichever host answers; an archive target stays absolute;
 *   - a row whose old path is one of this site's own top-level routes is
 *     refused, because an old-address redirect must never shadow a live page.
 * It also reports a target that is itself a key here (a chain), and keys that
 * old-content-redirects.json already maps somewhere else (this table wins).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , file, flag] = process.argv;
if (!file) {
  console.error('usage: node scripts/import-redirect-addendum.mjs <addendum.csv> [--check]');
  process.exit(1);
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'lib', 'old-site-addendum.json');
const WWW = /^https:\/\/(www\.)?knowledgegraph\.tech(?=\/|$)/;
const LIVE = new Set(
  readdirSync(join(ROOT, 'src', 'app')).filter((n) => !n.includes('.') && !n.startsWith('[')).map((n) => `/${n}`),
);
const EXISTING = JSON.parse(readFileSync(join(ROOT, 'src', 'lib', 'old-content-redirects.json'), 'utf8'));

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
const iOld = head.indexOf('old_url');
const iTarget = head.indexOf('recommended_target');
if (iOld < 0 || iTarget < 0) {
  console.error(`expected old_url and recommended_target columns; got: ${head.join(', ')}`);
  process.exit(1);
}

const out = {};
const refused = [];
const overrides = [];
for (const r of rows) {
  const raw = r[iOld].trim();
  const target = r[iTarget].trim();
  if (!WWW.test(raw)) { refused.push(`${raw}: not a www address`); continue; }
  const path = raw.replace(WWW, '').replace(/\/+$/, '') || '/';
  if (!target) { refused.push(`${path}: no target`); continue; }
  if (LIVE.has(path) || path === '/') { refused.push(`${path}: a live route`); continue; }
  const to = WWW.test(target) ? target.replace(WWW, '') || '/' : target;
  if (EXISTING[path] && EXISTING[path] !== to) overrides.push(`${path}: ${EXISTING[path]} -> ${to}`);
  if (out[path] && out[path] !== to) refused.push(`${path}: listed twice with different targets`);
  out[path] = to;
}
const chains = Object.entries(out).filter(([, to]) => to.startsWith('/') && out[to.replace(/[?#].*$/, '').replace(/\/+$/, '')]);

console.log(`${rows.length} rows, ${Object.keys(out).length} addresses`);
for (const line of refused) console.log(`refused  ${line}`);
for (const line of overrides) console.log(`replaces ${line}`);
for (const [from, to] of chains) console.log(`chain    ${from} -> ${to}`);

if (flag !== '--check') {
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`wrote ${OUT}`);
}
