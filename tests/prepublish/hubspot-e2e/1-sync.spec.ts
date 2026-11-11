import { mkdirSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { BACKFILL_N, MULTI, MULTI_EMAIL, ORDER_EMAIL, ORDER_ID, ORDER_REG, OWNER, bfEmail, personKey } from './people';
import {
  FAKE_TOKEN,
  PAGE,
  PATHS,
  REFUSED_TOKEN,
  SHOTS,
  counts,
  dumpFirestore,
  fakeMode,
  fakeReset,
  fakeState,
  fsDelete,
  fsGet,
  fsList,
  fsPatch,
  fsSet,
  kick,
  logRow,
  mappingReady,
  openHubspot,
  recordBodies,
  sealedUnderAnotherKey,
  shotBoth,
  signedIn,
  watch,
  writesFor,
} from './helpers';

/**
 * The owner's whole HubSpot story on the real screen (a production build),
 * against the strict fake: connect, map, create the KGC properties, switch on,
 * a paid order, refunds for a person with two tickets, Sync all now, and the
 * ways HubSpot fails. One browser context for the lot, so every body it
 * received can be searched for the token at the end.
 *
 * T334 repro ids are named in the test titles: H-1 / D-15 (Save feedback),
 * D-11 (scopes), D-23 (hang), D-12 (mapping choices), X1 (several tickets),
 * X2 (no batch/upsert), and the should-fix items on bad batches and refused
 * tokens.
 */

test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let page: Page;
let bodies: string[];
let errors: string[];
const Y = '2027';
const SCHEMA_SCOPES = 'crm.schemas.contacts.read and crm.schemas.contacts.write';
/** apps/organizer/.../hubspot-connection-guide/copy.ts UNREADABLE_TOKEN. */
const UNREADABLE =
  "The saved token can't be read on this server. Its encryption key (WEB_ORDER_SECRET) differs from the one it was saved with. Paste the token again.";
const SAVED_ON = 'Saved. The sync is on: new orders, refunds, ticket changes and check-ins now go to HubSpot.';

const extraReg = (id: string, email: string, name: string) =>
  fsSet(`registrations/${id}`, {
    eventId: 'kgc-2027',
    email,
    emailHash: 'x',
    altEmails: [],
    name,
    company: 'Edge Cases Inc',
    title: 'Tester',
    ticketType: 'Virtual Pass',
    status: 'active',
  });

async function reload() {
  await page.goto(PAGE);
  await expect(page.getByRole('heading', { name: 'Sync log' })).toBeVisible();
}

/** The vertical gap between the bottom of a button and the top of a result shown under it. */
async function gapBelow(button: ReturnType<Page['getByRole']>, result: ReturnType<Page['getByRole']>): Promise<number> {
  const b = (await button.boundingBox())!;
  const r = (await result.boundingBox())!;
  return r.y - (b.y + b.height);
}

const status = (text: string | RegExp) => page.getByRole('status').filter({ hasText: text });
const alert = (text: string | RegExp) => page.getByRole('alert').filter({ hasText: text });
/**
 * Leave the screen before changing the fake: the mapping loads lazily after
 * every page load, and a load still in flight would take a one-shot fake mode
 * (or add a request) meant for the sync.
 */
async function idle() {
  await page.goto('about:blank');
}
const contact = async (email: string) => (await fakeState()).contacts[email];

test.beforeAll(async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  await fakeReset();
  for (const d of ['hubspot', 'hubspotSecret', 'hubspotLock']) await fsDelete(`integrations/${d}`);
  for (const r of await fsList('integrations/hubspot/runs')) await fsDelete(`integrations/hubspot/runs/${r.id}`);
  for (const q of await fsList('hubspotQueue')) await fsDelete(`hubspotQueue/${q.id}`);
  ctx = await signedIn(browser, OWNER);
  bodies = recordBodies(ctx);
  page = await openHubspot(ctx);
  errors = watch(page);
});

test.afterAll(async () => {
  await fakeMode('ok');
  await ctx?.close();
});

test('connect: a malformed, a refused and a token missing the schema scopes are not saved (D-11); the fake token is', async () => {
  await expect(page.getByText('Not connected')).toBeVisible();
  const box = page.getByLabel('Private app access token');
  const save = page.getByRole('button', { name: 'Save and test' });

  await box.fill('not-a-token');
  await save.click();
  await expect(alert('That is not a HubSpot access token.')).toBeVisible();

  await box.fill(REFUSED_TOKEN);
  await save.click();
  await expect(alert('HubSpot refused this token. Check that you copied the whole token')).toBeVisible();
  expect(await fsGet('integrations/hubspotSecret')).toBeNull();

  // An app made without the two schema scopes: HubSpot takes the token, the screen names what is missing and keeps nothing.
  await fakeMode('ok', { scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'] });
  await box.fill(FAKE_TOKEN);
  await save.click();
  const missing = alert(`the app is missing these scopes: ${SCHEMA_SCOPES}.`);
  await expect(missing).toBeVisible();
  await expect(missing).toContainText('The token was not saved.');
  expect(await gapBelow(save, missing)).toBeLessThan(120);
  expect(await fsGet('integrations/hubspotSecret')).toBeNull();
  await expect(page.getByText('Not connected')).toBeVisible();

  await fakeMode('ok');
  await box.fill(FAKE_TOKEN);
  await save.click();
  await expect(status('Connected to HubSpot account 4242424. Turn the sync on under Field mapping when you are ready.')).toBeVisible();
  await expect(page.getByText('Sync off')).toBeVisible();
  await expect(page.getByText('pat-****-****0001')).toBeVisible();
  await expect(page.getByText('4242424', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Replace the access token')).toHaveValue('');

  const secret = await fsGet('integrations/hubspotSecret');
  expect(String(secret?.sealed)).toMatch(/^v1\./);
  const config = await fsGet('integrations/hubspot');
  expect(config?.tokenLast4).toBe('0001');
  expect(config?.connectedBy).toBe(OWNER);

  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(status('HubSpot accepted the token, and it has all four scopes.')).toBeVisible();
  await mappingReady(page);
  await shotBoth(page, '01-connected');
});

test('Test connection names the two schema scopes when the app lacks them (D-11)', async () => {
  await fakeMode('ok', { scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'] });
  const test1 = page.getByRole('button', { name: 'Test connection' });
  await test1.click();
  const missing = alert(`HubSpot accepted the token, but the app is missing these scopes: ${SCHEMA_SCOPES}.`);
  await expect(missing).toBeVisible();
  await expect(missing).toContainText('then press Test connection again.');
  expect(await gapBelow(test1, missing)).toBeLessThan(120);
  // Not a refusal: the sync is not paused for it.
  expect((await fsGet('integrations/hubspot'))?.tokenRejectedAt).toBeUndefined();
  await fakeMode('ok');
  await test1.click();
  await expect(status('HubSpot accepted the token, and it has all four scopes.')).toBeVisible();
});

test('map: the mapping loads after the page; Checked in never offers a consent property, Amount paid never Annual Revenue (D-12)', async () => {
  await reload();
  await mappingReady(page);
  await expect(page.locator('#map-firstName')).toHaveValue('firstname');
  await expect(page.locator('#map-ticketType')).toHaveValue('');

  // The fake's portal really has both traps: a custom consent checkbox and HubSpot's own Annual Revenue.
  const props = (await fakeState()).properties;
  expect(props.find((p) => p.name === 'newsletter_opt_in')).toMatchObject({ type: 'enumeration', fieldType: 'booleancheckbox', hubspotDefined: false });
  expect(props.find((p) => p.name === 'annualrevenue')).toMatchObject({ type: 'number', hubspotDefined: true });

  await page.getByRole('button', { name: 'Create KGC properties' }).click();
  await expect(status('Created 7 properties in HubSpot.')).toBeVisible();
  const names = (await fakeState()).properties.map((p) => p.name);
  for (const n of ['ticket', 'order_date', 'amount', 'attendance', 'promo_code', 'checked_in', 'status']) expect(names).toContain(`kgc_${Y}_${n}`);

  // The table reloads in place with the new properties mapped.
  await expect(page.locator('#map-ticketType')).toHaveValue(`kgc_${Y}_ticket`);
  await expect(page.locator('#map-registrationStatus')).toHaveValue(`kgc_${Y}_status`);
  await expect(page.locator('#map-amount')).toHaveValue(`kgc_${Y}_amount`);
  await expect(page.locator('#map-checkedIn')).toHaveValue(`kgc_${Y}_checked_in`);

  await expect(page.locator('#map-checkedIn option[value="newsletter_opt_in"]')).toHaveCount(0);
  await expect(page.locator('#map-checkedIn option', { hasText: 'Newsletter' })).toHaveCount(0);
  await expect(page.locator('#map-amount option[value="annualrevenue"]')).toHaveCount(0);
  await expect(page.locator('#map-amount option', { hasText: 'Annual Revenue' })).toHaveCount(0);
  await expect(page.locator('#map-amount option[value="date_of_birth"]')).toHaveCount(0);
  await expect(page.locator('#map-orderDate option[value="date_of_birth"]')).toHaveCount(0);
  await expect(page.locator('#map-ticketType option[value="phone"]')).toHaveCount(0);
  await expect(page.locator('#map-firstName option[value="company"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Create KGC properties' }).click();
  await expect(status('All the KGC properties were already in HubSpot.')).toBeVisible();
});

test('Save shows its confirmation under Save and it stays there on the production build (H-1, D-15)', async () => {
  await reload();
  await mappingReady(page);
  await page.getByRole('radio', { name: 'Always overwrite' }).check();
  await page.getByRole('checkbox', { name: /^Enabled/ }).check();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await save.click();
  const done = status(SAVED_ON);
  await expect(done).toBeVisible();
  expect(await gapBelow(save, done)).toBeLessThan(120);
  // T334 saw it for 16 ms: the page refresh after the save remounted the form. Still there after the refresh settles.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await expect(done).toBeVisible();
  await expect(page.getByText('Sync on')).toBeVisible();
  await shotBoth(page, '02-mapping-saved', page.getByRole('checkbox', { name: /^Enabled/ }));

  const config = await fsGet('integrations/hubspot');
  expect(config?.enabled).toBe(true);
  expect(config?.mode).toBe('overwrite');
  expect((config?.propertyTypes as Record<string, string>)[`kgc_${Y}_amount`]).toBe('number');

  // Saving again with the sync already on says so briefly; the long sentence is for switching on.
  await save.click();
  await expect(status(/^Saved\. The sync is on\.$/)).toBeVisible();
});

test('a refused save shows "Nothing was saved." next to Save, and nothing changes (D-15)', async () => {
  await reload();
  await mappingReady(page);
  const before = await fsGet('integrations/hubspot');
  // Promo code into the property Ticket type already uses.
  await page.locator('#map-promoCode').selectOption(`kgc_${Y}_ticket`);
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await save.click();
  const refused = alert('Nothing was saved. Fix the mapping:');
  await expect(refused).toBeVisible();
  expect(await gapBelow(save, refused)).toBeLessThan(120);
  await expect(page.getByRole('alert').filter({ hasText: 'Promo code' })).toBeVisible();
  await expect(refused).toBeInViewport();
  expect(await fsGet('integrations/hubspot')).toEqual(before);
});

test('a refused save with several problems lists them one under another at 1280 and 390 (T336 D L1)', async () => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await reload();
    await mappingReady(page);
    // Two fields into the property Ticket type already uses: two problems.
    await page.locator('#map-promoCode').selectOption(`kgc_${Y}_ticket`);
    await page.locator('#map-attendance').selectOption(`kgc_${Y}_ticket`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const items = page.locator('ul.hubspot-problems > li');
    await expect(items).toHaveCount(2);
    const boxes = await items.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
    // Stacked: the second starts below the first, at the same left edge, and neither is squeezed into a column.
    expect(boxes[1].y, `width ${width}`).toBeGreaterThanOrEqual(boxes[0].y + boxes[0].h - 1);
    expect(Math.abs(boxes[1].x - boxes[0].x), `width ${width}`).toBeLessThan(2);
    const list = await page.locator('ul.hubspot-problems').evaluate((e) => getComputedStyle(e).display);
    expect(list).toBe('block');
    for (const b of boxes) expect(b.w, `width ${width}`).toBeGreaterThan(width === 390 ? 200 : 400);
    await page.locator('ul.hubspot-problems').evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${SHOTS}/06-save-refused-list-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await reload();
});

test('a paid order syncs: read by email, then create; never batch/upsert (X2)', async () => {
  kick('order', ORDER_REG);
  const c = await contact(ORDER_EMAIL);
  expect(c, 'contact in the fake').toBeTruthy();
  expect(c.properties).toMatchObject({
    lifecyclestage: 'lead',
    firstname: 'Ada',
    lastname: 'Lovelace',
    company: 'Graph Labs',
    jobtitle: 'Engineer',
    [`kgc_${Y}_ticket`]: 'Main Conference',
    [`kgc_${Y}_amount`]: '719.1',
    [`kgc_${Y}_attendance`]: 'In person',
    [`kgc_${Y}_promo_code`]: 'EARLYBIRD',
    [`kgc_${Y}_checked_in`]: 'false',
    [`kgc_${Y}_status`]: 'Registered',
  });
  expect(c.properties[`kgc_${Y}_order_date`]).toBeTruthy();
  expect(c.properties).not.toHaveProperty('hs_marketable_status');
  expect(await fsGet(`hubspotQueue/${personKey(ORDER_EMAIL)}`)).toBeNull();

  const s = await fakeState();
  const reads = s.requests.filter((r) => r.path === PATHS.read);
  expect(reads.at(-1)?.body?.idProperty).toBe('email');
  expect(s.requests.filter((r) => r.path === PATHS.create && r.status === 201)).toHaveLength(1);
  expect(s.requests.filter((r) => r.path === PATHS.upsert)).toEqual([]);

  await reload();
  await expect(logRow(page, 'New order')).toHaveCount(1);
  expect(await counts(page, 'New order')).toEqual([1, 1, 0, 0, 0]);
  await expect(logRow(page, 'New order').getByRole('cell').nth(2)).toHaveText('Automatic');
});

test('a refund updates the contact by id: status becomes Refunded', async () => {
  await fsPatch(`orders/${ORDER_ID}`, { status: 'refunded', refundedCents: 71910 });
  await fsPatch(`registrations/${ORDER_REG}`, { status: 'cancelled' });
  const id = (await contact(ORDER_EMAIL)).id;
  kick('refund', ORDER_REG);
  const s = await fakeState();
  const c = s.contacts[ORDER_EMAIL];
  expect(c.properties[`kgc_${Y}_status`]).toBe('Refunded');
  expect(c.properties.lifecyclestage).toBe('lead');
  const upd = s.requests.filter((r) => r.path === PATHS.update && r.status === 200).at(-1);
  expect(upd?.body?.inputs?.[0]?.id).toBe(id);
  await reload();
  expect(await counts(page, 'Refund')).toEqual([1, 0, 1, 0, 0]);
});

test('one person with two tickets: refunding one leaves the contact Registered, refunding the last makes it Refunded (X1)', async () => {
  kick('order', MULTI[0].reg, MULTI[1].reg);
  let c = await contact(MULTI_EMAIL);
  expect(c.properties).toMatchObject({
    [`kgc_${Y}_status`]: 'Registered',
    [`kgc_${Y}_ticket`]: 'Main Conference, Virtual Pass',
    [`kgc_${Y}_amount`]: '998',
  });
  const id = c.id;
  await reload();
  expect(await counts(page, 'New order')).toEqual([1, 1, 0, 0, 0]); // one person, one contact

  // Refund the first order in full, as charge.refunded does.
  await fsPatch(`orders/${MULTI[0].order}`, { status: 'refunded', refundedCents: MULTI[0].cents });
  await fsPatch(`registrations/${MULTI[0].reg}`, { status: 'cancelled' });
  kick('refund', MULTI[0].reg);
  c = await contact(MULTI_EMAIL);
  expect(c.id).toBe(id);
  expect(c.properties[`kgc_${Y}_status`]).toBe('Registered');
  expect(c.properties[`kgc_${Y}_ticket`]).toBe('Virtual Pass');
  expect(c.properties[`kgc_${Y}_attendance`]).toBe('Virtual');

  await fsPatch(`orders/${MULTI[1].order}`, { status: 'refunded', refundedCents: MULTI[1].cents });
  await fsPatch(`registrations/${MULTI[1].reg}`, { status: 'cancelled' });
  kick('refund', MULTI[1].reg);
  const s = await fakeState();
  c = s.contacts[MULTI_EMAIL];
  expect(c.id).toBe(id);
  expect(c.properties[`kgc_${Y}_status`]).toBe('Refunded');
  expect(Object.values(s.contacts).filter((x) => x.properties.email === MULTI_EMAIL)).toHaveLength(1);
  expect(writesFor(s, MULTI_EMAIL)).toBe(3);
});

test(`Sync all now queues every person once and sends them (${BACKFILL_N + 2} people)`, async () => {
  const people = BACKFILL_N + 2; // the backfill, Ada, and the two-ticket person once
  await reload();
  await page.getByRole('button', { name: 'Sync all now' }).click();
  await expect(status(`Queued ${people} people, one HubSpot contact each.`)).toBeVisible();
  await expect
    .poll(async () => (await fsList('integrations/hubspot/runs')).filter((r) => r.trigger === 'manual').length, { timeout: 120_000 })
    .toBe(1);
  const s = await fakeState();
  const missing = Array.from({ length: BACKFILL_N }, (_, i) => bfEmail(i)).filter((e) => !s.contacts[e]);
  expect(missing).toEqual([]);
  expect(s.contacts[bfEmail(1)].properties).toMatchObject({ [`kgc_${Y}_ticket`]: 'Virtual Pass', [`kgc_${Y}_attendance`]: 'Virtual', lifecyclestage: 'lead' });
  // Batches of at most 100, and nothing ever asked of batch/upsert.
  const creates = s.requests.filter((r) => r.path === PATHS.create && r.status === 201);
  expect(Math.max(...creates.map((r) => r.body?.inputs?.length ?? 0))).toBeLessThanOrEqual(100);
  expect(s.requests.filter((r) => r.path === PATHS.upsert)).toEqual([]);
  // The two-ticket person is still Refunded: their contact was built from both tickets, not the last one read.
  expect(s.contacts[MULTI_EMAIL].properties[`kgc_${Y}_status`]).toBe('Refunded');
  expect(await fsList('hubspotQueue')).toHaveLength(0);

  await reload();
  await expect(logRow(page, 'Sync all now')).toHaveCount(1);
  // Ada and the two-ticket person are already up to date, so they are skipped.
  expect(await counts(page, 'Sync all now')).toEqual([BACKFILL_N, BACKFILL_N, 0, 2, 0]);
  await expect(logRow(page, 'Sync all now').getByRole('cell').nth(2)).toHaveText(OWNER);
  await expect(page.getByText('Waiting to send').locator('xpath=..')).toContainText('0');
});

test('a rate limit is waited out: the contact still arrives and the run did not stop', async () => {
  await idle();
  await extraReg('reg_e2e_rate', 'rate.limit@example.com', 'Rate Limit');
  await fakeMode('rate-limit-once');
  kick('order', 'reg_e2e_rate');
  const s = await fakeState();
  // The 429 was the sync's own (a contact read or write), and was retried after HubSpot's 10 s window.
  const limited = s.requests.filter((r) => r.status === 429);
  expect(limited.map((r) => r.path)).toEqual([PATHS.read]);
  const retried = s.requests.find((r) => r.path === PATHS.read && r.at > limited[0].at);
  expect(retried!.at - limited[0].at).toBeGreaterThan(7000);
  expect(s.contacts['rate.limit@example.com']).toBeTruthy();
  await reload();
  const row = logRow(page, 'New order').first();
  await expect(row).not.toContainText('Stopped');
  expect(await counts(page, 'New order')).toEqual([1, 1, 0, 0, 0]);
});

test('an outage stops the run with a message, and the person stays queued', async () => {
  await idle();
  await extraReg('reg_e2e_down', 'outage@example.com', 'Out Age');
  await fakeMode('down');
  kick('order', 'reg_e2e_down');
  const q = await fsGet(`hubspotQueue/${personKey('outage@example.com')}`);
  expect(q, 'still queued').toBeTruthy();
  expect(q?.attempts).toBe(1);
  expect(String(q?.lastError)).toContain('HubSpot had a problem on its side (HTTP 500)');
  expect((await fakeState()).contacts['outage@example.com']).toBeUndefined();

  await fakeMode('ok');
  await reload();
  const row = logRow(page, 'New order').first();
  await expect(row).toContainText('Stopped: HubSpot had a problem on its side (HTTP 500).');
  await expect(row).toContainText('Waiting contacts are retried automatically.');
  await expect(page.getByText('Waiting to send').locator('xpath=..')).toContainText('1');
});

test('one bad address in a batch HubSpot answers 400 (strict400): the others are sent and the log names that address', async () => {
  await idle();
  await extraReg('reg_e2e_bad', 'bad.address@example.com', 'Bad Address');
  await extraReg('reg_e2e_good', 'good.address@example.com', 'Good Address');
  await extraReg('reg_e2e_good2', 'good.two@example.com', 'Good Two');
  await fakeMode('ok', { badEmails: ['bad.address@example.com'], strict400: true });
  kick('order', 'reg_e2e_bad', 'reg_e2e_good', 'reg_e2e_good2');
  const s = await fakeState();
  expect(s.requests.some((r) => r.path === PATHS.create && r.status === 400)).toBe(true);
  expect(s.contacts['good.address@example.com']).toBeTruthy();
  expect(s.contacts['good.two@example.com']).toBeTruthy();
  expect(s.contacts['bad.address@example.com']).toBeUndefined();
  const q = await fsGet(`hubspotQueue/${personKey('bad.address@example.com')}`);
  expect(q?.attempts).toBe(1);
  expect(q?.failed).toBe(false);
  expect(await fsGet(`hubspotQueue/${personKey('good.address@example.com')}`)).toBeNull();

  await fakeMode('ok');
  await reload();
  const row = logRow(page, 'New order').first();
  expect(await counts(page, 'New order')).toEqual([2, 2, 0, 0, 1]);
  await expect(row).not.toContainText('Stopped');
  await expect(row.getByText('bad.address@example.com')).toBeHidden();
  await row.getByText('1 contact', { exact: true }).click();
  await expect(row.getByRole('listitem')).toContainText('bad.address@example.com:');
  await expect(row.getByRole('listitem')).toContainText('Email address bad.address@example.com is invalid');
  await shotBoth(page, '03-log', page.getByRole('heading', { name: 'Sync', exact: true }));
});

test('a refused token pauses the sync with a banner; changes made meanwhile queue and go out after Test connection succeeds', async () => {
  await idle();
  await extraReg('reg_e2e_refused', 'refused@example.com', 'Re Fused');
  await fakeMode('invalid-token');
  kick('order', 'reg_e2e_refused');
  const config = await fsGet('integrations/hubspot');
  expect(typeof config?.tokenRejectedAt).toBe('number');
  expect(await fsGet(`hubspotQueue/${personKey('refused@example.com')}`)).toBeTruthy();

  await reload();
  await expect(page.getByText('Token refused')).toBeVisible();
  await expect(page.getByText(/HubSpot refused the saved token on .+ Paste a new token below, or press Test connection if you fixed it in HubSpot\./)).toBeVisible();
  await expect(page.getByText('Changes keep queueing and go out once a new token is saved or Test connection succeeds.')).toBeVisible();
  await expect(logRow(page, 'New order').first()).toContainText('Stopped: HubSpot refused the access token.');
  await expect(page.getByRole('button', { name: 'Sync all now' })).toBeDisabled();
  await expect(page.getByText('HubSpot refused the saved token. Paste a new one or press Test connection first.')).toBeVisible();
  await expect(page.getByText('The field mapping loads once HubSpot accepts the token.')).toBeVisible();
  await expect(page.getByText(UNREADABLE)).toHaveCount(0);
  await shotBoth(page, '04-refused');

  // While refused, a new order is queued but nothing reaches HubSpot (no run, so kick gives up after its short wait).
  const before = (await fakeState()).requests.length;
  await extraReg('reg_e2e_paused', 'paused@example.com', 'Pau Sed');
  expect(() => kick('order', { timeoutMs: 4000 }, 'reg_e2e_paused')).toThrow();
  expect((await fakeState()).requests.length).toBe(before);
  expect(await fsGet(`hubspotQueue/${personKey('paused@example.com')}`)).toBeTruthy();

  await fakeMode('ok');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(status('HubSpot accepted the token, and it has all four scopes.')).toBeVisible();
  // Both waiting people go out without anybody pressing Sync all now.
  await expect.poll(async () => Boolean((await contact('refused@example.com')) && (await contact('paused@example.com'))), { timeout: 60_000 }).toBe(true);
  expect(await fsGet(`hubspotQueue/${personKey('paused@example.com')}`)).toBeNull();
  await reload();
  await expect(page.getByText('Sync on')).toBeVisible();
  await expect(page.getByText(/HubSpot refused the saved token on/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sync all now' })).toBeEnabled();
  await expect(logRow(page, 'Retry').first()).toBeVisible();
});

test('an unreadable token (sealed under another WEB_ORDER_SECRET) says so, never "refused", and calls nobody', async () => {
  await idle();
  const good = (await fsGet('integrations/hubspotSecret'))?.sealed as string;
  await fsPatch('integrations/hubspotSecret', { sealed: sealedUnderAnotherKey(FAKE_TOKEN) });
  const before = (await fakeState()).requests.length;

  await reload();
  await expect(page.getByText('Token unreadable')).toBeVisible();
  await expect(page.getByText(UNREADABLE)).toBeVisible();
  await expect(page.getByText('Token refused')).toHaveCount(0);
  await expect(page.getByText(/HubSpot refused the saved token on/)).toHaveCount(0);
  await expect(page.getByText('The field mapping loads once the token is pasted again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync all now' })).toBeDisabled();
  await expect(page.getByText('Paste the token again first.')).toBeVisible();

  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(alert(UNREADABLE)).toBeVisible();
  await shotBoth(page, '05-unreadable');

  // A change while unreadable: the run stops with the key's problem, not HubSpot's.
  await extraReg('reg_e2e_unread', 'unreadable@example.com', 'Un Readable');
  kick('change', 'reg_e2e_unread');
  const config = await fsGet('integrations/hubspot');
  expect(typeof config?.tokenUnreadableAt).toBe('number');
  expect(config?.tokenRejectedAt).toBeUndefined();
  expect((await fakeState()).requests.length).toBe(before);
  await reload();
  await expect(logRow(page, 'Ticket change').first()).toContainText("can't be read on this server");
  await expect(page.getByText('Token refused')).toHaveCount(0);

  // Pasting the token again recovers, and the waiting change goes out.
  expect(good).toMatch(/^v1\./);
  await page.getByLabel('Replace the access token').fill(FAKE_TOKEN);
  await page.getByRole('button', { name: 'Save and test' }).click();
  await expect(status('Connected to HubSpot account 4242424.')).toBeVisible();
  await expect.poll(async () => Boolean(await contact('unreadable@example.com')), { timeout: 60_000 }).toBe(true);
  await reload();
  await expect(page.getByText('Sync on')).toBeVisible();
  await expect(page.getByText(UNREADABLE)).toHaveCount(0);
});

test('HubSpot hanging on the property list: the page, Disconnect and the log are there at once; the mapping errors with Retry within 15 s (D-23)', async () => {
  await fakeMode('ok', { hangPaths: [PATHS.properties] });
  const t0 = Date.now();
  await page.goto(PAGE);
  await expect(page.getByRole('heading', { name: 'Sync log' })).toBeVisible();
  expect(Date.now() - t0, 'page render time').toBeLessThan(5000);
  await expect(page.getByText('Loading the HubSpot contact properties…')).toBeVisible();

  // Disconnect opens its confirm, and the log's details expand, while the mapping is still loading.
  const disconnect = page.locator('summary', { hasText: 'Disconnect' });
  await disconnect.click();
  await expect(page.getByText('The token is deleted and the sync stops.')).toBeVisible();
  await disconnect.click();
  const details = page.locator('details').filter({ has: page.getByText('1 contact', { exact: true }) }).first();
  await details.locator('summary').click();
  await expect(details.getByRole('listitem').first()).toBeVisible();
  await expect(page.getByText('Loading the HubSpot contact properties…')).toBeVisible();

  const failed = alert('Could not load the HubSpot contact properties.');
  await expect(failed).toBeVisible({ timeout: 15_000 - (Date.now() - t0) });
  await expect(failed).toContainText('HubSpot did not answer in time.');
  expect(Date.now() - t0).toBeLessThan(15_000);

  await fakeMode('ok');
  await failed.getByRole('button', { name: 'Retry' }).click();
  await mappingReady(page);
  await expect(page.locator('#map-ticketType')).toHaveValue(`kgc_${Y}_ticket`);
});

test('Disconnect answers on the screen and keeps the mapping and log', async () => {
  await reload();
  await page.locator('summary', { hasText: 'Disconnect' }).click();
  await page.getByRole('button', { name: 'Disconnect HubSpot' }).click();
  await expect(status('Disconnected. The token is deleted and the sync is off.')).toBeVisible();
  await expect(page.getByText('Not connected')).toBeVisible();
  expect(await fsGet('integrations/hubspotSecret')).toBeNull();
  const config = await fsGet('integrations/hubspot');
  expect(config?.enabled).toBe(false);
  expect((config?.mapping as Record<string, string>).ticketType).toBe(`kgc_${Y}_ticket`);
  await expect(logRow(page, 'Sync all now')).toHaveCount(1);
});

test('the token never reached the browser and is not stored in plain text', async () => {
  expect(bodies.length).toBeGreaterThan(10);
  const leaks = bodies.filter((b) => b.includes(FAKE_TOKEN) || b.includes(REFUSED_TOKEN)).map((b) => b.split('\n')[0]);
  expect(leaks).toEqual([]);
  const dump = await dumpFirestore();
  expect(dump.includes(FAKE_TOKEN)).toBe(false);
  expect(dump.includes(FAKE_TOKEN.slice(8))).toBe(false);
  expect(dump.includes(REFUSED_TOKEN)).toBe(false);
  // The fake keeps only whether the token matched, never the token, and never saw it in a URL.
  const s = await fakeState();
  expect(s.requests.some((r) => JSON.stringify(r).includes(FAKE_TOKEN))).toBe(false);
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});
