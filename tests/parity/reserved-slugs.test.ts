/**
 * Every address the website already answers is refused to a custom page.
 *
 * ── Why this is a source-level test ─────────────────────────────────────────
 *
 * The dashboard validates a page's address against a hand-written list in
 * `@kgc/shared`, and the two things that list has to agree with live in
 * `apps/web` — a directory of routes and a redirect file. The dashboard and
 * the website are separate installs and neither imports the other, so the only
 * thing that can compare them is a test that reads both, the same approach
 * `storage-url.test.ts` and `step-up-guard.test.ts` take.
 *
 * ── The failure it exists to stop ───────────────────────────────────────────
 *
 * Next resolves a static segment before `[slug]`, and the host resolves a
 * redirect before Next. So a page published at `/speaker` or at `/program`
 * saves cleanly, shows the organizer the address it was given, and sends every
 * visitor somewhere else. Nothing reports it, because from the database's side
 * nothing is wrong. The branded event slug is printed on badges, which is
 * where that stops being a nuisance.
 *
 * Run with: npm test — no emulator, no Java.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REDIRECTED_PAGE_SLUGS, RESERVED_PAGE_SLUGS, slugProblem } from '@kgc/shared';

const ROOT = resolve(__dirname, '../..');

/** Every top-level static route segment the website serves. */
function siteRoutes(): string[] {
  return readdirSync(resolve(ROOT, 'apps/web/src/app'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    // `[slug]` is the custom page route itself and `(group)` is not an address.
    .filter((e) => !e.name.startsWith('[') && !e.name.startsWith('('))
    .map((e) => e.name);
}

/**
 * Every single-segment source in the redirect map.
 *
 * Only single-segment ones can collide: `/kgc-2022/program` cannot be a page
 * address, because a page address has no slash in it.
 */
function singleSegmentRedirects(): string[] {
  const text = readFileSync(resolve(ROOT, 'apps/web/public/_redirects'), 'utf8');
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const from = line.split(/\s+/)[0] ?? '';
    const m = /^\/([a-z0-9][a-z0-9-]*)\/?$/.exec(from);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

describe('a custom page cannot claim an address the site already answers', () => {
  it('reserves every top-level route on the website', () => {
    const missing = siteRoutes().filter((r) => !RESERVED_PAGE_SLUGS.includes(r));
    expect(missing).toEqual([]);
  });

  it('reserves every old address the site still redirects', () => {
    const missing = singleSegmentRedirects().filter(
      (r) => !RESERVED_PAGE_SLUGS.includes(r) && !REDIRECTED_PAGE_SLUGS.includes(r),
    );
    expect(missing).toEqual([]);
  });

  it('refuses the two singular routes that were shadowing pages silently', () => {
    // `exhibitors` was reserved and `exhibitor` — the lead desk — was not, and
    // `speakers` was reserved and `speaker` — the profile portal — was not.
    expect(slugProblem('exhibitor')).toContain('already uses /exhibitor');
    expect(slugProblem('speaker')).toContain('already uses /speaker');
  });

  it('tells an organizer which of the two kinds of collision they hit', () => {
    expect(slugProblem('agenda')).toBe('The website already uses /agenda. Pick another address.');
    expect(slugProblem('program')).toBe(
      '/program already sends visitors to an older page, so nobody would reach this one. Pick another address.',
    );
  });

  it('still allows an address nothing on the site claims', () => {
    expect(slugProblem('travel-and-hotels')).toBeNull();
    expect(slugProblem('venue')).toBeNull();
  });
});
