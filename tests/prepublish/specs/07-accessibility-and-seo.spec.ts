import AxeBuilder from '@axe-core/playwright';
import { MONEY_ROUTES, ROUTES, expect, test } from '../helpers';

/**
 * Accessibility, by axe-core, and what search engines and link previews read.
 *
 * The purchase pages are held to a stricter bar than the rest: a buyer who
 * cannot operate the checkout with a screen reader is a buyer turned away.
 */

const STRICT = new Set(MONEY_ROUTES);

for (const route of ROUTES) {
  test(`accessibility: ${route.path} @a11y`, async ({ page, allowStatus }, info) => {
    test.skip(info.project.name === 'mobile', 'axe runs once, on desktop');
    if (route.optional) allowStatus(404);
    const res = await page.goto(route.path);
    if (route.optional && res?.status() === 404) return;

    const results = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

    // Purchase pages fail on serious and critical; the rest on critical only.
    const blocking = results.violations.filter((v) =>
      STRICT.has(route.path) ? v.impact === 'critical' || v.impact === 'serious' : v.impact === 'critical',
    );
    const report = blocking.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}×) e.g. ${v.nodes[0]?.target.join(' ')}`);
    expect(report, `axe violations on ${route.path}`).toEqual([]);

    // Everything else is reported, not failed, so it stays visible.
    const rest = results.violations.filter((v) => !blocking.includes(v));
    if (rest.length) {
      info.annotations.push({
        type: 'a11y-warnings',
        description: rest.map((v) => `${v.impact} ${v.id} (${v.nodes.length}×)`).join('; '),
      });
    }
  });
}

test.describe('search and sharing @smoke', () => {
  test('home page has a valid Event JSON-LD naming this site', async ({ page, baseURL }) => {
    await page.goto('/');
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.length, 'JSON-LD on the home page').toBeGreaterThan(0);
    const parsed = blocks.map((b) => JSON.parse(b));
    const flat = parsed.flatMap((p) => (Array.isArray(p) ? p : p['@graph'] ?? [p]));
    const event = flat.find((n) => /Event/.test(String(n['@type'])));
    expect(event, 'a schema.org Event').toBeTruthy();
    expect(event.name).toBeTruthy();
    expect(event.startDate).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(event.location).toBeTruthy();
    // Staging names production as its canonical origin, by design.
    const origins = (process.env.PREPUBLISH_CANONICAL ?? 'https://www.knowledgegraph.tech,https://staging.knowledgegraph.tech')
      .split(',')
      .concat(baseURL!);
    for (const field of ['url', '@id'] as const) {
      if (event[field]) expect(origins.some((o) => String(event[field]).startsWith(o)), `Event ${field} ${event[field]}`).toBe(true);
    }
    if (event.offers) {
      for (const offer of [].concat(event.offers)) {
        const o = offer as { price?: string | number; priceCurrency?: string };
        expect(Number(o.price)).toBeGreaterThanOrEqual(0);
        expect(o.priceCurrency).toMatch(/^[A-Z]{3}$/);
      }
    }
  });

  for (const path of ['/', '/tickets']) {
    test(`link preview tags on ${path}`, async ({ page, request }) => {
      await page.goto(path);
      const og = async (p: string) => page.locator(`meta[property="og:${p}"]`).first().getAttribute('content');
      expect(await og('title')).toBeTruthy();
      expect(await og('description')).toBeTruthy();
      const image = await og('image');
      if (image) {
        const res = await request.get(image);
        expect(res.status(), `og:image ${image}`).toBe(200);
        expect(res.headers()['content-type']).toMatch(/^image\//);
      }
      await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/);
    });
  }

  test('titles are unique across pages', async ({ request }) => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const r of ROUTES) {
      const res = await request.get(r.path);
      if (res.status() !== 200) continue;
      const title = (await res.text()).match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
      if (seen.has(title)) dupes.push(`"${title}" on ${seen.get(title)} and ${r.path}`);
      else seen.set(title, r.path);
    }
    expect(dupes).toEqual([]);
  });
});
