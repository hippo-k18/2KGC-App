#!/usr/bin/env node
/**
 * Brings the WordPress speaker export into the site: the data into
 * `src/content/past-speakers/` and the photos, cut to 400px squares in WebP,
 * into `public/kgc/past-speakers/`. See `src/lib/past-speakers.ts`.
 *
 *   node scripts/import-past-speakers.mjs <export dir>
 *
 * The export dir holds `speakers.json`, `years.json`, `redirects.json` and
 * `photos/`. Run from `apps/web`. It replaces what is there, so re-running it
 * on a fresh export is how the pages are updated.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const src = resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('usage: node scripts/import-past-speakers.mjs <export dir>');
  process.exit(1);
}

const OUT = resolve('src/content/past-speakers');
const PHOTOS = resolve('public/kgc/past-speakers');
/**
 * Square, because every place a photo appears is square. 480 covers the 200px
 * profile photo and the grid's widest card (about 230px) at twice the pixel
 * density. WebP only: every browser this site supports reads it.
 */
const SIZE = 480;

/**
 * Decisions made on the export (orchestrator, T040), applied here so a
 * re-import keeps them.
 *
 * Listed on the old 2023 speaker page but filed under 2022 only in WordPress.
 * They get both years, so they appear under both. Talk years stay as exported.
 */
const ALSO_2023 = [
  'fernando-aguilar', 'jennifer-dsouza', 'gautam-gupta', 'katariina-kari', 'malik-magdon-ismail',
  'holly-maykow', 'sara-nash', 'teodora-petkova', 'pete-rivett', 'andrea-volpini',
];

/** Media-library captions naming the photographer, shown wherever the photo is. */
const PHOTO_CREDITS = {
  'michael-cafarella': 'Photo: Somya Bhagwagar/Michigan Engineering, Communications & Marketing',
  'danai-koutra': 'Photo: Joseph Xu, Michigan Engineering Communications & Marketing',
  'nitesh-chawla': 'Photo by Matt Cashore/University of Notre Dame',
};

/**
 * gregor-wobbe's post body is WordPress annotation markup that was pasted in as
 * text, so the tags show as visible characters. This is the same bio with the
 * markup taken out and every real word kept. The first two lines ("UBS", "Head
 * of Data Architecture") and a "Biography" label repeat what the page already
 * shows above the bio, so they are not repeated. Applied only while the export
 * still has the broken text, which the check below confirms.
 */
const BIO_FIXES = {
  'gregor-wobbe': {
    broken: 'urn:enhancement-5f8e0b5d',
    bioHtml:
      '<p>Gregor Wobbe is Head of Data Architecture and Executive Director for UBS. Before joining UBS, Mr. Wobbe had held senior positions at JPMorgan Chase and Bank of America. His focus is on developing next generation data strategies that leverage knowledge graphs and machine intelligence technologies.<br>He lives with his wife and son in New York.</p>',
  },
};

const read = (f) => JSON.parse(readFileSync(join(src, f), 'utf8'));
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const noSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** The path and query, without a trailing slash on the path. Year lists are `/past-speakers?year=<y>`. */
const target = (to) => {
  const u = new URL(to, 'https://x');
  return `${noSlash(u.pathname)}${u.search}`;
};

mkdirSync(OUT, { recursive: true });
rmSync(PHOTOS, { recursive: true, force: true });
mkdirSync(PHOTOS, { recursive: true });

const speakers = [];
for (const s of read('speakers.json')) {
  let photo = null;
  if (s.photo) {
    await sharp(join(src, s.photo))
      .rotate()
      .resize(SIZE, SIZE, { fit: 'cover', position: sharp.strategy.attention })
      .webp({ quality: 80 })
      .toFile(join(PHOTOS, `${s.slug}.webp`));
    photo = `/kgc/past-speakers/${s.slug}.webp`;
  }
  const fix = BIO_FIXES[s.slug];
  if (fix && !s.bioHtml.includes(fix.broken)) {
    throw new Error(`${s.slug}: the export no longer has the broken bio this fix replaces. Check it and drop the fix.`);
  }
  const years = new Set((s.years ?? []).map(Number));
  if (ALSO_2023.includes(s.slug)) years.add(2023);
  const links = Object.fromEntries(
    ['linkedin', 'twitter', 'website'].map((k) => [k, clean(s.links?.[k])]).filter(([, v]) => v),
  );
  speakers.push({
    slug: s.slug,
    name: s.name.trim(),
    ...(clean(s.title) ? { title: clean(s.title) } : {}),
    ...(clean(s.company) ? { company: clean(s.company) } : {}),
    years: [...years].sort((a, b) => a - b),
    photo,
    ...(photo ? { photoWidth: SIZE, photoHeight: SIZE } : {}),
    ...(photo && PHOTO_CREDITS[s.slug] ? { photoCredit: PHOTO_CREDITS[s.slug] } : {}),
    bioHtml: (fix ? fix.bioHtml : s.bioHtml ?? '').trim(),
    // A title or a year can be missing (a bare recording, or a talk on a page
    // covering several years); the page renders both cases.
    talks: (s.talks ?? []).map((t) => ({
      ...(Number.isInteger(t.year) ? { year: t.year } : {}),
      ...(clean(t.title) ? { title: clean(t.title) } : {}),
      ...(clean(t.url) ? { url: clean(t.url) } : {}),
      ...(clean(t.videoUrl) ? { videoUrl: clean(t.videoUrl) } : {}),
      ...(clean(t.descriptionHtml) ? { descriptionHtml: clean(t.descriptionHtml) } : {}),
    })),
    links,
    oldUrl: s.oldUrl,
    ...(clean(s.modified) ? { modified: clean(s.modified) } : {}),
  });
}

// years.json: an array of { year, slugs } or an object keyed by year.
const rawYears = read('years.json');
const years = (Array.isArray(rawYears) ? rawYears : Object.entries(rawYears).map(([year, v]) => ({ year, ...v })))
  .map((y) => ({ year: Number(y.year), slugs: y.slugs ?? [] }))
  .filter((y) => Number.isInteger(y.year))
  .sort((a, b) => a.year - b.year);
const y2023 = years.find((y) => y.year === 2023);
for (const slug of ALSO_2023) if (y2023 && !y2023.slugs.includes(slug)) y2023.slugs.push(slug);

// redirects.json: an array of { from, to } (or source/target) or a plain map.
const rawRedirects = read('redirects.json');
const pairs = Array.isArray(rawRedirects)
  ? rawRedirects.map((r) => [r.from ?? r.source ?? r.old, r.to ?? r.target ?? r.new])
  : Object.entries(rawRedirects);
const redirects = {};
for (const [from, to] of pairs) {
  if (!from || !to) continue;
  redirects[noSlash(new URL(from, 'https://x').pathname)] = target(to);
}
// Every speaker's own page, whether or not the export listed it.
for (const s of speakers) redirects[noSlash(s.oldUrl)] = `/past-speakers/${s.slug}`;

writeFileSync(join(OUT, 'speakers.json'), JSON.stringify(speakers, null, 1) + '\n');
writeFileSync(join(OUT, 'years.json'), JSON.stringify(years, null, 1) + '\n');
writeFileSync(
  join(OUT, 'redirects.json'),
  JSON.stringify(Object.fromEntries(Object.entries(redirects).sort()), null, 1) + '\n',
);

console.log(
  `${speakers.length} speakers, ${readdirSync(PHOTOS).length} photos, ${years.length} years, ${Object.keys(redirects).length} redirects`,
);
