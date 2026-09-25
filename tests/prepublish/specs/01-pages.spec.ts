import { BROKEN_TEXT, LEAKS, ROUTES, WRONG_HOSTS, expect, horizontalOverflow, test } from '../helpers';

/**
 * Every public page, one test each, on desktop and on a phone.
 *
 * What a person notices first: the page loads, says what it is, has nothing
 * broken on it, and does not scroll sideways on a phone. Plus the two things a
 * person never notices until it is too late: a secret or a wrong hostname in
 * the HTML.
 */

for (const route of ROUTES) {
  test.describe(`page ${route.path}`, () => {
    test(`loads cleanly @smoke`, async ({ page, allowStatus }) => {
      if (route.optional) allowStatus(404);
      const res = await page.goto(route.path, { waitUntil: 'load' });
      const status = res?.status() ?? 0;

      expect(status, `${route.path} must never be a server error`).toBeLessThan(500);
      if (route.optional && status === 404) {
        test.info().annotations.push({ type: 'skipped-content', description: `${route.path} is switched off (404)` });
        return;
      }
      expect(status, `${route.path} status`).toBe(200);

      // Identity: a title that is not the framework default, one h1.
      const title = await page.title();
      expect(title.trim().length, 'page has a <title>').toBeGreaterThan(3);
      expect(title).not.toMatch(/^(Create Next App|Next\.js|localhost)/i);
      await expect(page.locator('h1').first(), 'page has a visible h1').toBeVisible();

      const description = await page.locator('meta[name="description"]').getAttribute('content');
      expect(description?.trim().length ?? 0, 'meta description').toBeGreaterThan(20);

      // The chrome every page shares.
      await expect(page.locator('header').first()).toBeVisible();
      await expect(page.locator('footer').first()).toBeVisible();
      await expect(page.getByRole('link', { name: /home/i }).first()).toBeVisible();

      // Nothing on screen that reads as a bug.
      const text = await page.locator('body').innerText();
      for (const re of BROKEN_TEXT) expect(text, `visible text must not match ${re}`).not.toMatch(re);

      // Nothing in the HTML that should never have left the server.
      const html = await page.content();
      for (const re of LEAKS) expect(html, `HTML must not contain ${re}`).not.toMatch(re);
      for (const re of WRONG_HOSTS) expect(html, `HTML must not name ${re}`).not.toMatch(re);
    });

    test(`images load and have alt text @smoke`, async ({ page, allowStatus }) => {
      if (route.optional) allowStatus(404);
      const res = await page.goto(route.path, { waitUntil: 'load' });
      if (route.optional && res?.status() === 404) return;

      // Scroll through once so lazy images actually request.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForLoadState('networkidle').catch(() => {});

      const broken = await page.evaluate(() =>
        [...document.images]
          .filter((img) => img.complete && img.naturalWidth === 0 && img.getAttribute('src'))
          .map((img) => img.currentSrc || img.src),
      );
      expect(broken, 'images that failed to load').toEqual([]);

      const noAlt = await page.evaluate(() =>
        [...document.images].filter((img) => !img.hasAttribute('alt')).map((img) => img.src),
      );
      expect(noAlt, 'images with no alt attribute (use alt="" for decoration)').toEqual([]);
    });

    test(`fits a phone screen without sideways scrolling @mobile`, async ({ page, allowStatus }, info) => {
      test.skip(info.project.name !== 'mobile', 'phone layout is checked on the mobile project');
      if (route.optional) allowStatus(404);
      const res = await page.goto(route.path, { waitUntil: 'load' });
      if (route.optional && res?.status() === 404) return;
      expect(await horizontalOverflow(page), 'page is wider than the phone').toBeNull();
    });

    test(`answers quickly @smoke`, async ({ request }) => {
      const started = Date.now();
      const res = await request.get(route.path, { maxRedirects: 0 });
      const ms = Date.now() - started;
      if (route.optional && res.status() === 404) return;
      expect(res.status()).toBe(200);
      // Generous, because staging is one small droplet. A page over this
      // budget on a second try is a page that is actually slow.
      expect(ms, `${route.path} took ${ms}ms`).toBeLessThan(8_000);
      const bytes = (await res.body()).length;
      expect(bytes, `${route.path} HTML is ${Math.round(bytes / 1024)}KB`).toBeLessThan(1_500_000);
    });
  });
}

test('the 404 page is a real page with a way home @smoke', async ({ page, allowStatus }) => {
  allowStatus(404);
  const res = await page.goto('/this-page-does-not-exist-prepublish');
  expect(res?.status()).toBe(404);
  await expect(page.locator('header').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Application error|Internal Server Error/i);
  await expect(page.getByRole('link', { name: /home|tickets|back/i }).first()).toBeVisible();
});

test('the tab icon is served', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="icon"]').first().getAttribute('href');
  expect(href, '<link rel="icon"> on the home page').toBeTruthy();
  const res = await request.get(href!);
  expect(res.status(), `icon ${href}`).toBe(200);
  expect(res.headers()['content-type']).toMatch(/^image\//);
});
