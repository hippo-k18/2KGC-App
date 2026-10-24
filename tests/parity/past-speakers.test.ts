/**
 * The past speaker pages rebuilt from the old WordPress site.
 *
 * Their point is to keep what the old pages rank for in search, which only
 * holds if every old address reaches its new page in one hop: a chain of
 * redirects leaks standing at each step, and a redirect to a page that does not
 * exist throws it away. So this checks the redirect map against the pages the
 * build will actually generate, and the biographies against the short list of
 * tags the page is allowed to render as HTML.
 *
 * Run with: npm test.
 */
import { describe, expect, it } from 'vitest';

import REDIRECTS from '../../apps/web/src/content/past-speakers/redirects.json';
import { oldSiteTarget } from '../../apps/web/src/lib/old-site';
import {
  archiveHref,
  PAST_SPEAKERS,
  PAST_YEARS,
  pastSpeaker,
  pastSpeakerDescription,
  pastYear,
} from '../../apps/web/src/lib/past-speakers';

const map: Record<string, string> = REDIRECTS;

/**
 * Would this address render a page, rather than 404 or redirect again? The
 * directory, a year's list (`?year=`) or a speaker.
 */
function pageExists(target: string): boolean {
  if (target === '/past-speakers') return true;
  const year = /^\/past-speakers\?year=(\d{4})$/.exec(target);
  if (year) return !!pastYear(year[1]);
  const m = /^\/past-speakers\/([^/?#]+)$/.exec(target);
  return !!(m?.[1] && pastSpeaker(m[1]));
}

describe('past speakers', () => {
  it('has a page for each of the 348 old speaker pages', () => {
    expect(PAST_SPEAKERS.length).toBe(348);
  });

  it('gives every speaker a unique slug that cannot be mistaken for a year', () => {
    const slugs = PAST_SPEAKERS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug, slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(slug, slug).not.toMatch(/^\d{4}$/);
    }
  });

  it('lists only known speakers under each year, and every year a speaker has', () => {
    for (const y of PAST_YEARS) {
      for (const slug of y.slugs) {
        expect(pastSpeaker(slug)?.years, `${y.year}: ${slug}`).toContain(y.year);
      }
    }
    for (const s of PAST_SPEAKERS) {
      for (const year of s.years) {
        expect(pastYear(String(year))?.slugs, `${s.slug} in ${year}`).toContain(s.slug);
      }
    }
  });

  it('redirects every old speaker page', () => {
    for (const s of PAST_SPEAKERS) {
      expect(oldSiteTarget(s.oldUrl), s.oldUrl).toBe(`/past-speakers/${s.slug}`);
    }
  });

  it('sends every old address to an existing page in one hop', () => {
    expect(Object.keys(map).length).toBeGreaterThanOrEqual(PAST_SPEAKERS.length);
    for (const [from, to] of Object.entries(map)) {
      // With and without the trailing slash every WordPress address had.
      expect(oldSiteTarget(from), from).toBe(to);
      expect(oldSiteTarget(`${from}/`), `${from}/`).toBe(to);
      // The target is a page, not another redirect: no trailing slash for the
      // middleware to strip, and not itself an old address.
      expect(to, from).not.toMatch(/\/$/);
      expect(oldSiteTarget(to), `${from} -> ${to} redirects again`).toBeNull();
      expect(pageExists(to), `${from} -> ${to}`).toBe(true);
    }
  });

  it('sends the old year pages, and every page of the year archives, to that year', () => {
    expect(oldSiteTarget('/speakers-2022-page/')).toBe('/past-speakers?year=2022');
    expect(oldSiteTarget('/conference-2019/speakers/')).toBe('/past-speakers?year=2019');
    expect(oldSiteTarget('/blog/speakers-category/2022/')).toBe('/past-speakers?year=2022');
    expect(oldSiteTarget('/blog/speakers-category/2022/page/3/')).toBe('/past-speakers?year=2022');
  });

  it('sends an old speaker address missing from the export to the directory, not away', () => {
    expect(oldSiteTarget('/blog/speakers/nobody-by-this-name/')).toBe('/past-speakers');
    expect(oldSiteTarget('/blog/speakers/')).toBe('/past-speakers');
    expect(oldSiteTarget('/blog/speakers-category/2031/')).toBe('/past-speakers');
  });

  it('leaves the new pages alone', () => {
    expect(oldSiteTarget('/past-speakers')).toBeNull();
    for (const s of PAST_SPEAKERS) expect(oldSiteTarget(`/past-speakers/${s.slug}`)).toBeNull();
  });

  it('keeps each biography and talk abstract to the tags the page renders', () => {
    const allowed = new Set(['p', 'a', 'strong', 'em', 'ul', 'ol', 'li', 'br']);
    const docs = PAST_SPEAKERS.flatMap((s) => [
      { slug: s.slug, html: s.bioHtml },
      ...s.talks.map((t) => ({ slug: `${s.slug} (talk)`, html: t.descriptionHtml ?? '' })),
    ]);
    for (const s of docs) {
      for (const [, tag, attrs] of s.html.matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)) {
        expect(allowed.has(tag.toLowerCase()), `${s.slug}: <${tag}>`).toBe(true);
        // Whole `name="value"` pairs, so `?id=` inside an href is not read as an attribute.
        const names = [...attrs.matchAll(/([a-z-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi)].map((m) => m[1].toLowerCase());
        const ok = tag.toLowerCase() === 'a' ? names.every((n) => n === 'href') : names.length === 0;
        expect(ok, `${s.slug}: <${tag}${attrs}>`).toBe(true);
      }
      for (const [, href] of s.html.matchAll(/href\s*=\s*"([^"]*)"/gi)) {
        expect(href, s.slug).toMatch(/^(https?:\/\/|\/|mailto:|#)/i);
      }
      // WordPress and page-builder shortcodes by name: brackets alone are prose
      // here ("[RPA]", "Data [information] is the new oil").
      expect(s.html, s.slug).not.toMatch(
        /\[\/?(caption|embed|gallery|video|audio|playlist|vc_\w*|et_pb_\w*|kadence\w*|av_\w*|fusion_\w*|wpforms|contact-form-7)\b/,
      );
      // Markup that was pasted into WordPress as text and shows as characters.
      expect(s.html, s.slug).not.toMatch(/&lt;\/?[a-z]|textannotation|wp:paragraph/i);
    }
  });

  it('lists the ten speakers on the old 2023 page under 2023 as well as 2022', () => {
    for (const slug of ['fernando-aguilar', 'sara-nash', 'andrea-volpini', 'pete-rivett']) {
      expect(pastSpeaker(slug)?.years, slug).toEqual(expect.arrayContaining([2022, 2023]));
    }
  });

  it('writes a meta description for everyone', () => {
    for (const s of PAST_SPEAKERS) {
      const d = pastSpeakerDescription(s);
      expect(d.length, s.slug).toBeGreaterThan(20);
      expect(d.length, s.slug).toBeLessThanOrEqual(161);
      expect(d, s.slug).not.toMatch(/<|&[a-z]+;/);
    }
  });

  it('links talks to the archive copy of the old site', () => {
    expect(archiveHref('https://www.knowledgegraph.tech/blog/agenda/x/')).toBe(
      'https://archive.knowledgegraph.tech/blog/agenda/x/',
    );
    expect(archiveHref('/blog/agenda/x/')).toBe('https://archive.knowledgegraph.tech/blog/agenda/x/');
    expect(archiveHref('https://watch.knowledgegraph.tech/videos/x')).toBe('https://watch.knowledgegraph.tech/videos/x');
    expect(archiveHref(undefined)).toBeUndefined();
  });
});
