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
    // The section root has an archive copy (the SEO review's map); a page under it with none keeps the hub.
    expect(oldSiteTarget('/conference-2019/')).toBe('https://archive.knowledgegraph.tech/conference-2019/');
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
      if (/^https:\/\//.test(to)) continue; // the archive, checked below
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

  it('keeps the section roots, and categories with no archive copy, on their hub', () => {
    expect(oldSiteTarget('/blog/agenda/')).toBe('/previous-events');
    expect(oldSiteTarget('/blog/partners')).toBe('/exhibitors');
    expect(oldSiteTarget('/blog/agenda-category/2021/')).toBe('https://archive.knowledgegraph.tech/blog/agenda-category/2021/');
    // No archive copy (one of the review's 20): the hub, in one hop.
    expect(oldSiteTarget('/blog/agenda-category/2021/day1/track2/')).toBe('/previous-events');
    expect(oldSiteTarget('/blog/partners-category/2021-partners/2021-gold/')).toBe('/exhibitors');
  });

  it('sends speakers to their past-speaker page before any archive rule', () => {
    expect(oldSiteTarget('/blog/speakers/ora-lassila/')).toBe('/past-speakers/ora-lassila');
  });

  it('points the old feeds at the blog feed', () => {
    for (const p of ['/feed/', '/blog/feed/', '/comments/feed/']) expect(oldSiteTarget(p)).toBe('/blog/feed.xml');
  });

  it('never points at the blog host, which the middleware reaches from /blog when it is configured', () => {
    for (const to of Object.values(JSON.parse(readFileSync(join(import.meta.dirname, 'old-content-redirects.json'), 'utf8')))) {
      expect(to).not.toMatch(/blog\.knowledgegraph\.tech/);
    }
  });
});

describe('the SEO review redirect map (old-content-redirects.json)', () => {
  const TABLE = JSON.parse(readFileSync(join(import.meta.dirname, 'old-content-redirects.json'), 'utf8')) as Record<string, string>;
  const entries = Object.entries(TABLE);

  it('holds the imported rows', () => expect(entries.length).toBeGreaterThan(100));

  it('is what oldSiteTarget answers for each source, with or without the slash', () => {
    for (const [from, to] of entries) {
      expect(oldSiteTarget(from), from).toBe(to);
      expect(oldSiteTarget(`${from}/`), `${from}/`).toBe(to);
    }
  });

  it('is one hop: no target is itself an old address, and every local target is a page here', () => {
    for (const [from, to] of entries) {
      if (/^https:\/\//.test(to)) {
        // The archive serves the slash form with a 200; the slashless form would 301 again.
        if (to.startsWith('https://archive.knowledgegraph.tech/')) expect(to.endsWith('/'), `${from} -> ${to}`).toBe(true);
        continue;
      }
      const path = to.split(/[?#]/)[0];
      expect(oldSiteTarget(path), `${from} -> ${to} chains`).toBeNull();
      const first = path.split('/')[1] ?? '';
      expect(first === '' || ROUTES.has(first) || path === '/sitemap.xml', `${from} -> ${to}`).toBe(true);
      expect(TABLE[path], `${from} -> ${to} is another source`).toBeUndefined();
    }
  });

  it('never shadows a page this site serves, and leaves speakers to /past-speakers', () => {
    for (const from of Object.keys(TABLE)) {
      const first = from.split('/')[1] ?? '';
      expect(from === `/${first}` && ROUTES.has(first), `${from} is a live route`).toBe(false);
      expect(/^\/blog\/speakers\//.test(from), from).toBe(false);
    }
    expect(oldSiteTarget('/blog/speakers/ora-lassila/')).toBe('/past-speakers/ora-lassila');
    expect(oldSiteTarget('/blog/speakers-category/2022-keynote/')).toBe('/past-speakers?year=2022');
  });
});
