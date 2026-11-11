import { MONEY_ROUTES, SALES, expect, test } from '../helpers';

/**
 * Ticket sales switched off under Marketing > Event Website.
 *
 * Prices are not decided, so no ticket page may show one and nothing on the
 * site may invite a visitor to register.
 */

test.describe('ticket sales are switched off @tickets', () => {
  test.skip(SALES !== 'off', 'needs PREPUBLISH_SALES=off');

  for (const path of MONEY_ROUTES) {
    test(`${path} says tickets are not on sale, with no price`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tickets are not on sale yet');
      await expect(page.locator('a[href^="mailto:"]').first()).toBeVisible();
      await expect(page.locator('main')).not.toContainText(/\$\s?\d/);
      await expect(page.locator('main form')).toHaveCount(0);
    });
  }

  for (const path of ['/', '/about', '/community', '/hcls', '/kgc-lifetime-achievement-awards']) {
    test(`${path} has no register button`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('a[href="/tickets"].btn')).toHaveCount(0);
      await expect(page.getByText(/Register now|Register for KGC|Grab a seat|Get tickets/)).toHaveCount(0);
    });
  }
});
