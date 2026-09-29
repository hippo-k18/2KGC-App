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
      if (/^https:\/\//.test(to)) continue; // the archive and the blog feed, checked below
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

  it('sends archived sessions, partners and portfolio items to the same address on the archive, in one hop', () => {
    expect(oldSiteTarget('/blog/agenda/joe-pindell/')).toBe('https://archive.knowledgegraph.tech/blog/agenda/joe-pindell/');
    expect(oldSiteTarget('/blog/agenda/joe-pindell')).toBe('https://archive.knowledgegraph.tech/blog/agenda/joe-pindell/');
    expect(oldSiteTarget('/blog/partners/acme/')).toBe('https://archive.knowledgegraph.tech/blog/partners/acme/');
    expect(oldSiteTarget('/blog/portfolio/day-1/')).toBe('https://archive.knowledgegraph.tech/blog/portfolio/day-1/');
    const archived = LIVE.filter((p) => /^\/blog\/(agenda|partners|portfolio)\//.test(p));
    expect(archived.length).toBeGreaterThan(150);
    for (const p of archived) expect(oldSiteTarget(p)).toBe(`https://archive.knowledgegraph.tech${p.replace(/\/?$/, '/')}`);
  });

  it('keeps the section roots and category pages on their hub, since the archive has no copy of the roots', () => {
    expect(oldSiteTarget('/blog/agenda/')).toBe('/previous-events');
    expect(oldSiteTarget('/blog/partners')).toBe('/exhibitors');
    expect(oldSiteTarget('/blog/agenda-category/2021/')).toBe('/previous-events');
  });

  it('sends speakers to their past-speaker page before any archive rule', () => {
    expect(oldSiteTarget('/blog/speakers/ora-lassila/')).toBe('/past-speakers/ora-lassila');
  });

  it('points the old feeds at the blog feed', () => {
    expect(oldSiteTarget('/feed/')).toBe('https://blog.knowledgegraph.tech/feed.xml');
    expect(oldSiteTarget('/blog/feed/')).toBe('https://blog.knowledgegraph.tech/feed.xml');
  });
});
