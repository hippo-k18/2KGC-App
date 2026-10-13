import { expect, test, type Page } from '@playwright/test';

/**
 * Pay by invoice, end to end, against a fake Stripe and a private Firestore
 * emulator. `run.sh` starts both and a dev server wired to them.
 *
 * The two cases the live gate cannot submit: a valid request that should
 * become a sent invoice and a pending order, and one Stripe refuses to
 * finalize, which must leave nothing behind in Stripe.
 */

const STRIPE = process.env.FAKE_STRIPE_URL ?? 'http://127.0.0.1:12111';
const FIRESTORE = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8097'}`;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'kgc-invoice-e2e';

interface FakeState {
  customers: Record<string, { email: string; address?: Record<string, string> }>;
  invoices: Record<string, { status: string; sent?: boolean; customer: string }>;
  calls: string[];
}

const fake = {
  state: async (): Promise<FakeState> => (await fetch(`${STRIPE}/__state`)).json(),
  mode: (finalize: 'ok' | 'tax-fail') =>
    fetch(`${STRIPE}/__mode`, { method: 'POST', body: JSON.stringify({ finalize }) }),
  reset: () => fetch(`${STRIPE}/__reset`, { method: 'POST' }),
};

async function orders(): Promise<{ fields: Record<string, { stringValue?: string }> }[]> {
  const res = await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/orders`, {
    headers: { Authorization: 'Bearer owner' },
  });
  return ((await res.json()) as { documents?: [] }).documents ?? [];
}

async function fillValid(page: Page, billingEmail: string) {
  await page.goto('/tickets/invoice');
  await page.locator('input[name="seatName"]').first().fill('Ada Nakamura');
  await page.locator('input[name="seatEmail"]').first().fill('ada@acme.example');
  await page.getByLabel('Company name').fill('Acme Corporation');
  await page.getByLabel('Billing email').fill(billingEmail);
  await page.getByLabel('Country').selectOption('US');
  await page.getByLabel('Street address').fill('1065 Avenue of the Americas');
  await page.getByLabel('City').fill('New York');
  await page.getByLabel('State', { exact: true }).fill('NY');
  await page.getByLabel('ZIP code').fill('10018');
  await page.getByLabel(/Purchase order/).fill('PO-E2E-1');
}

test.beforeEach(async () => {
  await fake.reset();
});

test('a valid request becomes a sent invoice, a pending order and the hosted page', async ({ page }) => {
  await fake.mode('ok');
  await fillValid(page, 'ap@acme.example');
  await page.getByRole('button', { name: 'Request invoice' }).click();

  await page.waitForURL(/\/hosted\/in_fake/);
  await expect(page.locator('h1')).toContainText('Fake hosted invoice');

  const s = await fake.state();
  const [customer] = Object.values(s.customers);
  expect(customer.email).toBe('ap@acme.example');
  expect(customer.address).toMatchObject({ line1: '1065 Avenue of the Americas', city: 'New York', state: 'NY', postal_code: '10018', country: 'US' });
  const [invoice] = Object.values(s.invoices);
  expect(invoice).toMatchObject({ status: 'open', sent: true });

  const mine = (await orders()).filter((o) => o.fields.email?.stringValue === 'ap@acme.example');
  expect(mine).toHaveLength(1);
  expect(mine[0].fields.status?.stringValue).toBe('pending');
  expect(mine[0].fields.channel?.stringValue).toBe('invoice');
});

test('a refused finalization deletes the draft and the new customer and tells the buyer', async ({ page }) => {
  await fake.mode('tax-fail');
  await fillValid(page, 'ap-fail@acme.example');
  await page.getByRole('button', { name: 'Request invoice' }).click();

  const alert = page.locator('form#invoice [role="alert"]');
  await expect(alert).toContainText(/could not confirm that billing address/);
  await expect(alert.getByRole('link', { name: 'contact@knowledgegraph.tech' })).toHaveAttribute(
    'href',
    'mailto:contact@knowledgegraph.tech',
  );
  // What was typed is still there.
  await expect(page.getByLabel('Street address')).toHaveValue('1065 Avenue of the Americas');

  const s = await fake.state();
  expect(s.calls).toEqual(
    expect.arrayContaining(['POST /v1/customers', 'POST /v1/invoices', expect.stringMatching(/^DELETE \/v1\/invoices\//), expect.stringMatching(/^DELETE \/v1\/customers\//)]),
  );
  expect(s.customers).toEqual({});
  expect(s.invoices).toEqual({});
  expect((await orders()).filter((o) => o.fields.email?.stringValue === 'ap-fail@acme.example')).toHaveLength(0);
});

test('a missing address is refused before Stripe is called', async ({ page }) => {
  await page.goto('/tickets/invoice');
  await page.locator('form#invoice').evaluate((f) => f.setAttribute('novalidate', ''));
  await page.locator('input[name="seatName"]').first().fill('Ada Nakamura');
  await page.locator('input[name="seatEmail"]').first().fill('ada@acme.example');
  await page.getByLabel('Company name').fill('Acme Corporation');
  await page.getByLabel('Billing email').fill('ap-none@acme.example');
  await page.getByRole('button', { name: 'Request invoice' }).click();
  await expect(page.locator('form#invoice [role="alert"]')).toContainText(/street address/);
  expect((await fake.state()).calls).toEqual([]);
});
