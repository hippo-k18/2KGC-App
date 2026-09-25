import { ROUTES, expect, test } from '../helpers';

/**
 * Getting around: the header, the phone menu, the footer, search, and every
 * internal link on every public page.
 */

test.describe('header', () => {
  test('desktop nav links all resolve and mark the current page', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();

    const hrefs = await nav.locator('a[href^="/"]').evaluateAll((as) =>
      [...new Set(as.map((a) => a.getAttribute('href')!))],
    );
    expect(hrefs.length, 'main nav has links').toBeGreaterThan(2);

    for (const href of hrefs) {
      const res = await page.request.get(href);
      expect(res.status(), `nav link ${href}`).toBeLessThan(400);
    }

    await page.goto('/tickets');
    const current = page.locator('#main-nav [aria-current="page"]');
    // Tickets lives in a button outside the nav, so any current marker is fine;
    // what matters is that a nav page marks itself.
    await page.goto('/about');
    await expect(current.first()).toBeVisible();
  });

  test('the Tickets button in the header goes to /tickets @tickets', async ({ page }, info) => {
    await page.goto('/');
    if (info.project.name === 'mobile') {
      // On a phone Tickets lives inside the menu.
      await page.getByRole('button', { name: 'Open menu' }).click();
      await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible();
      await page.locator('#main-nav a[href="/tickets"]').first().click();
    } else {
      await page.locator('header a.btn[href="/tickets"]').click();
    }
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Tickets/);
  });

  test('logo returns home', async ({ page }) => {
    await page.goto('/about');
    await page.locator('header a.logo').click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('phone menu opens, shows links, and closes @mobile', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile');
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Open menu' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
    const links = page.locator('#main-nav a:visible');
    expect(await links.count()).toBeGreaterThan(2);
    // Every visible link fits inside the screen.
    for (const box of await links.evaluateAll((as) => as.map((a) => a.getBoundingClientRect().toJSON()))) {
      expect(box.left).toBeGreaterThanOrEqual(-1);
      expect(box.right).toBeLessThanOrEqual(391);
    }
    await page.getByRole('button', { name: 'Close menu' }).click();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  });

  test('site search finds something @smoke', async ({ page }) => {
    await page.goto('/');
    const opener = page.getByRole('button', { name: 'Search the site' });
    if (await opener.isVisible()) {
      await opener.click();
      const box = page.locator('#site-search input').first();
      await box.fill('ticket');
      await box.press('Enter');
    } else {
      await page.goto('/search?q=ticket');
    }
    await expect(page).toHaveURL(/\/search/);
    await expect(page.locator('main, body').first()).toContainText(/ticket/i);
  });
});

test.describe('footer', () => {
  test('every footer link resolves', async ({ page }) => {
    await page.goto('/');
    const hrefs = await page.locator('footer a[href]').evaluateAll((as) =>
      [...new Set(as.map((a) => a.getAttribute('href')!))],
    );
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      if (href.startsWith('mailto:')) {
        expect(href).toMatch(/^mailto:[^@\s]+@[^@\s]+\.[a-z]+/i);
        continue;
      }
      if (!href.startsWith('/')) continue; // external, checked in the crawl
      const res = await page.request.get(href.split('#')[0]);
      expect(res.status(), `footer link ${href}`).toBeLessThan(400);
    }
  });
});

/**
 * Every link on every public page, followed once.
 *
 * Internal links must answer below 400. External links are only checked for
 * shape, not fetched: a partner's site being down is not a reason to block a
 * publish, and fetching them from CI gets rate-limited.
 */
test('no broken internal links anywhere @smoke', async ({ page, request, allowStatus }, info) => {
  test.skip(info.project.name === 'mobile', 'links are the same on every viewport');
  test.setTimeout(240_000);
  // Switched-off pages 404 on their own visit; links *to* them are still checked below.
  allowStatus(404);

  const seen = new Map<string, string>(); // href -> first page it was found on
  for (const route of ROUTES) {
    const res = await page.goto(route.path);
    if (res?.status() !== 200) continue;
    const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
    for (const raw of hrefs) {
      if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue;
      if (raw.startsWith('javascript:')) throw new Error(`javascript: link on ${route.path}`);
      if (/^https?:\/\//.test(raw)) {
        expect(() => new URL(raw), `malformed external link on ${route.path}`).not.toThrow();
        continue;
      }
      const path = raw.split('#')[0];
      if (path && !seen.has(path)) seen.set(path, route.path);
    }
  }

  const broken: string[] = [];
  const queue = [...seen.entries()];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const [href, from] = queue.shift()!;
        const res = await request.get(href, { maxRedirects: 5 }).catch(() => null);
        const code = res?.status() ?? 0;
        if (code === 0 || code >= 400) broken.push(`${code} ${href} (linked from ${from})`);
      }
    }),
  );
  expect(broken, 'broken internal links').toEqual([]);
});
