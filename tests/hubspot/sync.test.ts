/**
 * The HubSpot contact sync (T333, reworked in T335) end to end, short of a
 * browser: the real `scripts/src/lib/hubspot-*` code against the Firestore
 * emulator and the strict fake HubSpot in `fake-hubspot.mjs`. Every assertion
 * about what HubSpot was sent is made on the fake's recorded requests.
 *
 * Tests named after an id ("X1", "3.3", "5.5", "A-F2", ...) are the T334 gate's
 * repros (orchestrator/reports/T334.md and T334-shots/results/*.md), kept so
 * the bug they found cannot come back.
 *
 * Run with: npm run test:hubspot (a private emulator on 8197, project demo-hubspot).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  DOOR_CHECK_IN_LIST_ID,
  EVENT_ID,
  HUBSPOT_CONFIG_DEFAULT,
  HUBSPOT_MAX_ATTEMPTS,
  HUBSPOT_RUNS_KEPT,
  type HubspotConfig,
  type HubspotQueueItem,
  type HubspotRun,
} from '@kgc/shared';
import { ensureRegistration } from '../../scripts/src/lib/fulfilment.js';
import {
  HubspotError,
  createContactProperty,
  listContactProperties,
  testHubspotToken,
} from '../../scripts/src/lib/hubspot-client.js';
import { HUBSPOT_SCOPES, PARKED_AT, checkMapping, kgcPropertyDefs, mappableProperties } from '../../scripts/src/lib/hubspot-core.js';
import {
  drainHubspotQueue,
  enqueueAllRegistrations,
  enqueueHubspotEmails,
  enqueueHubspotRegistrations,
  hubspotPersonKey,
  listHubspotRuns,
  loadHubspotToken,
  markTokenAccepted,
  markTokenRejected,
  queueAndKickHubspot,
  queueCounts,
  readHubspotConfig,
  readHubspotTokenState,
  saveHubspotSettings,
  saveHubspotToken,
  savePropertyTypes,
} from '../../scripts/src/lib/hubspot-sync.js';
// @ts-expect-error plain JS module, no types
import { FAKE_HUBSPOT_TOKEN, PATHS, startFakeHubspot } from './fake-hubspot.mjs';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = 'demo-hubspot';
const TOKEN: string = FAKE_HUBSPOT_TOKEN;
/** Also made up: a token in the right shape that the fake does not accept. */
/** Built from parts at runtime so no source line looks like a HubSpot token to secret scanners. */
const OTHER_TOKEN = ['pat', 'na1', '00000000', '0000', '4000', '8000', '000000000002'].join('-');
const noWait = { sleep: async () => {} };
const P = PATHS as Record<'list' | 'read' | 'update' | 'create' | 'upsert' | 'properties' | 'tokenInfo', string>;

interface FakeRequest {
  method: string;
  path: string;
  body: any;
  authOk: boolean;
  authPresent: boolean;
  rawHadToken: boolean;
  status: number;
}
interface FakeContact {
  id: string;
  properties: Record<string, string | null>;
}
interface Fake {
  url: string;
  state: { requests: FakeRequest[]; contacts: Record<string, FakeContact>; properties: { name: string }[]; maxInflight: number };
  setMode(mode: string, opts?: Record<string, unknown>): void;
  setOptions(opts: Record<string, unknown>): void;
  reset(): void;
  seedContact(email: string, properties?: Record<string, string>, opts?: { additionalEmails?: string[] }): FakeContact;
  hold(path: string): { reached: Promise<void>; release(): void };
  calls(path: string): FakeRequest[];
  written(email: string): number;
  close(): Promise<void>;
}

let db: Firestore;
let fake: Fake;

beforeAll(async () => {
  if (!EMULATOR || !/^(127\.0\.0\.1|localhost):8197$/.test(EMULATOR)) {
    throw new Error('Run with npm run test:hubspot: these tests need the private Firestore emulator on 8197.');
  }
  fake = await startFakeHubspot({ port: 0 });
  process.env.HUBSPOT_API_BASE = fake.url;
  if (!getApps().length) initializeApp({ projectId: PROJECT });
  db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
});

afterAll(async () => {
  await fake?.close();
});

beforeEach(async () => {
  fake.reset();
  const res = await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
  await seedCatalogue();
});

afterEach(() => {
  // Whatever a test did, HubSpot never saw the read-only marketing status, a
  // request without a token, the token anywhere but the header (and the one
  // body HubSpot's token-info endpoint requires it in), or a batch/upsert.
  for (const r of fake.state.requests) {
    expect(r.authPresent).toBe(true);
    expect(JSON.stringify(r.body ?? '')).not.toContain('hs_marketable_status');
    if (r.path !== P.tokenInfo) expect(r.rawHadToken).toBe(false);
  }
  expect(JSON.stringify(fake.state)).not.toContain(TOKEN);
  expect(fake.calls(P.upsert)).toEqual([]);
  fake.reset(); // releases any hold a failed test left behind
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

const ORDER_DAY = Date.UTC(2026, 9, 3, 15, 0);

async function seedCatalogue() {
  const base = { eventId: EVENT_ID, currency: 'usd', includesVideoLibrary: false, includesWorkshops: false, tagline: '', includes: [] };
  await db.collection(COLLECTIONS.ticketTypes).doc('main-conference').set({ ...base, name: 'Main Conference', priceCents: 79_900, inPerson: true });
  await db.collection(COLLECTIONS.ticketTypes).doc('virtual').set({ ...base, name: 'Virtual Pass', priceCents: 19_900, inPerson: false });
  await db.collection(COLLECTIONS.ticketTypes).doc('workshops').set({ ...base, name: 'Workshops', priceCents: 29_900, inPerson: true });
  await db.collection(COLLECTIONS.checkInLists).doc(DOOR_CHECK_IN_LIST_ID).set({ eventId: EVENT_ID, name: 'Front door' });
}

const TIERS = { 'main-conference': 'Main Conference', virtual: 'Virtual Pass', workshops: 'Workshops' } as const;
type Tier = keyof typeof TIERS;

/**
 * One paid Checkout purchase: the registration through the real
 * `ensureRegistration`, the order in the shape the webhook writes.
 */
async function paidRegistrant(
  email: string,
  name: string,
  over: { company?: string; title?: string; promo?: string; totalCents?: number; checkedIn?: boolean; tier?: Tier; orderId?: string; purchasedAt?: number } = {},
): Promise<{ rid: string; orderId: string }> {
  const tier = over.tier ?? 'main-conference';
  const tierName = TIERS[tier];
  const orderId = over.orderId ?? `ord_${email.replace(/[^a-z0-9]/gi, '_')}`;
  const reg = await ensureRegistration(db, { email, name, ticketType: tierName, purchase: { orderId, seat: 0 } });
  const rid = reg.registrationId;
  const extra: Record<string, string> = {};
  if (over.company) extra.company = over.company;
  if (over.title) extra.title = over.title;
  if (Object.keys(extra).length) await db.collection(COLLECTIONS.registrations).doc(rid).update(extra);
  await db
    .collection(COLLECTIONS.orders)
    .doc(orderId)
    .set({
      eventId: EVENT_ID,
      externalId: `cs_test_${orderId}`,
      provider: 'stripe',
      channel: 'checkout',
      email: email.toLowerCase(),
      buyerName: name,
      status: 'paid',
      items: [{ ticketTypeId: tier, ticketTypeName: tierName, quantity: 1, unitPriceCents: 79_900, attendeeName: name, attendeeEmail: email.toLowerCase() }],
      totalCents: over.totalCents ?? 71_910,
      currency: 'usd',
      purchasedAt: Timestamp.fromMillis(over.purchasedAt ?? ORDER_DAY),
      ...(over.promo ? { promotionCode: over.promo } : {}),
      registrationIds: [rid],
    });
  if (over.checkedIn) await checkIn(rid);
  return { rid, orderId };
}

async function checkIn(rid: string) {
  await db
    .collection(COLLECTIONS.checkInLists)
    .doc(DOOR_CHECK_IN_LIST_ID)
    .collection('checkIns')
    .doc(rid)
    .set({ eventId: EVENT_ID, registrationId: rid, checkedInAt: new Date(ORDER_DAY + 86_400_000), stationName: 'Front desk 1' });
}

/** Registrations written directly, many at once (no orders). */
async function bulkRegistrations(rows: { id: string; email: string; name: string; ticketType: string; status?: string }[]) {
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    for (const r of rows.slice(i, i + 400)) {
      batch.set(db.collection(COLLECTIONS.registrations).doc(r.id), { eventId: EVENT_ID, email: r.email, name: r.name, ticketType: r.ticketType, status: r.status ?? 'active' });
    }
    await batch.commit();
  }
}

const KGC_MAPPING = {
  ...HUBSPOT_CONFIG_DEFAULT.mapping,
  ticketType: 'kgc_2027_ticket',
  orderDate: 'kgc_2027_order_date',
  amount: 'kgc_2027_amount',
  attendance: 'kgc_2027_attendance',
  promoCode: 'kgc_2027_promo_code',
  checkedIn: 'kgc_2027_checked_in',
  registrationStatus: 'kgc_2027_status',
};

/** What the dashboard does: test the token, save it, create our properties, save a checked mapping. */
async function connect(over: Partial<Pick<HubspotConfig, 'mode' | 'createContacts' | 'setLeadStage'>> = {}) {
  const check = await testHubspotToken(TOKEN, noWait);
  expect(check.missing).toEqual([]);
  await saveHubspotToken(db, TOKEN, 'organizer@example.com', check.portalId);
  for (const def of kgcPropertyDefs()) expect(await createContactProperty(TOKEN, def, noWait)).toBe('created');
  const props = mappableProperties(await listContactProperties(TOKEN, noWait));
  const checked = checkMapping(KGC_MAPPING, props);
  if (!checked.ok) throw new Error(checked.problems.join(' '));
  await savePropertyTypes(db, Object.fromEntries(Object.values(checked.mapping).map((n) => [n!, props.find((p) => p.name === n)!.type])));
  await saveHubspotSettings(
    db,
    { enabled: true, mapping: checked.mapping, mode: 'fill-empty', createContacts: true, setLeadStage: true, ...over },
    'organizer@example.com',
  );
  fake.state.requests.length = 0;
}

const queueRef = (email: string) => db.collection(COLLECTIONS.hubspotQueue).doc(hubspotPersonKey(email));
const queueDoc = async (email: string) => (await queueRef(email).get()).data() as HubspotQueueItem | undefined;
const queueSize = async () => (await db.collection(COLLECTIONS.hubspotQueue).get()).size;
const contact = (email: string) => fake.state.contacts[email.toLowerCase()]?.properties;
const calls = (path: string) => fake.calls(path);
const runsCount = async () => (await db.collection(COLLECTIONS.integrations).doc('hubspot').collection('runs').get()).size;

/** The drain a trigger starts runs in the background; wait (capped) for its run to land in the log. */
async function waitForRuns(n: number, ms = 10_000): Promise<HubspotRun[]> {
  const until = Date.now() + ms;
  let runs: HubspotRun[] = [];
  while (Date.now() < until) {
    runs = await listHubspotRuns(db);
    if (runs.length >= n) return runs;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waited ${ms} ms for ${n} run(s), saw ${runs.length}`);
}

/** A hold's arrival, capped so a request that never comes fails fast instead of hanging the suite. */
async function arrived(h: { reached: Promise<void> }, ms = 10_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([h.reached, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`the held request did not arrive within ${ms} ms`)), ms)))]);
  clearTimeout(timer);
}

/** Wait until the background drain has let go of the lease. */
async function waitForIdle(ms = 10_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!(await db.collection(COLLECTIONS.integrations).doc('hubspotLock').get()).exists) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the drain did not finish');
}

// ---------------------------------------------------------------------------

describe('switched off', () => {
  it('queues and sends nothing when the sync is off or has no token', async () => {
    const { rid } = await paidRegistrant('ada@example.com', 'Ada Lovelace');

    // Nothing saved at all.
    expect(await enqueueHubspotRegistrations(db, [rid], 'order')).toBe(0);
    expect(await drainHubspotQueue(db, { trigger: 'order', client: noWait })).toBeNull();

    // Switched on, but no token.
    await saveHubspotSettings(db, { enabled: true }, 'organizer@example.com');
    expect(await enqueueHubspotRegistrations(db, [rid], 'order')).toBe(0);
    expect(await enqueueAllRegistrations(db)).toBe(0);

    // A token, but switched off.
    await saveHubspotSettings(db, { enabled: false }, 'organizer@example.com');
    await saveHubspotToken(db, TOKEN, 'organizer@example.com');
    expect(await enqueueHubspotRegistrations(db, [rid], 'order')).toBe(0);
    const report = vi.fn();
    await queueAndKickHubspot(db, [rid], 'order', report);
    expect(report).not.toHaveBeenCalled();
    expect(await drainHubspotQueue(db, { trigger: 'manual', client: noWait })).toBeNull();

    expect(await queueSize()).toBe(0);
    expect(fake.state.requests).toEqual([]);
  });
});

describe('the token', () => {
  it('is stored sealed, never as plain text', async () => {
    await saveHubspotToken(db, `  ${TOKEN}  `, 'organizer@example.com', 4242424);
    const all = await db.collection(COLLECTIONS.integrations).get();
    expect(all.size).toBe(2);
    for (const d of all.docs) expect(JSON.stringify(d.data())).not.toContain(TOKEN);
    const secret = (await db.collection(COLLECTIONS.integrations).doc('hubspotSecret').get()).data()!;
    expect(String(secret.sealed).startsWith('v1.')).toBe(true);
    const cfg = await readHubspotConfig(db);
    expect(cfg).toMatchObject({ hasToken: true, tokenLast4: '0001', portalId: 4242424, connectedBy: 'organizer@example.com' });
    expect(await loadHubspotToken(db)).toBe(TOKEN);
    expect(await readHubspotTokenState(db)).toBe('ok');
  });

  it('B-2.7: a token this server cannot decrypt sets tokenUnreadableAt, not tokenRejectedAt, logs one run, and later drains do nothing', async () => {
    await connect();
    const { rid } = await paidRegistrant('ada@example.com', 'Ada Lovelace');
    expect(await enqueueHubspotRegistrations(db, [rid], 'order')).toBe(1);
    const saved = process.env.WEB_ORDER_SECRET;
    process.env.WEB_ORDER_SECRET = 'a-rotated-order-secret-0123456789';
    try {
      expect(await readHubspotTokenState(db)).toBe('unreadable');
      const run = await drainHubspotQueue(db, { trigger: 'order', client: noWait });
      expect(run?.stopped).toBe("The saved HubSpot token can't be read on this server (its encryption key differs). Paste the token again.");
      expect(run?.stopped).not.toMatch(/refused/i);
      const cfg = await readHubspotConfig(db);
      expect(cfg.tokenUnreadableAt).toBeGreaterThan(0);
      expect(cfg.tokenRejectedAt).toBeUndefined();
      expect(await runsCount()).toBe(1);
      // No repeated runs: later drains (the cron, the next trigger) do nothing and log nothing.
      expect(await drainHubspotQueue(db, { trigger: 'cron', client: noWait })).toBeNull();
      expect(await drainHubspotQueue(db, { trigger: 'change', client: noWait })).toBeNull();
      expect(await runsCount()).toBe(1);
      // Changes still queue, to go out once the token can be read again.
      expect(await enqueueHubspotRegistrations(db, [rid], 'change')).toBe(1);
    } finally {
      process.env.WEB_ORDER_SECRET = saved;
    }
    expect(await queueDoc('ada@example.com')).toBeDefined();
    expect(fake.state.requests).toEqual([]);

    // With the right key back and the token accepted again, the queue drains.
    await markTokenAccepted(db);
    expect((await readHubspotConfig(db)).tokenUnreadableAt).toBeUndefined();
    expect(await drainHubspotQueue(db, { trigger: 'cron', client: noWait })).toMatchObject({ sent: 1, created: 1 });
  });

  it('the fake refuses a bad token the way HubSpot does', async () => {
    fake.setMode('invalid-token');
    const err = await testHubspotToken(TOKEN, noWait).catch((e) => e);
    expect(err).toBeInstanceOf(HubspotError);
    expect(err.status).toBe(401);
    expect(err.tokenRejected).toBe(true);
    expect(err.message).toBe('HubSpot refused the access token. It may have been rotated or deleted. Paste a new one.');
  });

  it('scope check: access-token-info names the missing schema scopes', async () => {
    fake.setOptions({ scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'] });
    const check = await testHubspotToken(TOKEN, noWait);
    expect(check).toEqual({ portalId: 4242424, scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'], missing: ['crm.schemas.contacts.read', 'crm.schemas.contacts.write'] });
    const info = calls(P.tokenInfo);
    expect(info).toHaveLength(1);
    expect(info[0].body).toEqual({ tokenKey: '[the token]' });

    // With every scope, nothing is missing.
    fake.setOptions({ scopes: [...HUBSPOT_SCOPES] });
    expect(await testHubspotToken(TOKEN, noWait)).toMatchObject({ missing: [], portalId: 4242424 });
  });

  it('scope check: when HubSpot will not describe the token, the read probe still names a missing schema scope', async () => {
    fake.setOptions({ tokenInfo404: true, scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'] });
    expect(await testHubspotToken(TOKEN, noWait)).toEqual({ missing: ['crm.schemas.contacts.read'], scopes: undefined });
    fake.setOptions({ scopes: [...HUBSPOT_SCOPES] });
    expect(await testHubspotToken(TOKEN, noWait)).toEqual({ missing: [], scopes: undefined });
  });

  it('a scope HubSpot refuses mid-sync stops the run and names the scopes', async () => {
    await connect();
    await paidRegistrant('ada@example.com', 'Ada Lovelace');
    await enqueueHubspotEmails(db, ['ada@example.com'], 'order');
    fake.setOptions({ scopes: ['crm.objects.contacts.read'] });
    const run = await drainHubspotQueue(db, { trigger: 'order', client: noWait });
    expect(run).toMatchObject({ sent: 0, failed: 1 });
    expect(run?.stopped).toContain('crm.objects.contacts.write');
    expect((await queueDoc('ada@example.com'))?.attempts).toBe(0);
  });
});

describe('a paid registrant', () => {
  it('is queued by the order and drained into a new contact with every mapped field', async () => {
    await connect();
    const { rid } = await paidRegistrant('Ada.Nakamura@Example.com', 'Ada Nakamura King', {
      company: 'Analytical Engines',
      title: 'Engineer',
      promo: 'EARLY10',
      checkedIn: true,
    });

    const report = vi.fn();
    await queueAndKickHubspot(db, [rid], 'order', report);
    const runs = await waitForRuns(1);
    expect(report).not.toHaveBeenCalled();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: 'order', sent: 1, created: 1, updated: 0, skipped: 0, failed: 0, errors: [] });

    expect(contact('ada.nakamura@example.com')).toMatchObject({
      email: 'ada.nakamura@example.com',
      firstname: 'Ada',
      lastname: 'Nakamura King',
      company: 'Analytical Engines',
      jobtitle: 'Engineer',
      lifecyclestage: 'lead',
      kgc_2027_ticket: 'Main Conference',
      kgc_2027_order_date: '2026-10-03',
      kgc_2027_amount: '719.1',
      kgc_2027_attendance: 'In person',
      kgc_2027_promo_code: 'EARLY10',
      kgc_2027_checked_in: 'true',
      kgc_2027_status: 'Registered',
    });
    await waitForIdle();
    expect(await queueSize()).toBe(0);
    expect(calls(P.read)).toHaveLength(1);
    expect(calls(P.create)).toHaveLength(1);
    expect(calls(P.update)).toHaveLength(0);
    expect(fake.state.requests.every((r) => r.authOk)).toBe(true);
    // The documented shapes: read by email with propertiesWithHistory; create with associations and a trace id.
    expect(calls(P.read)[0].body).toMatchObject({ idProperty: 'email', propertiesWithHistory: [], inputs: [{ id: 'ada.nakamura@example.com' }] });
    expect(calls(P.read)[0].body.properties).toEqual(expect.arrayContaining(['email', 'hs_additional_emails', 'lifecyclestage']));
    expect(calls(P.create)[0].body.inputs[0]).toMatchObject({ associations: [], objectWriteTraceId: 'ada.nakamura@example.com', properties: { email: 'ada.nakamura@example.com' } });
  });

  it('a virtual ticket that has not been checked in says so', async () => {
    await connect();
    const { rid } = await paidRegistrant('ben@example.com', 'Ben', { tier: 'virtual', totalCents: 19_900 });
    await enqueueHubspotRegistrations(db, [rid], 'order');
    await drainHubspotQueue(db, { trigger: 'order', client: noWait });
    const c = contact('ben@example.com')!;
    expect(c).toMatchObject({ firstname: 'Ben', kgc_2027_ticket: 'Virtual Pass', kgc_2027_attendance: 'Virtual', kgc_2027_amount: '199', kgc_2027_checked_in: 'false' });
    expect('lastname' in c).toBe(false);
    expect('kgc_2027_promo_code' in c).toBe(false);
    expect('company' in c).toBe(false);
  });

  it('1.8: each seat of a group order with a promo gets its paid share, not the list price', async () => {
    await connect();
    const orderId = 'ord_group_promo';
    const a = await ensureRegistration(db, { email: 'grp.a@example.com', name: 'Grp A', ticketType: 'Main Conference', purchase: { orderId, seat: 0 } });
    const b = await ensureRegistration(db, { email: 'grp.b@example.com', name: 'Grp B', ticketType: 'Main Conference', purchase: { orderId, seat: 1 } });
    await db.collection(COLLECTIONS.orders).doc(orderId).set({
      eventId: EVENT_ID,
      externalId: 'cs_test_group',
      provider: 'stripe',
      channel: 'checkout',
      email: 'grp.a@example.com',
      status: 'paid',
      items: [
        { ticketTypeId: 'main-conference', ticketTypeName: 'Main Conference', quantity: 1, unitPriceCents: 59_900, attendeeEmail: 'grp.a@example.com', attendeeName: 'Grp A' },
        { ticketTypeId: 'main-conference', ticketTypeName: 'Main Conference', quantity: 1, unitPriceCents: 59_900, attendeeEmail: 'grp.b@example.com', attendeeName: 'Grp B' },
      ],
      subtotalCents: 119_800,
      discountCents: 59_900,
      totalCents: 59_900,
      currency: 'usd',
      promotionCode: 'HALF',
      purchasedAt: Timestamp.fromMillis(ORDER_DAY),
      registrationIds: [a.registrationId, b.registrationId],
    });
    await enqueueHubspotRegistrations(db, [a.registrationId, b.registrationId], 'order');
    expect(await drainHubspotQueue(db, { trigger: 'order', client: noWait })).toMatchObject({ sent: 2, created: 2 });
    expect(contact('grp.a@example.com')?.kgc_2027_amount).toBe('299.5');
    expect(contact('grp.b@example.com')?.kgc_2027_amount).toBe('299.5');
    expect(contact('grp.a@example.com')?.kgc_2027_promo_code).toBe('HALF');
  });
});

describe('several tickets on one address', () => {
  it('X1 / 3.2: four tickets on one email, one refunded through the webhook trigger, stays Registered', async () => {
    await connect();
    const email = 'four@example.com';
    const tickets: { rid: string; orderId: string }[] = [];
    const tiers: Tier[] = ['main-conference', 'main-conference', 'workshops', 'virtual'];
    for (let i = 0; i < 4; i++) {
      tickets.push(await paidRegistrant(email, 'Four Tickets', { tier: tiers[i], orderId: `ord_four_${i}`, purchasedAt: ORDER_DAY + i * 86_400_000, totalCents: 10_000 }));
    }
    const ids = new Set(tickets.map((t) => t.rid));
    expect(ids.size).toBe(4);
    // Each purchase triggers the sync the way the webhook does.
    for (const t of tickets) await queueAndKickHubspot(db, [t.rid], 'order', () => {});
    await waitForRuns(1);
    await waitForIdle();
    await drainHubspotQueue(db, { trigger: 'cron', client: noWait }); // anything a background run left
    expect(contact(email)).toMatchObject({ kgc_2027_status: 'Registered', kgc_2027_ticket: 'Main Conference, Virtual Pass, Workshops', kgc_2027_attendance: 'In person and virtual', kgc_2027_amount: '400' });

    // charge.refunded for the Virtual ticket: the webhook refunds the order, cancels the seat, then kicks the sync for that order.
    const refunded = tickets[3];
    await db.collection(COLLECTIONS.orders).doc(refunded.orderId).update({ status: 'refunded', refundedCents: 10_000, refundedAt: Timestamp.now() });
    await db.collection(COLLECTIONS.registrations).doc(refunded.rid).update({ status: 'cancelled' });
    const before = (await listHubspotRuns(db)).length;
    const report = vi.fn();
    await queueAndKickHubspot(db, [refunded.rid], 'refund', report);
    await waitForRuns(before + 1);
    await waitForIdle();
    expect(report).not.toHaveBeenCalled();

    const c = contact(email)!;
    expect(c.kgc_2027_status).toBe('Registered');
    expect(c.kgc_2027_ticket).toBe('Main Conference, Workshops');
    expect(c.kgc_2027_attendance).toBe('In person');
    expect(Object.keys(fake.state.contacts).filter((k) => k === email)).toHaveLength(1);
    expect(await queueSize()).toBe(0);
  });

  it('3.3: Sync all now with 30 two-ticket emails across batches: nobody shows Cancelled, each email sent once, sent counts people', async () => {
    await connect();
    const rows: Parameters<typeof bulkRegistrations>[0] = [];
    for (let i = 0; i < 170; i++) rows.push({ id: `reg_bf_${String(i).padStart(3, '0')}`, email: `bf${i}@example.com`, name: `Back Fill ${i}`, ticketType: i % 3 ? 'Main Conference' : 'Virtual Pass' });
    // 30 of them hold a cancelled second ticket too.
    const dupEmails = Array.from({ length: 30 }, (_, i) => `bf${i * 5}@example.com`);
    dupEmails.forEach((email, i) => rows.push({ id: `reg_bf_dup_${String(i).padStart(2, '0')}`, email, name: `Back Fill dup ${i}`, ticketType: 'Workshops', status: 'cancelled' }));
    await bulkRegistrations(rows);

    expect(await enqueueAllRegistrations(db)).toBe(170);
    const run = await drainHubspotQueue(db, { trigger: 'manual', actor: 'organizer@example.com', client: noWait });
    expect(run).toMatchObject({ sent: 170, created: 170, failed: 0, skipped: 0 });

    const creates = calls(P.create);
    expect(creates.map((r) => r.body.inputs.length)).toEqual([100, 70]);
    const sentEmails = creates.flatMap((r) => r.body.inputs.map((i: { properties: { email: string } }) => i.properties.email));
    expect(new Set(sentEmails).size).toBe(sentEmails.length);
    for (const e of dupEmails) {
      expect(fake.written(e)).toBe(1);
      expect(contact(e)?.kgc_2027_status).toBe('Registered');
      expect(contact(e)?.kgc_2027_ticket).not.toContain('Workshops');
    }
    const statuses = new Set(Object.values(fake.state.contacts).map((c) => c.properties.kgc_2027_status));
    expect([...statuses]).toEqual(['Registered']);
    expect(await queueSize()).toBe(0);
  });

  it('3.7: a ticket type change updates attendance from the new tier', async () => {
    await connect();
    const { rid } = await paidRegistrant('solo@example.com', 'Solo Person');
    await enqueueHubspotRegistrations(db, [rid], 'order');
    await drainHubspotQueue(db, { trigger: 'order', client: noWait });
    expect(contact('solo@example.com')).toMatchObject({ kgc_2027_ticket: 'Main Conference', kgc_2027_attendance: 'In person' });

    // changeTicketTypeAction rewrites the registration's ticket type; the order line still names the old tier.
    await db.collection(COLLECTIONS.registrations).doc(rid).update({ ticketType: 'Virtual Pass' });
    fake.state.requests.length = 0;
    await enqueueHubspotRegistrations(db, [rid], 'change');
    expect(await drainHubspotQueue(db, { trigger: 'change', client: noWait })).toMatchObject({ sent: 1, updated: 1 });
    expect(calls(P.update)[0].body.inputs[0].properties).toEqual({ kgc_2027_ticket: 'Virtual Pass', kgc_2027_attendance: 'Virtual' });
    // What was paid does not change with the ticket type.
    expect(contact('solo@example.com')?.kgc_2027_amount).toBe('719.1');
  });
});

describe('a later order on the same registration (T336 C)', () => {
  it('counts every order that paid for the registration: types, attendance and amount from all of them', async () => {
    await connect();
    const email = 'stack@example.com';
    // Virtual first, issued by its own order.
    const first = await paidRegistrant(email, 'Stack Person', { tier: 'virtual', orderId: 'ord_stack_1', totalCents: 12_900 });
    // Then Workshops bought later and added to the same registration: the website lists the
    // registration in the new order's registrationIds (and extraRegistrationIds), not as a new badge.
    await db.collection(COLLECTIONS.orders).doc('ord_stack_2').set({
      eventId: EVENT_ID,
      externalId: 'cs_test_ord_stack_2',
      provider: 'stripe',
      channel: 'checkout',
      email,
      buyerName: 'Stack Person',
      status: 'paid',
      items: [{ ticketTypeId: 'workshops', ticketTypeName: 'Workshops', quantity: 1, unitPriceCents: 19_900, attendeeName: 'Stack Person', attendeeEmail: email }],
      totalCents: 19_900,
      currency: 'usd',
      purchasedAt: Timestamp.fromMillis(ORDER_DAY + 86_400_000),
      registrationIds: [first.rid],
      extraRegistrationIds: [first.rid],
    });
    await queueAndKickHubspot(db, [first.rid], 'order', () => {});
    await waitForRuns(1);
    await waitForIdle();

    expect(contact(email)).toMatchObject({
      kgc_2027_ticket: 'Virtual Pass, Workshops',
      kgc_2027_attendance: 'In person and virtual',
      kgc_2027_amount: '328',
      kgc_2027_status: 'Registered',
    });

    // Refunding only the later order takes Workshops off and leaves the person Registered on Virtual.
    await db.collection(COLLECTIONS.orders).doc('ord_stack_2').update({ status: 'refunded', refundedCents: 19_900 });
    await queueAndKickHubspot(db, [first.rid], 'refund', () => {});
    await waitForRuns(2);
    await waitForIdle();
    expect(contact(email)).toMatchObject({ kgc_2027_ticket: 'Virtual Pass', kgc_2027_attendance: 'Virtual', kgc_2027_status: 'Registered' });
  });
});

describe('Sync all now', () => {
  it('backfills every person, 100 to a batch', async () => {
    await connect();
    const N = 250;
    await bulkRegistrations(Array.from({ length: N }, (_, j) => ({ id: `reg_bulk_${String(j).padStart(3, '0')}`, email: `person${j}@example.com`, name: `Person ${j}`, ticketType: 'Virtual Pass' })));
    // Another event's registration is not ours to send.
    await db.collection(COLLECTIONS.registrations).doc('reg_other_event').set({ eventId: 'kgc-2026', email: 'old@example.com', name: 'Old', status: 'active' });

    expect(await enqueueAllRegistrations(db)).toBe(N);
    const run = await drainHubspotQueue(db, { trigger: 'manual', actor: 'organizer@example.com', client: noWait });
    expect(run).toMatchObject({ trigger: 'manual', actor: 'organizer@example.com', sent: N, created: N, failed: 0 });
    expect(Object.keys(fake.state.contacts)).toHaveLength(N);
    expect(contact('old@example.com')).toBeUndefined();
    expect(calls(P.create).map((r) => r.body.inputs.length)).toEqual([100, 100, 50]);
    expect(calls(P.read).map((r) => r.body.inputs.length)).toEqual([100, 100, 50]);
    expect(await queueSize()).toBe(0);
    expect(contact('person249@example.com')).toMatchObject({ firstname: 'Person', lastname: '249', kgc_2027_attendance: 'Virtual', lifecyclestage: 'lead' });
  });
});

describe('updates', () => {
  it('a refund reaches the contact even when filling only empty fields', async () => {
    await connect({ mode: 'fill-empty' });
    const { rid, orderId } = await paidRegistrant('ada@example.com', 'Ada Lovelace', { company: 'Analytical Engines' });
    await enqueueHubspotRegistrations(db, [rid], 'order');
    await drainHubspotQueue(db, { trigger: 'order', client: noWait });
    expect(contact('ada@example.com')?.kgc_2027_status).toBe('Registered');

    await db.collection(COLLECTIONS.orders).doc(orderId).update({ status: 'refunded', refundedCents: 71_910, refundedAt: Timestamp.now() });
    await db.collection(COLLECTIONS.registrations).doc(rid).update({ status: 'cancelled' });
    fake.state.requests.length = 0;
    expect(await enqueueHubspotRegistrations(db, [rid], 'refund')).toBe(1);
    const run = await drainHubspotQueue(db, { trigger: 'refund', client: noWait });

    expect(run).toMatchObject({ sent: 1, created: 0, updated: 1 });
    expect(contact('ada@example.com')?.kgc_2027_status).toBe('Refunded');
    // Only what changed went over the wire, by HubSpot id.
    expect(calls(P.update)[0].body.inputs).toEqual([{ id: fake.state.contacts['ada@example.com'].id, properties: { kgc_2027_status: 'Refunded' } }]);
  });

  it('fill only empty fields leaves an existing company alone; always overwrite replaces it', async () => {
    fake.seedContact('ada@example.com', { company: 'Old Co', lifecyclestage: 'customer' });
    await connect({ mode: 'fill-empty' });
    const { rid } = await paidRegistrant('ada@example.com', 'Ada Lovelace', { company: 'Analytical Engines' });

    await enqueueHubspotRegistrations(db, [rid], 'order');
    const first = await drainHubspotQueue(db, { trigger: 'order', client: noWait });
    expect(first).toMatchObject({ sent: 1, created: 0, updated: 1, failed: 0 });
    expect(contact('ada@example.com')).toMatchObject({ company: 'Old Co', firstname: 'Ada', lifecyclestage: 'customer', kgc_2027_ticket: 'Main Conference' });
    expect(calls(P.update)[0].body.inputs[0].properties).not.toHaveProperty('lifecyclestage');

    await saveHubspotSettings(db, { mode: 'overwrite' }, 'organizer@example.com');
    await enqueueHubspotRegistrations(db, [rid], 'change');
    const second = await drainHubspotQueue(db, { trigger: 'change', client: noWait });
    expect(second).toMatchObject({ sent: 1, updated: 1, failed: 0 });
    expect(contact('ada@example.com')).toMatchObject({ company: 'Analytical Engines', lifecyclestage: 'customer' });
  });

  it('with creating contacts off, a registrant HubSpot does not have is skipped with a log line', async () => {
    fake.seedContact('known@example.com', { lifecyclestage: 'lead' });
    await connect({ createContacts: false });
    const a = await paidRegistrant('unknown@example.com', 'Una Known');
    const b = await paidRegistrant('known@example.com', 'Kay Nown');
    await enqueueHubspotRegistrations(db, [a.rid, b.rid], 'backfill');
    const run = await drainHubspotQueue(db, { trigger: 'manual', client: noWait });

    expect(run).toMatchObject({ sent: 1, created: 0, updated: 1, skipped: 1, failed: 0 });
    expect(run?.errors).toEqual([{ email: 'unknown@example.com', message: 'Not in HubSpot, and creating new contacts is off.' }]);
    expect(contact('unknown@example.com')).toBeUndefined();
    expect(calls(P.create)).toHaveLength(0);
    expect(calls(P.update)[0].body.inputs.map((i: { id: string }) => i.id)).toEqual([fake.state.contacts['known@example.com'].id]);
    expect(await queueSize()).toBe(0);
  });

  it('a contact already up to date is not sent again', async () => {
    await connect();
    const { rid } = await paidRegistrant('ada@example.com', 'Ada Lovelace');
    await enqueueHubspotRegistrations(db, [rid], 'order');
    await drainHubspotQueue(db, { trigger: 'order', client: noWait });
    fake.state.requests.length = 0;
    await enqueueHubspotRegistrations(db, [rid], 'change');
    const run = await drainHubspotQueue(db, { trigger: 'change', client: noWait });
    expect(run).toMatchObject({ sent: 0, skipped: 1, errors: [] });
    expect(calls(P.update)).toHaveLength(0);
    expect(calls(P.create)).toHaveLength(0);
  });

  it('7.1: a registrant using a secondary email is treated as the existing contact: fill-empty respected, no Lead pushed onto a customer', async () => {
    const primary = fake.seedContact('ada@primary.example', { company: 'Customer Co', lifecyclestage: 'customer' }, { additionalEmails: ['ada.alt@example.com'] });
    await connect({ mode: 'fill-empty' });
    const { rid } = await paidRegistrant('ada.alt@example.com', 'Ada Lovelace', { company: 'Analytical Engines' });
    await enqueueHubspotRegistrations(db, [rid], 'order');
    const run = await drainHubspotQueue(db, { trigger: 'order', client: noWait });

    expect(run).toMatchObject({ sent: 1, created: 0, updated: 1, failed: 0 });
    expect(run?.stopped).toBeUndefined();
    expect(calls(P.create)).toHaveLength(0);
    expect(calls(P.update)[0].body.inputs[0].id).toBe(primary.id);
    expect(calls(P.update)[0].body.inputs[0].properties).not.toHaveProperty('lifecyclestage');
    expect(calls(P.update)[0].body.inputs[0].properties).not.toHaveProperty('company');
    expect(contact('ada@primary.example')).toMatchObject({ company: 'Customer Co', lifecyclestage: 'customer', firstname: 'Ada', kgc_2027_status: 'Registered' });
    expect(contact('ada.alt@example.com')).toBeUndefined();
    expect(Object.keys(fake.state.contacts)).toHaveLength(1);
  });

  it('a contact created between our read and our create (409 Existing ID) is updated instead, with only our kgc_ properties in fill-empty', async () => {
    fake.setOptions({ strictConflict: true });
    await connect({ mode: 'fill-empty' });
    await paidRegistrant('race@example.com', 'Race Case', { company: 'Analytical Engines' });
    await enqueueHubspotEmails(db, ['race@example.com'], 'order');
    const create = fake.hold(P.create);
    const drain = drainHubspotQueue(db, { trigger: 'order', client: noWait });
    await arrived(create);
    // Somebody else created the contact in HubSpot after our read found nothing.
    const other = fake.seedContact('race@example.com', { company: 'Their Co', lifecyclestage: 'customer' });
    create.release();
    const run = await drain;

    expect(run).toMatchObject({ sent: 1, updated: 1, created: 0, failed: 0 });
    expect(calls(P.create).map((r) => r.status)).toEqual([409]);
    expect(calls(P.update)[0].body.inputs[0].id).toBe(other.id);
    const props = calls(P.update)[0].body.inputs[0].properties;
    expect(Object.keys(props).every((k) => k.startsWith('kgc_2027_'))).toBe(true);
    expect(contact('race@example.com')).toMatchObject({ company: 'Their Co', lifecyclestage: 'customer', kgc_2027_status: 'Registered' });
  });
});

describe('the request shapes', () => {
  it('T336 B1/B6: the fake holds property creation to HubSpot\'s spec, and the real KGC properties pass it', async () => {
    const post = (body: unknown) =>
      fetch(`${fake.url}${P.properties}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const base = { name: 'kgc_test_x', label: 'X', type: 'string', fieldType: 'text', groupName: 'contactinformation' };
    expect((await post({ ...base, colour: 'red' })).status).toBe(400); // unknown key
    expect((await post({ ...base, type: 'number', fieldType: 'text' })).status).toBe(400); // bad type/fieldType pair
    expect((await post({ ...base, groupName: 'no_such_group' })).status).toBe(400); // unknown group
    const yesNo = [{ label: 'Yes', value: 'true', displayOrder: 0 }, { label: 'No', value: 'false', displayOrder: 1 }];
    expect((await post({ ...base, type: 'enumeration', fieldType: 'booleancheckbox', options: yesNo })).status).toBe(400); // option without hidden
    expect((await post({ ...base, type: 'enumeration', fieldType: 'booleancheckbox', options: yesNo.map((o) => ({ ...o, hidden: false })) })).status).toBe(201);
    // And the client's own seven, through the real client.
    for (const def of kgcPropertyDefs()) expect(await createContactProperty(TOKEN, def, noWait)).toBe('created');
  });

  it('7.2: the sync never calls batch/upsert, and the fake refuses the old upsert shape as HubSpot does', async () => {
    await connect();
    await paidRegistrant('ada@example.com', 'Ada Lovelace');
    await enqueueHubspotEmails(db, ['ada@example.com'], 'order');
    await drainHubspotQueue(db, { trigger: 'order', client: noWait });
    expect(contact('ada@example.com')).toBeDefined();
    expect(calls(P.upsert)).toEqual([]);

    // The body the T333 client used to send.
    const res = await fetch(`${fake.url}${P.upsert}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: [{ idProperty: 'email', id: 'ada@example.com', objectWriteTraceId: 'ada@example.com', properties: { firstname: 'Ada' } }] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain('Cannot perform a partial upsert with email');
    fake.state.requests.length = 0; // the probe above is ours, not the sync's
  });

  it('the fake refuses shapes HubSpot refuses: unknown keys, a read without propertiesWithHistory, a create without associations, an update by email', async () => {
    const post = async (path: string, body: unknown) => {
      const r = await fetch(`${fake.url}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as { message: string; category: string } };
    };
    expect((await post(P.read, { idProperty: 'email', properties: ['email'], inputs: [{ id: 'a@b.co' }] })).status).toBe(400);
    expect((await post(P.read, { idProperty: 'email', properties: ['email'], propertiesWithHistory: [], inputs: [{ id: 'a@b.co' }], archived: false })).status).toBe(400);
    expect((await post(P.read, { idProperty: 'email', properties: ['email'], propertiesWithHistory: [], inputs: [{ id: 'a@b.co' }] })).status).toBe(207);
    expect((await post(P.create, { inputs: [{ properties: { email: 'a@b.co' } }] })).status).toBe(400);
    expect((await post(P.create, { inputs: [{ properties: { email: 'a@b.co' }, associations: [], idProperty: 'email' }] })).status).toBe(400);
    expect((await post(P.update, { inputs: [{ idProperty: 'email', id: 'a@b.co', properties: {} }] })).status).toBe(400);
    const missing = await post(P.update, { inputs: [{ id: '999999', properties: { firstname: 'X' } }] });
    expect(missing.status).toBe(207);
    const created = await post(P.create, { inputs: [{ properties: { email: 'a@b.co', no_such_property: 'x' }, associations: [] }] });
    expect(created.status).toBe(207);
    expect(JSON.stringify(created.body)).toContain('PROPERTY_DOESNT_EXIST');
    fake.state.requests.length = 0;
  });
});

describe('when HubSpot fails', () => {
  it('a 429 is retried and then succeeds', async () => {
    await connect();
    const { rid } = await paidRegistrant('ada@example.com', 'Ada Lovelace');
    await enqueueHubspotRegistrations(db, [rid], 'order');
    fake.setMode('rate-limit-once');
    const sleep = vi.fn(async () => {});
    const run = await drainHubspotQueue(db, { trigger: 'order', client: { sleep } });

    expect(run).toMatchObject({ sent: 1, created: 1, failed: 0 });
    expect(run?.stopped).toBeUndefined();
    expect(sleep).toHaveBeenCalledTimes(1);
    expect((sleep.mock.calls[0] as unknown as [number])[0]).toBeGreaterThanOrEqual(8_000);
    expect(fake.state.requests.map((r) => r.status)).toEqual([429, 207, 201]);
    expect(contact('ada@example.com')?.lifecyclestage).toBe('lead');
  });

  it('DAILY 429: the daily limit is not retried, the person waits an hour with no attempt used, and the run says why', async () => {
    await connect();
    await paidRegistrant('ada@example.com', 'Ada Lovelace');
    await enqueueHubspotEmails(db, ['ada@example.com'], 'order');
    fake.setMode('daily');
    const sleep = vi.fn(async () => {});
    const before = Date.now();
    const run = await drainHubspotQueue(db, { trigger: 'order', client: { sleep } });

    expect(sleep).not.toHaveBeenCalled();
    expect(fake.state.requests).toHaveLength(1);
    expect(fake.state.requests[0].status).toBe(429);
    expect(run).toMatchObject({ sent: 0, failed: 1 });
    expect(run?.stopped).toContain('daily API allowance');
    const q = (await queueDoc('ada@example.com'))!;
    expect(q.attempts).toBe(0);
    expect(q.nextAttemptAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect((await readHubspotConfig(db)).tokenRejectedAt).toBeUndefined();
  });

  it('a few 500s in a row are ridden out by the client', async () => {
    await connect();
    const { rid } = await paidRegistrant('ada@example.com', 'Ada Lovelace');
    await enqueueHubspotRegistrations(db, [rid], 'order');
    fake.setMode('server-error-n:3');
    const run = await drainHubspotQueue(db, { trigger: 'order', client: noWait });
    expect(run).toMatchObject({ sent: 1, failed: 0 });
    expect(fake.state.requests.filter((r) => r.status === 500)).toHaveLength(3);
  });

  it('5.6: a whole-batch 500 counts every unsent person as failed, keeps them queued with one more attempt, and the run says it stopped', async () => {
    await connect();
    for (const e of ['ada@example.com', 'ben@example.com', 'cy@example.com']) await paidRegistrant(e, `Person ${e[0]}`);
    await enqueueHubspotEmails(db, ['ada@example.com', 'ben@example.com', 'cy@example.com'], 'order');
    fake.setMode('down');
    const before = Date.now();
    const run = await drainHubspotQueue(db, { trigger: 'order', client: noWait });

    expect(run).toMatchObject({ sent: 0, failed: 3 });
    expect(run?.stopped).toBe('HubSpot had a problem on its side (HTTP 500). Waiting contacts are retried automatically.');
    expect(run?.errors).toEqual([{ email: '3 contacts', message: 'Not sent: HubSpot had a problem on its side (HTTP 500). Try again in a few minutes.' }]);
    for (const e of ['ada@example.com', 'ben@example.com', 'cy@example.com']) {
      const q = (await queueDoc(e))!;
      expect(q.attempts).toBe(1);
      expect(q.failed).toBe(false);
      expect(q.nextAttemptAt).toBeGreaterThanOrEqual(before + 5 * 60_000);
    }
    // First try plus four retries, all on the read; nothing was ever written.
    expect(calls(P.read)).toHaveLength(5);
    expect(calls(P.create)).toHaveLength(0);
    expect((await listHubspotRuns(db))[0]).toMatchObject({ failed: 3, stopped: run?.stopped });

    // Nothing is due now, so an immediate second drain does nothing.
    fake.setMode('ok');
    expect(await drainHubspotQueue(db, { trigger: 'cron', client: noWait })).toBeNull();
  });

  it('people HubSpot accepted before a later whole-batch failure are counted as sent and not re-queued', async () => {
    fake.seedContact('known@example.com', { lifecyclestage: 'lead' });
    await connect();
    await paidRegistrant('known@example.com', 'Kay Nown');
    await paidRegistrant('new@example.com', 'New Person');
    await enqueueHubspotEmails(db, ['known@example.com', 'new@example.com'], 'order');
    // The update lands; the create, held until then, meets HubSpot down.
    const create = fake.hold(P.create);
    const drain = drainHubspotQueue(db, { trigger: 'order', client: noWait });
    await arrived(create);
    fake.setMode('down');
    create.release();
    const run = await drain;
    expect(calls(P.update).map((r) => r.status)).toEqual([200]);
    expect(calls(P.create).every((r) => r.status === 500)).toBe(true);
    expect(run).toMatchObject({ sent: 1, updated: 1, failed: 1 });
    expect(await queueDoc('known@example.com')).toBeUndefined();
    expect((await queueDoc('new@example.com'))?.attempts).toBe(1);
    expect(run?.errors).toEqual([{ email: '1 contact', message: 'Not sent: HubSpot had a problem on its side (HTTP 500). Try again in a few minutes.' }]);
  });

  it('a refused token stops the sync and keeps the queue; nothing is sent until the token is accepted again', async () => {
    await connect();
    const a = await paidRegistrant('ada@example.com', 'Ada Lovelace');
    const b = await paidRegistrant('ben@example.com', 'Ben Olsen');
    await enqueueHubspotRegistrations(db, [a.rid], 'order');
    // The organizer pasted a token that has since been rotated in HubSpot.
    await saveHubspotToken(db, OTHER_TOKEN, 'organizer@example.com');
    const run = await drainHubspotQueue(db, { trigger: 'order', client: noWait });

    expect(run?.stopped).toBe('HubSpot refused the access token. It may have been rotated or deleted. Paste a new one.');
    expect(run).toMatchObject({ sent: 0, failed: 1 });
    expect(fake.state.requests).toHaveLength(1);
    expect(fake.state.requests[0]).toMatchObject({ status: 401, authOk: false });
    expect((await readHubspotConfig(db)).tokenRejectedAt).toBeGreaterThan(0);
    const kept = (await queueDoc('ada@example.com'))!;
    expect(kept.attempts).toBe(0);
    expect(kept.nextAttemptAt).toBeLessThanOrEqual(Date.now());

    // While refused: changes still queue, but nothing drains and nothing is sent.
    expect(await enqueueHubspotRegistrations(db, [b.rid], 'order')).toBe(1);
    expect(await drainHubspotQueue(db, { trigger: 'cron', client: noWait })).toBeNull();
    expect(fake.state.requests).toHaveLength(1);

    await saveHubspotToken(db, TOKEN, 'organizer@example.com');
    expect((await readHubspotConfig(db)).tokenRejectedAt).toBeUndefined();
    const after = await drainHubspotQueue(db, { trigger: 'cron', client: noWait });
    expect(after).toMatchObject({ sent: 2, created: 2 });
    expect(contact('ada@example.com')).toBeDefined();
    expect(contact('ben@example.com')).toBeDefined();
  });

  it('5.8: a change made while the token is refused is queued, and sent after markTokenAccepted and a drain', async () => {
    await connect();
    const { rid } = await paidRegistrant('ada@example.com', 'Ada Lovelace', { title: 'Engineer' });
    await enqueueHubspotRegistrations(db, [rid], 'order');
    await drainHubspotQueue(db, { trigger: 'order', client: noWait });
    expect(contact('ada@example.com')?.kgc_2027_checked_in).toBe('false');

    await markTokenRejected(db);
    fake.state.requests.length = 0;
    // A check-in at the door while HubSpot is refusing the token: the trigger as the dashboard calls it.
    await checkIn(rid);
    const report = vi.fn();
    await queueAndKickHubspot(db, [rid], 'checkin', report);
    expect(report).not.toHaveBeenCalled();
    expect(await queueDoc('ada@example.com')).toMatchObject({ triggers: ['checkin'], attempts: 0 });
    expect(await drainHubspotQueue(db, { trigger: 'cron', client: noWait })).toBeNull();
    expect(fake.state.requests).toEqual([]);

    // Test connection passes again.
    await markTokenAccepted(db);
    const run = await drainHubspotQueue(db, { trigger: 'cron', client: noWait });
    expect(run).toMatchObject({ sent: 1, updated: 1 });
    expect(contact('ada@example.com')?.kgc_2027_checked_in).toBe('true');
    expect(await queueSize()).toBe(0);
  });

  it('a contact HubSpot rejects on its own (207) is logged and kept queued; the rest go through', async () => {
    await connect();
    await paidRegistrant('ada@example.com', 'Ada Lovelace');
    await paidRegistrant('bad@example.com', 'Bad Address');
    fake.setMode('ok', { badEmails: ['bad@example.com'] });
    await enqueueHubspotEmails(db, ['ada@example.com', 'bad@example.com'], 'order');
    const before = Date.now();
    const run = await drainHubspotQueue(db, { trigger: 'order', client: noWait });

    expect(run).toMatchObject({ sent: 1, created: 1, failed: 1 });
    expect(run?.stopped).toBeUndefined();
    expect(run?.errors).toHaveLength(1);
    expect(run?.errors[0].email).toBe('bad@example.com');
    expect(run?.errors[0].message).toContain('bad@example.com is invalid');
    expect(await queueDoc('ada@example.com')).toBeUndefined();
    const q = (await queueDoc('bad@example.com'))!;
    expect(q).toMatchObject({ attempts: 1, failed: false });
    expect(q.lastError).toContain('is invalid');
    expect(q.nextAttemptAt).toBeGreaterThanOrEqual(before + 5 * 60_000);
    expect(contact('ada@example.com')).toBeDefined();
    expect(contact('bad@example.com')).toBeUndefined();
  });

  it('5.5: strict 400 with one bad email in a batch of 100: 99 sent, 1 failed with its reason, the run carries on to the next batch', async () => {
    await connect();
    const emails = Array.from({ length: 120 }, (_, i) => `p${String(i).padStart(3, '0')}@example.com`);
    await bulkRegistrations(emails.map((email, i) => ({ id: `reg_s4_${i}`, email, name: `Person ${i}`, ticketType: 'Main Conference' })));
    const bad = emails[37];
    fake.setMode('ok', { badEmails: [bad], strict400: true });
    expect(await enqueueHubspotEmails(db, emails, 'backfill')).toBe(120);
    // Make sure the bad one is in the first batch of 100.
    await queueRef(bad).update({ nextAttemptAt: 0 });
    const run = await drainHubspotQueue(db, { trigger: 'manual', client: noWait });

    expect(run?.stopped).toBeUndefined();
    expect(run).toMatchObject({ sent: 119, created: 119, failed: 1 });
    expect(run?.errors).toHaveLength(1);
    expect(run?.errors[0]).toMatchObject({ email: bad });
    expect(run?.errors[0].message).toContain(`${bad} is invalid`);
    const q = (await queueDoc(bad))!;
    expect(q).toMatchObject({ attempts: 1, failed: false });
    expect(q.lastError).toContain(bad);
    expect(await queueSize()).toBe(1);
    for (const e of emails) if (e !== bad) expect(contact(e)).toBeDefined();
    expect(contact(bad)).toBeUndefined();
    // The batch was split down to the bad record: a handful of extra calls, not one per contact.
    expect(calls(P.create).length).toBeLessThanOrEqual(2 + 2 * Math.ceil(Math.log2(100)));
    expect(calls(P.create).filter((r) => r.status === 400).length).toBeGreaterThan(0);
    // And nobody else shares the bad one's lastError.
    expect((await listHubspotRuns(db))[0]).toMatchObject({ failed: 1, sent: 119 });
  });

  it('T336 B2: a whole-batch 400 on the read step is split down to the bad address; everyone else is read and sent', async () => {
    await connect();
    const emails = Array.from({ length: 40 }, (_, i) => `r${String(i).padStart(2, '0')}@example.com`);
    await bulkRegistrations(emails.map((email, i) => ({ id: `reg_b2_${i}`, email, name: `Reader ${i}`, ticketType: 'Main Conference' })));
    const bad = emails[13];
    fake.setMode('ok', { badEmails: [bad], strict400Read: true });
    expect(await enqueueHubspotEmails(db, emails, 'backfill')).toBe(40);
    const run = await drainHubspotQueue(db, { trigger: 'manual', client: noWait });

    expect(run?.stopped).toBeUndefined();
    expect(run).toMatchObject({ sent: 39, failed: 1 });
    expect(run?.errors).toEqual([{ email: bad, message: expect.stringContaining(`${bad} is invalid`) }]);
    expect(calls(P.read).filter((r) => r.status === 400).length).toBeGreaterThan(0);
    expect(calls(P.read).length).toBeLessThanOrEqual(1 + 2 * Math.ceil(Math.log2(40)));
    for (const e of emails) if (e !== bad) expect(contact(e)).toBeDefined();
    expect(await queueDoc(bad)).toMatchObject({ attempts: 1, failed: false });
    expect(await queueSize()).toBe(1);
  });

  it('parks a person after the last attempt, and a parked person is not retried until queued again', async () => {
    await connect();
    const bad = await paidRegistrant('bad@example.com', 'Bad Address');
    fake.setMode('ok', { badEmails: ['bad@example.com'] });
    await enqueueHubspotRegistrations(db, [bad.rid], 'order');
    await queueRef('bad@example.com').update({ attempts: HUBSPOT_MAX_ATTEMPTS - 1 });

    const run = await drainHubspotQueue(db, { trigger: 'cron', client: noWait });
    expect(run).toMatchObject({ failed: 1 });
    const q = (await queueDoc('bad@example.com'))!;
    expect(q).toMatchObject({ attempts: HUBSPOT_MAX_ATTEMPTS, failed: true, nextAttemptAt: PARKED_AT });
    expect(await queueCounts(db)).toEqual({ waiting: 0, parked: 1 });

    fake.state.requests.length = 0;
    expect(await drainHubspotQueue(db, { trigger: 'cron', client: noWait })).toBeNull();
    expect(fake.state.requests).toEqual([]);

    // Queuing it again (a ticket change, say) gives it a fresh start.
    expect(await enqueueHubspotRegistrations(db, [bad.rid], 'change')).toBe(1);
    expect(await queueDoc('bad@example.com')).toMatchObject({ attempts: 0, nextAttemptAt: expect.any(Number) });
    expect((await queueDoc('bad@example.com'))?.failed).toBeUndefined();
    expect(await queueCounts(db)).toEqual({ waiting: 1, parked: 0 });
  });
});

describe('the queue and the log', () => {
  it('5.10: a change re-queued while its batch is in flight is not lost', async () => {
    await connect({ mode: 'overwrite' });
    const { rid } = await paidRegistrant('race@example.com', 'Race Case', { title: 'R' });
    await enqueueHubspotRegistrations(db, [rid], 'order');
    await drainHubspotQueue(db, { trigger: 'order', client: noWait });
    expect(contact('race@example.com')?.kgc_2027_checked_in).toBe('false');

    // An edit queues the person; the drain's update is held in flight at HubSpot.
    await db.collection(COLLECTIONS.registrations).doc(rid).update({ title: 'R2' });
    await enqueueHubspotRegistrations(db, [rid], 'change');
    const update = fake.hold(P.update);
    const drain = drainHubspotQueue(db, { trigger: 'change', client: noWait });
    await arrived(update);
    // A check-in lands while that update is in flight, and queues the person again.
    await checkIn(rid);
    expect(await enqueueHubspotRegistrations(db, [rid], 'checkin')).toBe(1);
    update.release();
    const run = await drain;

    expect(run?.stopped).toBeUndefined();
    expect(contact('race@example.com')).toMatchObject({ kgc_2027_checked_in: 'true', jobtitle: 'R2' });
    expect(calls(P.update).length).toBe(2);
    expect(await queueSize()).toBe(0);
  });

  it('5.11: lease renewal is holder-checked: a second holder that took an expired lease is not overwritten', async () => {
    await connect();
    // 101 people (no registrations, so nothing is written): two batches.
    const emails = Array.from({ length: 101 }, (_, i) => `lease${i}@example.com`);
    expect(await enqueueHubspotEmails(db, emails, 'backfill')).toBe(101);
    const read = fake.hold(P.read);
    const drain = drainHubspotQueue(db, { trigger: 'manual', client: noWait });
    await arrived(read);
    // The first batch overran the lease; a second drain took it over.
    const lock = db.collection(COLLECTIONS.integrations).doc('hubspotLock');
    const until = Date.now() + 120_000;
    await lock.set({ holder: 'second-drain', until });
    read.release();
    const run = await drain;

    expect(run).toMatchObject({ skipped: 100, sent: 0 });
    // It stopped at the next renewal instead of taking another batch, and left the other holder's lease alone.
    expect(calls(P.read)).toHaveLength(1);
    expect((await lock.get()).data()).toEqual({ holder: 'second-drain', until });
    expect(await queueSize()).toBe(1);
  });

  it('two drains at once never send the same person twice', async () => {
    await connect();
    const emails = ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com'];
    for (const e of emails) await paidRegistrant(e, `Person ${e[0]}`);
    await enqueueHubspotEmails(db, emails, 'backfill');

    const runs = await Promise.all([
      drainHubspotQueue(db, { trigger: 'manual', client: noWait }),
      drainHubspotQueue(db, { trigger: 'cron', client: noWait }),
    ]);
    expect(runs.filter(Boolean)).toHaveLength(1);
    expect(runs.find(Boolean)).toMatchObject({ sent: 5, created: 5 });
    for (const e of emails) expect(fake.written(e)).toBe(1);
    expect(await queueSize()).toBe(0);
    expect((await db.collection(COLLECTIONS.integrations).doc('hubspotLock').get()).exists).toBe(false);
  });

  it('a drain does nothing while another holds the lease', async () => {
    await connect();
    const { rid } = await paidRegistrant('ada@example.com', 'Ada Lovelace');
    await enqueueHubspotRegistrations(db, [rid], 'order');
    await db.collection(COLLECTIONS.integrations).doc('hubspotLock').set({ holder: 'someone-else', until: Date.now() + 60_000 });
    expect(await drainHubspotQueue(db, { trigger: 'order', client: noWait })).toBeNull();
    expect(fake.state.requests).toEqual([]);
    expect(await queueDoc('ada@example.com')).toBeDefined();
    // Our drain did not release someone else's lease.
    expect((await db.collection(COLLECTIONS.integrations).doc('hubspotLock').get()).get('holder')).toBe('someone-else');

    // An expired lease is taken over.
    await db.collection(COLLECTIONS.integrations).doc('hubspotLock').set({ holder: 'someone-else', until: Date.now() - 1 });
    expect(await drainHubspotQueue(db, { trigger: 'order', client: noWait })).toMatchObject({ sent: 1 });
  });

  it(`keeps the newest ${HUBSPOT_RUNS_KEPT} runs`, async () => {
    await connect();
    const runs = db.collection(COLLECTIONS.integrations).doc('hubspot').collection('runs');
    const batch = db.batch();
    for (let i = 0; i < 55; i++) {
      batch.set(runs.doc(`old_${String(i).padStart(2, '0')}`), {
        startedAt: 1_000 + i,
        finishedAt: 1_000 + i,
        trigger: 'cron',
        actor: '',
        sent: 0,
        created: 0,
        updated: 0,
        skipped: 1,
        failed: 0,
        errors: [],
      });
    }
    await batch.commit();
    const { rid } = await paidRegistrant('ada@example.com', 'Ada Lovelace');
    await enqueueHubspotRegistrations(db, [rid], 'order');
    await drainHubspotQueue(db, { trigger: 'order', client: noWait });

    const left = await runs.get();
    expect(left.size).toBe(HUBSPOT_RUNS_KEPT);
    const listed = await listHubspotRuns(db);
    expect(listed).toHaveLength(HUBSPOT_RUNS_KEPT);
    expect(listed[0]).toMatchObject({ trigger: 'order', sent: 1 });
    // The six oldest went: 55 seeded + 1 new - 50 kept.
    const ids = new Set(left.docs.map((d) => d.id));
    for (let i = 0; i < 6; i++) expect(ids.has(`old_${String(i).padStart(2, '0')}`)).toBe(false);
    expect(ids.has('old_06')).toBe(true);
  });

  it('a person whose registrations were all deleted while queued is dropped with a log line', async () => {
    await connect();
    const { rid } = await paidRegistrant('ada@example.com', 'Ada Lovelace');
    await enqueueHubspotRegistrations(db, [rid], 'order');
    await db.collection(COLLECTIONS.registrations).doc(rid).delete();
    const run = await drainHubspotQueue(db, { trigger: 'order', client: noWait });

    expect(run).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
    expect(run?.errors).toEqual([{ email: 'ada@example.com', message: 'No registration uses this address any more, so nothing was sent.' }]);
    expect(await queueSize()).toBe(0);
    expect(calls(P.create)).toHaveLength(0);
    expect(calls(P.update)).toHaveLength(0);
  });

  it('A-F2: a malformed queue document is removed and logged, and the drain carries on without throwing', async () => {
    await connect();
    await paidRegistrant('ada@example.com', 'Ada Lovelace');
    await enqueueHubspotEmails(db, ['ada@example.com'], 'order');
    // The gate's poison doc (no address at all) and an old-shape doc with a junk address; both sort first.
    await db.collection(COLLECTIONS.hubspotQueue).doc('a-poison').set({ nextAttemptAt: 0, attempts: 0 });
    await db.collection(COLLECTIONS.hubspotQueue).doc('b-junk').set({ registrationId: 'reg_x', email: 'not-an-address', nextAttemptAt: 0, attempts: 'x' });

    // What the cron route does.
    const run = await drainHubspotQueue(db, { trigger: 'cron', client: noWait });
    expect(run).toMatchObject({ sent: 1, created: 1, skipped: 2, failed: 0 });
    expect(run?.stopped).toBeUndefined();
    expect(run?.errors).toEqual(
      expect.arrayContaining([
        { email: 'a-poison', message: 'A queue entry had no valid email address and was removed.' },
        { email: 'b-junk', message: 'A queue entry had no valid email address and was removed.' },
      ]),
    );
    expect(await queueSize()).toBe(0);
    expect(contact('ada@example.com')).toBeDefined();
    // And the next cron is a quiet no-op, not a 500.
    await expect(drainHubspotQueue(db, { trigger: 'cron', client: noWait })).resolves.toBeNull();
  });

  it('queuing the same person twice keeps one item, keyed by their email', async () => {
    await connect();
    const { rid } = await paidRegistrant('Ada@Example.com', 'Ada Lovelace');
    expect(await enqueueHubspotRegistrations(db, [rid, rid, 'reg_missing'], 'order')).toBe(1);
    expect(await enqueueHubspotEmails(db, ['ADA@example.com ', 'ada@example.com', 'nope'], 'checkin')).toBe(1);
    expect(await queueSize()).toBe(1);
    const q = await queueDoc('ada@example.com');
    expect(q).toMatchObject({ email: 'ada@example.com', triggers: ['checkin'], attempts: 0 });
    expect((await db.collection(COLLECTIONS.hubspotQueue).get()).docs[0].id).toBe(hubspotPersonKey('ada@example.com'));
  });
});
