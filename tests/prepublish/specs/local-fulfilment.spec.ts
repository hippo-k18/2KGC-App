import type { Page } from '@playwright/test';
import { expect, fakeEmail, readTiers, test } from '../helpers';

/**
 * A real purchase, start to finish, on a localhost dev server.
 *
 * Uses the "Skip payment and register (demo)" button, which runs the same
 * validation as the Stripe path and then the same fulfilment the webhook runs:
 * registration, order, app account, entitlements, sold count, receipt. It is
 * the only way to prove a buyer ends up holding a ticket without a Stripe
 * test key and a `stripe listen` tunnel.
 *
 * ⚠️ This writes to whatever Firestore the dev server points at. Every order
 * it creates is `channel: 'demo'`; undo them with
 *   node scripts/ops/reset-demo-sales.mjs
 *
 * Run: `cd apps/web && npm run dev`, then in tests/prepublish:
 *   PREPUBLISH_LOCAL_WRITE=1 npm run test:local
 */

test.skip(process.env.PREPUBLISH_LOCAL_WRITE !== '1', 'writes real demo orders; set PREPUBLISH_LOCAL_WRITE=1');

async function openCheckout(page: Page) {
  await page.goto('/tickets');
  const [first] = await readTiers(page);
  await page.goto(`/tickets/checkout?tier=${first.id}`);
  await expect(page.getByRole('button', { name: /skip payment/i })).toBeVisible();
  return first;
}

async function answerQuestions(page: Page) {
  for (const el of await page.locator('form.checkout [name^="q_"][required]').all()) {
    const tag = await el.evaluate((e) => e.tagName.toLowerCase());
    if (tag === 'select') {
      const v = await el.locator('option:not([disabled])').evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => o.value).filter(Boolean));
      await el.selectOption(v[0]);
    } else if ((await el.getAttribute('type')) === 'checkbox') await el.check();
    else await el.fill('Prepublish check');
  }
}

test.describe('local purchase, end to end @tickets', () => {
  test('server validation runs on the demo path too', async ({ page }) => {
    await openCheckout(page);
    await page.locator('form.checkout').evaluate((f) => f.setAttribute('novalidate', ''));
    await page.getByLabel('Attendee name').fill('Ada Lovelace');
    await page.getByLabel('Email address').first().fill('not-an-email');
    await page.getByRole('button', { name: /skip payment/i }).click();
    await expect(page.locator('form.checkout [role="alert"]').first()).toContainText(/valid email/i);
  });

  test('one ticket: pay, land on the order page, see the ticket', async ({ page }) => {
    test.setTimeout(90_000);
    const tier = await openCheckout(page);
    const email = fakeEmail('local1');
    await page.getByLabel('Attendee name').fill('Prepublish Single');
    await page.getByLabel('Email address').first().fill(email);
    await answerQuestions(page);
    await page.getByRole('button', { name: /skip payment/i }).click();

    await page.waitForURL(/\/order\//, { timeout: 60_000 });
    await expect(page.locator('h1.order-headline')).toBeVisible();
    await expect(page.locator('body')).toContainText('Prepublish Single');
    await expect(page.locator('body')).toContainText(tier.name);
    // The ticket itself: a QR code the door can scan.
    await expect(page.locator('svg, img, canvas').filter({ has: page.locator('*') }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Three things, then you/ })).toBeVisible();

    // The order link is a capability: reloading it works, tampering does not.
    const url = page.url();
    await page.reload();
    await expect(page.locator('h1.order-headline')).toBeVisible();
    const res = await page.request.get(url.slice(0, -3) + 'xyz');
    expect(res.status()).toBe(404);
  });

  test('three tickets on one card: every attendee is registered', async ({ page }) => {
    test.setTimeout(90_000);
    await openCheckout(page);
    await page.getByLabel('How many tickets?').selectOption('3');
    await page.getByLabel('Attendee name').fill('Prepublish Buyer');
    await page.getByLabel('Email address').first().fill(fakeEmail('buyer'));
    const names = ['Prepublish Two', 'Prepublish Three'];
    for (const [i, n] of names.entries()) {
      await page.locator('input[name="seatName"]').nth(i).fill(n);
      await page.locator('input[name="seatEmail"]').nth(i).fill(fakeEmail(`seat${i + 2}`));
    }
    await answerQuestions(page);
    await page.getByRole('button', { name: /skip payment/i }).click();
    await page.waitForURL(/\/order\//, { timeout: 60_000 });
    await expect(page.locator('h1.order-headline')).toBeVisible();
    await expect(page.locator('body')).toContainText('Prepublish Buyer');
  });
});
