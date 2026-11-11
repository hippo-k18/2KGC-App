#!/usr/bin/env node
/**
 * Checks every row of the 2026-10-07 redirect addendum against a running site.
 *
 *   node scripts/verify-redirect-addendum.mjs <addendum.csv> <base-url> <results.csv>
 *
 * For each old address, as written (trailing slash) and without the slash:
 *   - exactly one hop: a 301 whose Location is the row's target (made relative
 *     to <base-url> when it is on www.knowledgegraph.tech);
 *   - the target answers 200 with no further redirect. A target on this site is
 *     fetched from <base-url>. One that Apache serves on the droplet
 *     (/wp-content/...) or that lives on the archive host is checked with a HEAD
 *     against the live host, because a local `next start` cannot serve it.
 * Writes one CSV row per address and exits non-zero if any fails.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , csvFile, base, outFile] = process.argv;
if (!csvFile || !base || !outFile) {
  console.error('usage: node scripts/verify-redirect-addendum.mjs <addendum.csv> <base-url> <results.csv>');
  process.exit(1);
}
const WWW = /^https:\/\/(www\.)?knowledgegraph\.tech(?=\/|$)/;
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

const [head, ...rows] = parseCsv(readFileSync(csvFile, 'utf8').replace(/^\uFEFF/, ''));
const iOld = head.indexOf('old_url');
const iTarget = head.indexOf('recommended_target');

const targetCache = new Map();
async function targetStatus(target) {
  if (targetCache.has(target)) return targetCache.get(target);
  const local = WWW.test(target) && !target.replace(WWW, '').startsWith('/wp-content/');
  const url = local ? base + target.replace(WWW, '') : target;
  const res = await fetch(url, { method: local ? 'GET' : 'HEAD', redirect: 'manual' });
  const r = { where: local ? 'local' : 'live', status: res.status, location: res.headers.get('location') ?? '' };
  targetCache.set(target, r);
  return r;
}

const out = [['old_url', 'variant', 'status', 'location', 'expected', 'hop_ok', 'target_checked', 'target_status', 'target_location', 'pass']];
let failures = 0;
for (const r of rows) {
  const old = r[iOld];
  const target = r[iTarget];
  const path = old.replace(WWW, '');
  const expected = WWW.test(target) ? target.replace(WWW, '') : target;
  const t = await targetStatus(target);
  const variants = [['as-listed', path]];
  const bare = path.replace(/\/+$/, '');
  if (bare !== path) variants.push(['no-slash', bare]);
  else variants.push(['with-slash', `${path}/`]);
  for (const [variant, p] of variants) {
    const res = await fetch(base + p, { redirect: 'manual' });
    const loc = res.headers.get('location') ?? '';
    const locRel = loc.startsWith(base) ? loc.slice(base.length) : loc.replace(WWW, '');
    const hopOk = res.status === 301 && locRel === expected;
    const pass = hopOk && t.status === 200;
    if (!pass) failures++;
    out.push([old, variant, res.status, loc, expected, hopOk, t.where, t.status, t.location, pass]);
  }
}
const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync(outFile, out.map((row) => row.map(esc).join(',')).join('\n') + '\n');
console.log(`${out.length - 1} checks, ${failures} failed; wrote ${outFile}`);
process.exit(failures ? 1 : 0);
