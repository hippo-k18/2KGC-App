import { expect, parsePrice, readTiers, test } from '../helpers';

/**
 * /tickets — choosing a ticket.
 *
 * The page a buyer lands on. Every tier must show a real price, every Choose
 * must lead to a checkout for that tier, and nothing on it may read as broken.
 */

test.describe('tickets page @tickets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tickets');
  });

  test('opens straight on the tickets, with dates and venue', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tickets');
    // "<dates> at <venue>." directly under the heading.
    const orient = page.locator('h1 + p');
    await expect(orient).toContainText(/\d{4}/);
    await expect(orient).toContainText(/ at /);
    // No hero: the first tier's price is visible without scrolling.
    const firstPrice = page.locator('article p').filter({ hasText: /\$\d/ }).first();
    await expect(firstPrice).toBeInViewport();
  });

  test('shows at least one tier on sale, each with a real price', async ({ page }) => {
    const tiers = await readTiers(page);
    expect(tiers.length, 'on-sale tiers on /tickets').toBeGreaterThan(0);

    for (const tier of tiers) {
      expect(tier.name.trim(), 'tier name').not.toBe('');
      expect(tier.id, `tier id in the Choose link for ${tier.name}`).toMatch(/^[\w-]+$/);
      expect(tier.href).toBe(`/tickets/checkout?tier=${encodeURIComponent(tier.id)}`);

      // The price is printed near the tier's own heading.
      const heading = page.getByRole('heading', { name: tier.name, exact: true }).first();
      await expect(heading, `heading for ${tier.name}`).toBeVisible();
      const card = heading.locator('xpath=ancestor::*[self::article or self::li][1]');
      const price = parsePrice(await card.innerText());
      expect(price, `price for ${tier.name}`).not.toBeNull();
      expect(price!, `price for ${tier.name} is positive`).toBeGreaterThan(0);
      expect(price!, `price for ${tier.name} is plausible`).toBeLessThan(10_000_00);
    }

    const ids = tiers.map((t) => t.id);
    expect(new Set(ids).size, 'every tier id is unique').toBe(ids.length);
  });

  test('the dearest tier leads the page', async ({ page }) => {
    const articles = page.locator('article');
    const prices: number[] = [];
    for (const text of await articles.allInnerTexts()) {
      const p = parsePrice(text);
      if (p !== null) prices.push(p);
    }
    const rows = await page.locator('main li, body > div li').filter({ has: page.locator('h3') }).allInnerTexts();
    for (const text of rows) {
      const p = parsePrice(text);
      if (p !== null) prices.push(p);
    }
    expect(prices.length).toBeGreaterThan(0);
    expect(prices[0], 'the first panel is the most expensive tier').toBe(Math.max(...prices));
  });

  test('a closed tier says why instead of offering a button', async ({ page }) => {
    // Every card either has a Choose link or a reason. Never neither.
    const cards = page.locator('article, li:has(> div > h3)');
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      const hasChoose = (await card.getByRole('link', { name: /^Choose / }).count()) > 0;
      if (hasChoose) continue;
      const text = (await card.innerText()).trim();
      expect(text, 'a tier with no Choose button explains why').toMatch(/sold out|closed|not available|unavailable|soon|ended/i);
    }
  });

  test('every Choose leads to a checkout for that tier', async ({ page }) => {
    const tiers = await readTiers(page);
    for (const tier of tiers) {
      await test.step(tier.name, async () => {
        await page.goto('/tickets');
        await page.getByRole('link', { name: `Choose ${tier.name}`, exact: true }).first().click();
        await expect(page).toHaveURL(new RegExp(`/tickets/checkout\\?tier=${tier.id}`));
        await expect(page.locator('form.checkout')).toBeVisible();
        await expect(page.locator('.tier-chosen strong')).toHaveText(tier.name);
      });
    }
  });

  test('the questions open, and the invoice link works', async ({ page }) => {
    const faq = page.locator('.kgc-faq details');
    expect(await faq.count()).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < (await faq.count()); i++) {
      const item = faq.nth(i);
      await item.locator('summary').click();
      await expect(item).toHaveAttribute('open', '');
      await expect(item.locator('.answer')).toBeVisible();
    }
    await page.locator('.kgc-faq').getByRole('link', { name: /request one/i }).click();
    await expect(page).toHaveURL(/\/tickets\/invoice/);
  });

  test('contact email is a working mailto', async ({ page }) => {
    const mail = page.locator('a[href^="mailto:"]').first();
    await expect(mail).toHaveAttribute('href', /^mailto:[^@]+@[^@]+\.[a-z]+$/i);
  });

  test('a cancelled checkout is acknowledged', async ({ page }) => {
    await page.goto('/tickets?cancelled=1');
    await expect(page.getByText(/cancelled and nothing was charged/i)).toBeVisible();
  });
});
