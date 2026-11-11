import { expect, test } from '@playwright/test';
import { MEMBERS, OWNER } from './people';
import {
  DASH,
  FAKE_TOKEN,
  PAGE,
  cookieFor,
  fakeMode,
  fakeState,
  formActionBody,
  fsGet,
  fsList,
  hubspotActions,
  openHubspot,
  postAction,
  signedIn,
} from './helpers';

/**
 * Only an owner may use the HubSpot screen (T333, T335). Finance can open
 * Tickets but not this one screen (team-core's except), and does not see a link
 * to it in the sidebar or on Export to AMS/CRM; agenda, check-in and learn
 * cannot open Tickets at all. For each, the page sends them away, and every one
 * of the screen's seven server actions, posted with its real id and a
 * well-formed body, is refused: Firestore does not change and no request
 * reaches the fake HubSpot. The owner's same requests are the control.
 */

test.describe.configure({ mode: 'serial' });

const ACTIONS = [
  'connectHubspotAction',
  'testHubspotAction',
  'disconnectHubspotAction',
  'saveHubspotSettingsAction',
  'createKgcPropertiesAction',
  'syncAllHubspotAction',
  'loadHubspotMappingAction',
];
const HUBSPOT_LINK = 'a[href="/tickets/hubspot-connection-guide"]';
const EXPORT_PAGE = '/tickets/export-to-ams-crm';

/** HUBSPOT_SOURCE_FIELDS' keys (the spec cannot import @kgc/shared's TypeScript). */
const FIELD_KEYS = ['firstName', 'lastName', 'company', 'jobTitle', 'ticketType', 'orderDate', 'amount', 'attendance', 'promoCode', 'checkedIn', 'registrationStatus'];

let ids: Map<string, string>;
let mapping: Record<string, string>;

function bodyFor(name: string): FormData | unknown[] {
  if (name === 'connectHubspotAction') return formActionBody({ token: FAKE_TOKEN });
  if (name === 'saveHubspotSettingsAction') {
    const fields: Record<string, string> = { mode: 'overwrite', enabled: 'on', createContacts: 'on', setLeadStage: 'on' };
    for (const k of FIELD_KEYS) fields[`map.${k}`] = mapping[k] ?? '';
    return formActionBody(fields);
  }
  return [];
}

/** The same request with a mapping that would clear every field, for a non-owner: a change would show. */
function hostileBodyFor(name: string): FormData | unknown[] {
  if (name !== 'saveHubspotSettingsAction') return bodyFor(name);
  const fields: Record<string, string> = { mode: 'fill-empty', createContacts: '', setLeadStage: '' };
  for (const k of FIELD_KEYS) fields[`map.${k}`] = '';
  return formActionBody(fields);
}

async function snapshot() {
  const fake = await fakeState();
  return JSON.stringify({
    config: await fsGet('integrations/hubspot'),
    secret: await fsGet('integrations/hubspotSecret'),
    lock: await fsGet('integrations/hubspotLock'),
    runs: (await fsList('integrations/hubspot/runs')).map((r) => r.id).sort(),
    queue: await fsList('hubspotQueue'),
    audit: (await fsList('auditLog')).length,
    fakeRequests: fake.requests.length,
    fakeContacts: Object.keys(fake.contacts).length,
    fakeProperties: fake.properties.length,
  });
}

test('the owner control: the same requests run each action', async ({ browser }) => {
  await fakeMode('ok');
  // The owner opens the page first, so a dev server has compiled its actions into the manifest.
  const ctx = await signedIn(browser, OWNER);
  await openHubspot(ctx);
  // The owner has the link, in the sidebar and on Export to AMS/CRM.
  const exp = await ctx.newPage();
  await exp.goto(EXPORT_PAGE);
  await expect(exp.getByRole('heading', { name: 'Native direct integration' })).toBeVisible();
  expect(await exp.locator(HUBSPOT_LINK).count()).toBeGreaterThanOrEqual(2);
  await ctx.close();
  ids = hubspotActions();
  expect([...ids.keys()].sort()).toEqual([...ACTIONS].sort());

  const connect = await postAction(OWNER, PAGE, ids.get('connectHubspotAction')!, bodyFor('connectHubspotAction'));
  expect(connect.body).toContain('Connected to HubSpot account 4242424.');
  mapping = ((await fsGet('integrations/hubspot'))?.mapping ?? {}) as Record<string, string>;
  const save = await postAction(OWNER, PAGE, ids.get('saveHubspotSettingsAction')!, bodyFor('saveHubspotSettingsAction'));
  expect(save.body).toMatch(/"ok":true/);
  const test1 = await postAction(OWNER, PAGE, ids.get('testHubspotAction')!, []);
  expect(test1.body).toContain('HubSpot accepted the token, and it has all four scopes.');
  const load = await postAction(OWNER, PAGE, ids.get('loadHubspotMappingAction')!, []);
  expect(load.body).toMatch(/"ok":true/);
  expect(load.body).toMatch(/"rows":\[\{"key"/);
  expect((await fsGet('integrations/hubspot'))?.enabled).toBe(true);
});

for (const [role, email] of Object.entries(MEMBERS)) {
  test(`${role}: the HubSpot page sends them away and every action is refused, nothing changes`, async ({ browser }) => {
    const before = await snapshot();
    const cookie = `kgc_console_session=${await cookieFor(email)}`;

    // The page, as a plain request: not the HubSpot screen.
    const r = await fetch(`${DASH}${PAGE}`, { redirect: 'manual', headers: { Cookie: cookie } });
    const html = await r.text();
    if (r.status >= 300 && r.status < 400) expect(new URL(r.headers.get('location')!, DASH).pathname).not.toBe(PAGE);
    expect(html).not.toContain('Private app access token');
    expect(html).not.toContain('Replace the access token');
    expect(html).not.toContain('pat-****');

    // And in a browser: it lands somewhere else, signed in.
    const ctx = await signedIn(browser, email);
    const page = await ctx.newPage();
    await page.goto(PAGE);
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).pathname).not.toBe(PAGE);
    expect(new URL(page.url()).pathname).not.toBe('/login');
    await expect(page.getByLabel('Replace the access token')).toHaveCount(0);
    const home = new URL(page.url()).pathname;
    // No HubSpot link anywhere they can see: not in the sidebar, not on Export to AMS/CRM.
    await expect(page.locator(HUBSPOT_LINK)).toHaveCount(0);
    if (role === 'finance') {
      expect(home.startsWith('/tickets/')).toBe(true);
      await page.goto(EXPORT_PAGE);
      await expect(page.getByRole('heading', { name: 'Native direct integration' })).toBeVisible();
      await expect(page.getByText('An owner sets it up.')).toBeVisible();
      await expect(page.locator(HUBSPOT_LINK)).toHaveCount(0);
    }
    await ctx.close();

    const rows: string[] = [];
    for (const name of ACTIONS) {
      for (const at of [PAGE, home]) {
        const res = await postAction(email, at, ids.get(name)!, hostileBodyFor(name));
        rows.push(`${role} ${name} at ${at}: ${res.status} ${res.location}`);
        expect(res.body, `${name} at ${at}`).not.toMatch(/"ok":true/);
        expect(res.body, `${name} at ${at}`).not.toMatch(/Connected to HubSpot|accepted the token|Queued \d+|Created \d+ propert|Saved\.|Disconnected\./);
        expect(res.body, `${name} at ${at}`).not.toMatch(/"rows":\[\{"key"|"options":\[\{"name"/);
      }
    }
    console.log(rows.join('\n'));
    expect(await snapshot()).toBe(before);
  });
}
