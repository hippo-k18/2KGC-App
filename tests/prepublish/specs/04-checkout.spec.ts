import type { Page } from '@playwright/test';
import { SALES, expect, fakeEmail, horizontalOverflow, parsePrice, readTiers, test } from '../helpers';

/**
 * /tickets/checkout — the page that takes money.
 *
 * Three layers:
 *   1. The form itself: the right tier, the right total, seats that add and
 *      remove correctly, labels, links and the pay button.
 *   2. The sales state: open or closed, as `PREPUBLISH_SALES` says it must be.
 *   3. With sales open: server-side validation, and a real hand-off to Stripe
 *      for the right amount. With `PREPUBLISH_PAY=1` and a test-mode key, a
 *      full purchase through to the order page.
 */

type Tier = { name: string; id: string; cents: number };

/** The tiers and their prices, read from the checkout picker (`?tier=` omitted). */
async function catalogue(page: Page): Promise<Tier[]> {
  await page.goto('/tickets');
  const onSale = await readTiers(page);
  const out: Tier[] = [];
  for (const t of onSale) {
    await page.goto(`/tickets/checkout?tier=${t.id}`);
    const cents = parsePrice(await page.locator('.tier-chosen').innerText());
    out.push({ name: t.name, id: t.id, cents: cents ?? NaN });
  }
  return out;
}

async function total(page: Page) {
  return parsePrice(await page.locator('.rail-amount').innerText());
}

async function summaryTotal(page: Page) {
  return parsePrice(await page.locator('form.checkout .summary').innerText());
}

/** Answer every required registration question with something valid. */
async function answerQuestions(page: Page) {
  const fields = page.locator('form.checkout [name^="q_"]');
  const n = await fields.count();
  for (let i = 0; i < n; i++) {
    const el = fields.nth(i);
    if (!(await el.isVisible())) continue;
    const tag = await el.evaluate((e) => e.tagName.toLowerCase());
    const type = (await el.getAttribute('type')) ?? '';
    const required = (await el.getAttribute('required')) !== null;
    if (tag === 'select') {
      const values = await el.locator('option:not([disabled])').evaluateAll((os) =>
        os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
      );
      if (values[0]) await el.selectOption(values[0]);
    } else if (type === 'checkbox' || type === 'radio') {
      if (required) await el.check();
    } else if (required) {
      await el.fill(type === 'email' ? 'prepublish@example.com' : 'Prepublish check');
    }
  }
}

test.describe('checkout form @tickets', () => {
  let tiers: Tier[] = [];

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    tiers = await catalogue(page);
    await page.close();
    expect(tiers.length, 'at least one tier is on sale').toBeGreaterThan(0);
  });

  test('each tier opens with its name, price and total', async ({ page }) => {
    for (const tier of tiers) {
      await test.step(tier.name, async () => {
        await page.goto(`/tickets/checkout?tier=${tier.id}`);
        expect(tier.cents, `${tier.name} has a price`).toBeGreaterThan(0);

        await expect(page.locator('.tier-chosen strong')).toHaveText(tier.name);
        await expect(page.locator('input[type="hidden"][name="tier"]')).toHaveValue(tier.id);
        await expect(page.locator('.order-rail .rail-tier')).toHaveText(tier.name);
        expect(await total(page), 'rail total').toBe(tier.cents);
        expect(await summaryTotal(page), 'summary above the button').toBe(tier.cents);
        await expect(page.locator('.rail-note')).toContainText('One ticket');
        await expect(page.locator('.rail-note')).toContainText(/sales tax/i);
      });
    }
  });

  test('"Change" goes back to all tickets', async ({ page }) => {
    await page.goto(`/tickets/checkout?tier=${tiers[0].id}`);
    await page.locator('.tier-chosen').getByRole('link', { name: 'Change' }).click();
    await expect(page).toHaveURL(/\/tickets$/);
  });

  test('"All tickets" link goes back', async ({ page }) => {
    await page.goto(`/tickets/checkout?tier=${tiers[0].id}`);
    await page.getByRole('link', { name: /All tickets/ }).click();
    await expect(page).toHaveURL(/\/tickets$/);
  });

  test('no tier, or an unknown tier, shows a working picker', async ({ page }) => {
    for (const url of ['/tickets/checkout', '/tickets/checkout?tier=not-a-real-tier']) {
      await test.step(url, async () => {
        await page.goto(url);
        const radios = page.locator('fieldset.tier-choice input[type="radio"][name="tier"]');
        expect(await radios.count(), 'one radio per tier').toBeGreaterThanOrEqual(tiers.length);
        await expect(radios.and(page.locator(':checked'))).toHaveCount(1);

        // Picking each on-sale tier moves the rail and the total with it.
        for (const tier of tiers) {
          await page.locator(`fieldset.tier-choice input[value="${tier.id}"]`).check();
          await expect(page.locator('.order-rail .rail-tier')).toHaveText(tier.name);
          expect(await total(page)).toBe(tier.cents);
        }
      });
    }
  });

  test('quantity adds and removes attendee cards, and the total follows', async ({ page }) => {
    const t = tiers[0];
    await page.goto(`/tickets/checkout?tier=${t.id}`);
    const qty = page.getByLabel('How many tickets?');

    // One to ten, nothing else.
    const options = await qty.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(options).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);

    await expect(page.locator('.seat-card')).toHaveCount(0);

    await qty.selectOption('3');
    await expect(page.locator('.seat-card')).toHaveCount(3);
    await expect(page.locator('.seat-card-title')).toHaveText(['Attendee 1 · you', 'Attendee 2', 'Attendee 3']);
    expect(await total(page)).toBe(t.cents * 3);
    expect(await summaryTotal(page)).toBe(t.cents * 3);
    await expect(page.locator('form.checkout .summary')).toContainText('3 tickets');
    await expect(page.locator('.order-rail')).toContainText('Plus 2 more attendees');

    // Extra seats default to the buyer's tier.
    for (const sel of await page.locator('select[name="seatTier"]').all()) await expect(sel).toHaveValue(t.id);

    // Typed values survive shrinking and growing again.
    await page.locator('input[name="seatName"]').first().fill('Grace Hopper');
    await page.locator('input[name="seatEmail"]').first().fill('grace@example.com');
    await qty.selectOption('2');
    await expect(page.locator('.seat-card')).toHaveCount(2);
    await qty.selectOption('3');
    await expect(page.locator('input[name="seatName"]').first()).toHaveValue('Grace Hopper');
    await expect(page.locator('input[name="seatEmail"]').first()).toHaveValue('grace@example.com');
    await expect(page.locator('input[name="seatName"]').nth(1)).toHaveValue('');

    await qty.selectOption('10');
    await expect(page.locator('.seat-card')).toHaveCount(10);
    expect(await total(page)).toBe(t.cents * 10);

    await qty.selectOption('1');
    await expect(page.locator('.seat-card')).toHaveCount(0);
    expect(await total(page)).toBe(t.cents);
  });

  test('a mixed cart adds up each seat at its own price', async ({ page }) => {
    test.skip(tiers.length < 2, 'needs two tiers on sale');
    const [a, b] = tiers;
    await page.goto(`/tickets/checkout?tier=${a.id}`);
    await page.getByLabel('How many tickets?').selectOption('3');
    await page.locator('select[name="seatTier"]').nth(1).selectOption(b.id);
    expect(await total(page), `${a.name} ×2 + ${b.name} ×1`).toBe(a.cents * 2 + b.cents);
    expect(await summaryTotal(page)).toBe(a.cents * 2 + b.cents);
  });

  test('every field has a label, and the required ones are required', async ({ page }) => {
    await page.goto(`/tickets/checkout?tier=${tiers[0].id}`);
    await page.getByLabel('How many tickets?').selectOption('2');

    const name = page.getByLabel('Attendee name');
    const email = page.getByLabel('Email address').first();
    await expect(name).toHaveAttribute('required', '');
    await expect(name).toHaveAttribute('autocomplete', 'name');
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('required', '');
    await expect(page.locator('input[name="seatName"]').first()).toHaveAttribute('required', '');
    await expect(page.locator('input[name="seatEmail"]').first()).toHaveAttribute('type', 'email');

    const unlabelled = await page.locator('form.checkout').evaluate((form) =>
      [...form.querySelectorAll('input:not([type=hidden]), select, textarea')]
        .filter((el) => {
          const id = el.id;
          const byFor = id && form.querySelector(`label[for="${CSS.escape(id)}"]`);
          return !byFor && !el.closest('label') && !el.getAttribute('aria-label');
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unlabelled, 'inputs with no label').toEqual([]);
  });

  test('the form never asks for a price or a card number', async ({ page }) => {
    await page.goto(`/tickets/checkout?tier=${tiers[0].id}`);
    const suspicious = await page.locator('form.checkout').evaluate((form) =>
      [...form.querySelectorAll('input, select, textarea')]
        .map((el) => `${el.getAttribute('name') ?? ''} ${el.getAttribute('autocomplete') ?? ''} ${el.id}`)
        .filter((s) => /price|amount|cents|total|card|cvc|cvv|expir|cc-/i.test(s)),
    );
    expect(suspicious, 'a price or card field in the form').toEqual([]);
  });

  test('the policy links and the invoice route work', async ({ page }) => {
    await page.goto(`/tickets/checkout?tier=${tiers[0].id}`);
    for (const [name, url] of [
      ['code of conduct', /\/code-of-conduct$/],
      ['privacy notice', /\/privacy$/],
    ] as const) {
      const href = await page.locator('form.checkout').getByRole('link', { name }).getAttribute('href');
      const res = await page.request.get(href!);
      expect(res.status(), name).toBe(200);
      expect(href).toMatch(url);
    }
    await page.locator('.order-rail').getByRole('link', { name: /invoice/i }).click();
    await expect(page).toHaveURL(/\/tickets\/invoice$/);
  });

  test('a cancelled Stripe payment lands back here with the tier kept', async ({ page }) => {
    await page.goto(`/tickets/checkout?tier=${tiers[0].id}&cancelled=1`);
    await expect(page.getByText('Checkout was cancelled. Nothing was charged.')).toBeVisible();
    await expect(page.locator('.tier-chosen strong')).toHaveText(tiers[0].name);
  });

  test('works with the keyboard alone', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile');
    await page.goto(`/tickets/checkout?tier=${tiers[0].id}`);
    await page.getByLabel('Attendee name').focus();
    await page.keyboard.type('Ada Lovelace');
    await page.keyboard.press('Tab');
    await page.keyboard.type('ada@example.com');
    await expect(page.getByLabel('Attendee name')).toHaveValue('Ada Lovelace');
    await expect(page.getByLabel('Email address').first()).toHaveValue('ada@example.com');

    // Tab onward until the pay button, which must be reachable.
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.classList.contains('btn-primary') ?? false);
      if (await page.locator('form.checkout button.btn-primary').isDisabled()) {
        reached = true; // a disabled button is skipped by Tab, correctly
      }
    }
    expect(reached, 'pay button reachable by Tab').toBe(true);
  });

  test('fits a phone with three attendees and a thumb-sized pay button @mobile', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile');
    await page.goto(`/tickets/checkout?tier=${tiers[0].id}`);
    await page.getByLabel('How many tickets?').selectOption('3');
    expect(await horizontalOverflow(page)).toBeNull();
    const pay = page.locator('form.checkout button.btn-primary');
    await pay.scrollIntoViewIfNeeded();
    const box = await pay.boundingBox();
    expect(box!.height, 'pay button height').toBeGreaterThanOrEqual(40);
    expect(box!.width, 'pay button width').toBeGreaterThan(200);
  });
});

test.describe(`sales are ${SALES} @tickets`, () => {
  test('the checkout says so, consistently', async ({ page }) => {
    await page.goto('/tickets');
    const [first] = await readTiers(page);
    await page.goto(`/tickets/checkout?tier=${first.id}`);
    const pay = page.locator('form.checkout button.btn-primary');
    const closedNotice = page.locator('form.checkout .notice').filter({ hasText: 'Ticket sales are not open yet' });

    if (SALES === 'closed') {
      await expect(pay, 'expected sales CLOSED (PREPUBLISH_SALES=closed). If Stripe is now live, set PREPUBLISH_SALES=open').toBeDisabled();
      // The label names its action in both states; the disabled state and the
      // notice are what say sales are closed.
      await expect(pay).toHaveText(/^Pay \$[\d,.]+ with Stripe$/);
      await expect(closedNotice).toBeVisible();
      await expect(closedNotice.getByRole('link', { name: 'Email us' })).toHaveAttribute('href', /^mailto:/);
    } else {
      await expect(pay, 'expected sales OPEN (PREPUBLISH_SALES=open) but the pay button is disabled: is STRIPE_SECRET_KEY set on this deploy?').toBeEnabled();
      await expect(pay).toHaveText(/^Pay \$[\d,.]+ with Stripe$/);
      await expect(closedNotice).toHaveCount(0);
      await expect(page.getByText('You pay on Stripe. Card details never touch this site.')).toBeVisible();
    }
  });

  test('the pay button price matches the total', async ({ page }) => {
    test.skip(SALES === 'closed', 'button shows no price while closed');
    await page.goto('/tickets');
    const [first] = await readTiers(page);
    await page.goto(`/tickets/checkout?tier=${first.id}`);
    await page.getByLabel('How many tickets?').selectOption('2');
    const button = parsePrice(await page.locator('form.checkout button.btn-primary').innerText());
    expect(button).toBe(await total(page));
  });

  test('the demo "skip payment" button is never on a deployed site', async ({ page, baseURL }) => {
    test.skip(/localhost|127\.0\.0\.1/.test(baseURL!), 'it is meant to appear on localhost');
    await page.goto('/tickets');
    const [first] = await readTiers(page);
    await page.goto(`/tickets/checkout?tier=${first.id}`);
    await expect(page.getByRole('button', { name: /skip payment/i })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/Localhost only/i);
  });
});

/**
 * With sales open, the server is exercised for real. Each check here stops
 * before Stripe is asked for anything, except the last two, which create a
 * Checkout session (nothing is charged, and an unvisited session expires).
 */
test.describe('server-side checks with sales open @tickets', () => {
  test.skip(SALES !== 'open', 'needs PREPUBLISH_SALES=open');

  async function openForm(page: Page, qty = 1) {
    await page.goto('/tickets');
    const [first] = await readTiers(page);
    await page.goto(`/tickets/checkout?tier=${first.id}`);
    if (qty > 1) await page.getByLabel('How many tickets?').selectOption(String(qty));
    // Skip the browser's own checks so the server's are what is tested.
    await page.locator('form.checkout').evaluate((f) => f.setAttribute('novalidate', ''));
    return first;
  }

  const alert = (page: Page) => page.locator('form.checkout [role="alert"]').first();

  test('refuses a blank name', async ({ page }) => {
    await openForm(page);
    await page.getByLabel('Email address').first().fill(fakeEmail('blank'));
    await answerQuestions(page);
    await page.locator('form.checkout button.btn-primary').click();
    await expect(alert(page)).toContainText(/full name/i);
    await expect(page).toHaveURL(/\/tickets\/checkout/);
  });

  test('refuses a malformed email and keeps what was typed', async ({ page }) => {
    await openForm(page);
    await page.getByLabel('Attendee name').fill('Ada Lovelace');
    await page.getByLabel('Email address').first().fill('not-an-email');
    await answerQuestions(page);
    await page.locator('form.checkout button.btn-primary').click();
    await expect(alert(page)).toContainText(/valid email/i);
    await expect(page.getByLabel('Attendee name')).toHaveValue('Ada Lovelace');
  });

  test('refuses two attendees on one address', async ({ page }) => {
    await openForm(page, 2);
    const shared = fakeEmail('dup');
    await page.getByLabel('Attendee name').fill('Ada Lovelace');
    await page.getByLabel('Email address').first().fill(shared);
    await page.locator('input[name="seatName"]').first().fill('Grace Hopper');
    await page.locator('input[name="seatEmail"]').first().fill(shared.toUpperCase());
    await answerQuestions(page);
    await page.locator('form.checkout button.btn-primary').click();
    await expect(alert(page)).toContainText(/appears twice/i);
  });

  test('refuses an extra attendee with no name', async ({ page }) => {
    await openForm(page, 2);
    await page.getByLabel('Attendee name').fill('Ada Lovelace');
    await page.getByLabel('Email address').first().fill(fakeEmail('a'));
    await page.locator('input[name="seatEmail"]').first().fill(fakeEmail('b'));
    await answerQuestions(page);
    await page.locator('form.checkout button.btn-primary').click();
    await expect(alert(page)).toContainText(/Attendee 2/);
  });

  test('refuses a tier id that does not exist, even when posted directly', async ({ page }) => {
    await openForm(page);
    await page.getByLabel('Attendee name').fill('Mallory Example');
    await page.getByLabel('Email address').first().fill(fakeEmail('forged'));
    // Last, and on the input that is actually posted: the checked radio, or the
    // hidden input when the tier is locked. React writes a controlled input's
    // value back on every render, so a forgery made before typing is undone by
    // the typing, and this test used to walk straight through to Stripe.
    await page
      .locator('input[type="radio"][name="tier"]:checked, input[type="hidden"][name="tier"]')
      .first()
      .evaluate((i) => ((i as HTMLInputElement).value = 'free-ticket'));
    await page.locator('form.checkout button.btn-primary').click();
    await expect(alert(page)).toContainText(/Choose a ticket type/i);
  });

  test('hands off to Stripe for the right amount, with the email filled in', async ({ page }) => {
    const tier = await openForm(page);
    const cents = await total(page);
    const email = fakeEmail('stripe');
    await page.locator('form.checkout').evaluate((f) => f.removeAttribute('novalidate'));
    await page.getByLabel('Attendee name').fill('Prepublish Check');
    await page.getByLabel('Email address').first().fill(email);
    await answerQuestions(page);
    await page.locator('form.checkout button.btn-primary').click();
    await expect(page.locator('form.checkout button.btn-primary')).toHaveText(/Redirecting/);

    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
    await expect(page.getByText(`KGC 2027: ${tier.name}`).first()).toBeVisible({ timeout: 20_000 });
    const body = await page.locator('body').innerText();
    const shown = parsePrice(body);
    expect(shown, 'Stripe shows the same amount the site showed').toBe(cents);
    expect(body).toContain(email);
  });

  test('completes a purchase with the Stripe test card @pay', async ({ page }) => {
    test.skip(process.env.PREPUBLISH_PAY !== '1', 'set PREPUBLISH_PAY=1 to pay with the 4242 test card');
    test.setTimeout(120_000);
    const tier = await openForm(page);
    const email = fakeEmail('paid');
    await page.locator('form.checkout').evaluate((f) => f.removeAttribute('novalidate'));
    await page.getByLabel('Attendee name').fill('Prepublish Paid');
    await page.getByLabel('Email address').first().fill(email);
    await answerQuestions(page);
    await page.locator('form.checkout button.btn-primary').click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

    // Refuse to go further on a live key. The badge is Stripe's own.
    await expect(page.getByText(/test mode/i).first(), 'Stripe must be in TEST MODE to pay').toBeVisible({ timeout: 20_000 });

    await page.locator('#cardNumber').fill('4242 4242 4242 4242');
    await page.locator('#cardExpiry').fill('12 / 34');
    await page.locator('#cardCvc').fill('123');
    await page.locator('#billingName').fill('Prepublish Paid');
    await page.locator('#billingCountry').selectOption('US').catch(() => {});
    await page.locator('#billingAddressLine1').fill('41 Cooper Square').catch(() => {});
    await page.locator('#billingLocality').fill('New York').catch(() => {});
    await page.locator('#billingPostalCode').fill('10003').catch(() => {});
    await page.locator('#billingAdministrativeArea').selectOption('NY').catch(() => {});
    await page.locator('[data-testid="hosted-payment-submit-button"], .SubmitButton').first().click();

    await page.waitForURL(/\/order\//, { timeout: 60_000 });
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('body')).toContainText('Prepublish Paid');
    await expect(page.locator('body')).toContainText(tier.name);
  });
});
