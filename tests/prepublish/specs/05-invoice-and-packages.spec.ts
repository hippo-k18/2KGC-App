import { SALES, expect, fakeEmail, parsePrice, test } from '../helpers';

/**
 * The other two ways to buy: an invoice for a company, and the sponsor and
 * exhibitor package pages.
 *
 * ⚠️ The invoice form is only drawn with sales open, and a valid request raises a real Stripe invoice and
 * emails it, so the open-sales checks here only ever submit invalid forms.
 */

test.describe('pay by invoice @tickets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tickets/invoice');
  });

  test('while sales are closed the page says so and offers email instead', async ({ page }) => {
    test.skip(SALES !== 'closed');
    await expect(page.locator('h1')).toHaveText(/Invoice a company/);
    await expect(page.locator('form#invoice')).toHaveCount(0);
    await expect(page.locator('.notice').first()).toBeVisible();
    await expect(page.locator('a[href^="mailto:"]').first()).toBeVisible();
  });

  test('the form is complete and labelled', async ({ page }) => {
    test.skip(SALES !== 'open', 'the form is only drawn with sales open');
    const form = page.locator('form#invoice');
    await expect(form).toBeVisible();
    await expect(form.getByRole('heading', { name: 'Request an invoice' })).toBeVisible();
    for (const label of ['Full name', 'Email address', 'Ticket', 'Company name', 'Billing email', 'Payment terms']) {
      await expect(form.getByLabel(label, { exact: false }).first(), label).toBeVisible();
    }
    const terms = await page.getByLabel('Payment terms').locator('option').allInnerTexts();
    expect(terms).toEqual(['Net 14 days', 'Net 30 days', 'Net 45 days', 'Net 60 days']);
    await expect(page.getByLabel('Payment terms')).toHaveValue('30');
    await expect(page.getByLabel(/Purchase order/)).toHaveAttribute('maxlength', '30');
    await expect(page.getByRole('button', { name: 'Request invoice' })).toBeEnabled();
  });

  test('attendees add, remove, and the subtotal follows', async ({ page }) => {
    test.skip(SALES !== 'open', 'the form is only drawn with sales open');
    const summary = page.locator('form#invoice .summary');
    const one = parsePrice(await summary.innerText());
    expect(one, 'one-seat subtotal').toBeGreaterThan(0);
    await expect(summary).toContainText('1 seat');

    await page.getByRole('button', { name: '+ Add another attendee' }).click();
    await page.getByRole('button', { name: '+ Add another attendee' }).click();
    await expect(page.getByText(/^Attendee \d$/)).toHaveCount(3);
    await expect(summary).toContainText('3 seats');
    expect(parsePrice(await summary.innerText())).toBe(one! * 3);

    await page.getByRole('button', { name: 'Remove' }).first().click();
    await expect(page.getByText(/^Attendee \d$/)).toHaveCount(2);
    expect(parsePrice(await summary.innerText())).toBe(one! * 2);

    // Changing one seat's ticket reprices that seat only.
    const selects = page.locator('select[name="seatTier"]');
    const values = await selects.first().locator('option:not([disabled])').evaluateAll((os) =>
      os.map((o) => (o as HTMLOptionElement).value),
    );
    if (values.length > 1) {
      await selects.nth(1).selectOption(values[1]);
      expect(parsePrice(await summary.innerText())).not.toBe(one! * 2);
    }
  });

  test('stops at ten attendees', async ({ page }) => {
    test.skip(SALES !== 'open', 'the form is only drawn with sales open');
    const add = page.getByRole('button', { name: '+ Add another attendee' });
    for (let i = 0; i < 9; i++) await add.click();
    await expect(page.getByText(/^Attendee \d+$/)).toHaveCount(10);
    await expect(add).toHaveCount(0);
  });


  test('refuses a missing company, bad billing email and duplicate attendees', async ({ page }) => {
    test.skip(SALES !== 'open', 'server checks only run with sales open');
    const form = page.locator('form#invoice');
    await form.evaluate((f) => f.setAttribute('novalidate', ''));
    const alert = form.locator('[role="alert"]');
    const submit = page.getByRole('button', { name: 'Request invoice' });

    await page.locator('input[name="seatName"]').first().fill('Prepublish Check');
    await page.locator('input[name="seatEmail"]').first().fill(fakeEmail('inv'));
    await page.getByLabel('Billing email').fill(fakeEmail('ap'));
    await submit.click();
    await expect(alert).toContainText(/company name/i);

    await page.getByLabel('Company name').fill('Prepublish Inc');
    await page.getByLabel('Billing email').fill('nope');
    await submit.click();
    await expect(alert).toContainText(/billing email/i);

    await page.getByLabel('Billing email').fill(fakeEmail('ap'));
    await page.getByRole('button', { name: '+ Add another attendee' }).click();
    const shared = await page.locator('input[name="seatEmail"]').first().inputValue();
    await page.locator('input[name="seatName"]').nth(1).fill('Second Person');
    await page.locator('input[name="seatEmail"]').nth(1).fill(shared);
    await submit.click();
    await expect(alert).toContainText(/appears twice/i);
  });
});

for (const kind of ['sponsor', 'exhibitor'] as const) {
  test.describe(`${kind} packages @tickets`, () => {
    test('page renders packages or says they are coming', async ({ page }) => {
      await page.goto(`/tickets/${kind}`);
      await expect(page.locator('h1')).toBeVisible();
      const cards = page.locator('.tier-card');
      if ((await cards.count()) === 0) {
        await expect(page.locator('body')).toContainText(/not been published|not open yet/i);
        return;
      }
      for (const card of await cards.all()) {
        await expect(card.locator('.tier-card-name')).not.toBeEmpty();
        expect(parsePrice(await card.locator('.tier-card-price').innerText())).toBeGreaterThan(0);
        // The details open.
        await card.locator('summary').click();
        await expect(card.locator('.tier-card-detail')).toBeVisible();
      }
    });

    test('choosing a package selects it in the form below', async ({ page }) => {
      await page.goto(`/tickets/${kind}`);
      const choose = page.locator('.tier-card-cta').first();
      test.skip((await choose.count()) === 0, `no ${kind} packages on sale`);
      const name = (await choose.getAttribute('aria-label'))!.replace(/^Choose /, '');
      await choose.click();
      await expect(page).toHaveURL(/\?tier=.+#buy/);
      await expect(page.locator('form.checkout')).toBeVisible();
      await expect(page.locator('.order-rail .rail-tier')).toHaveText(name);
    });

    test('"Choose a package" jumps to the form', async ({ page }) => {
      await page.goto(`/tickets/${kind}`);
      const jump = page.locator('a[href="#buy"]').first();
      test.skip((await jump.count()) === 0);
      await jump.click();
      await expect(page).toHaveURL(/#buy$/);
    });
  });
}
