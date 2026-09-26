import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POSTS } from './posts';
import { oldSiteTarget } from './old-site';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** Every address the WordPress site published, from its own sitemap. */
const LIVE = readFileSync(join(ROOT, 'docs/audit-2026-09-19/domain/live-urls.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('/'));

const APP = join(import.meta.dirname, '..', 'app');
const ROUTES = new Set(readdirSync(APP).filter((n) => !n.includes('.') && !n.startsWith('[')));

describe('old WordPress addresses', () => {
  it('reads the whole list', () => expect(LIVE.length).toBeGreaterThan(900));

  it('ignores the trailing slash every WordPress address had', () => {
    expect(oldSiteTarget('/about-kgc/')).toBe('/about');
    expect(oldSiteTarget('/about-kgc')).toBe('/about');
  });

  it('sends a whole section, and the section itself, to one page', () => {
    expect(oldSiteTarget('/conference-2019/')).toBe('/previous-events');
    expect(oldSiteTarget('/conference-2019/speakers/someone/')).toBe('/previous-events');
    expect(oldSiteTarget('/conference-20199')).toBeNull();
  });

  it('leaves this site’s own pages alone', () => {
    for (const p of ['/', '/tickets', '/about', '/blog', '/previous-events', '/privacy']) expect(oldSiteTarget(p)).toBeNull();
  });

  it('points every redirect at a page that exists', () => {
    for (const path of LIVE) {
      const to = oldSiteTarget(path);
      if (!to) continue;
      const first = to.split(/[/?#]/)[1] ?? '';
      expect(first === '' || ROUTES.has(first), `${path} -> ${to}`).toBe(true);
    }
  });

  it('leaves no old address without somewhere to go', () => {
    const slugs = new Set(POSTS.map((p) => p.slug));
    const lost = LIVE.filter((path) => {
      if (oldSiteTarget(path)) return false;
      const parts = path.split('/').filter(Boolean);
      if (parts.length === 0) return false;
      if (parts.length === 1 && ROUTES.has(parts[0])) return false;
      if (parts[0] === 'blog' && (parts.length === 1 || slugs.has(parts[1]))) return false;
      return true;
    });
    expect(lost).toEqual([]);
  });
});
