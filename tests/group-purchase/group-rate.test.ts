/**
 * The group rate: 5 or more in-person tickets in one checkout take 10% off
 * each of them, with a promotion code still applying on top (T165).
 *
 * Runs the real `startCheckout` (to see what Stripe is asked to charge) and the
 * real webhook (to see what the order records, what each seat's confirmation
 * names, and what a refund does) against the Firestore emulator. Stripe is
 * faked: it records the session it is asked for, and a test sets what it
 * charged, which is where a promotion code shows up.
 *
 * Run with: npm run test:group-purchase
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Line = { quantity: number; price_data: { unit_amount: number; product?: string; product_data?: { name: string } } };
type Params = {
  line_items: Line[];
  metadata: Record<string, string>;
  allow_promotion_codes?: boolean;
  discounts?: unknown;
  custom_text?: { submit?: { message: string } };
};

const mocks = vi.hoisted(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_group_rate';
  process.env.WEB_ORDER_SECRET = 'test-order-secret-test-order-secret-0123';
  return {
    created: [] as unknown[],
    sessions: new Map<string, Record<string, unknown>>(),
    sessionByIntent: new Map<string, string>(),
    sent: [] as { to: string; amountCents: number }[],
  };
});

vi.mock('../../apps/web/node_modules/next/headers.js', () => ({
  headers: async () => new Headers({ host: 'www.knowledgegraph.tech', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.50' }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('../../apps/web/node_modules/next/navigation.js', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { url });
  },
}));
vi.mock('@/lib/data', () => ({
  ticketSalesOpen: async () => true,
  brandingSettings: async () => ({ chargeBuyerFee: false }),
}));
vi.mock('@/lib/stripe', () => ({
  stripeEnabled: () => true,
  siteOrigin: () => 'https://www.knowledgegraph.tech',
  stripe: () => ({
    webhooks: { constructEventAsync: async (raw: string) => JSON.parse(raw) },
    checkout: {
      sessions: {
        create: async (params: unknown) => {
          mocks.created.push(params);
          const id = `cs_test_rate_${mocks.created.length}`;
          return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
        },
        retrieve: async (id: string) => {
          const s = mocks.sessions.get(id);
          if (!s) throw Object.assign(new Error('No such session'), { type: 'StripeInvalidRequestError' });
          return s;
        },
        list: async ({ payment_intent }: { payment_intent: string }) => {
          const id = mocks.sessionByIntent.get(payment_intent);
          return { data: id ? [mocks.sessions.get(id)] : [] };
        },
        listLineItems: async () => ({ data: [] }),
      },
    },
    invoicePayments: { list: async () => ({ data: [] }) },
  }),
}));
vi.mock('@/lib/email', () => ({
  sendPurchaseConfirmation: async (input: { to: string; amountCents: number }) => {
    mocks.sent.push({ to: input.to, amountCents: input.amountCents });
    return 'sent';
  },
  sendRefundConfirmation: async () => 'sent',
  sendTicketWithdrawn: async () => 'sent',
}));
vi.mock('@/lib/app-account', () => ({
  provisionPurchaserAccount: async () => ({ status: 'existing', uid: null, temporaryPassword: null }),
}));

import { NextRequest } from '../../apps/web/node_modules/next/server.js';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type OrderDoc, type RegistrationDoc } from '@kgc/shared';
import { startCheckout } from '@/app/tickets/actions';
import { GROUP_RATE_MIN_SEATS, GROUP_RATE_PERCENT, countsForGroupRate, priceSeats } from '@/app/tickets/seats-core';
import { POST as webhook } from '@/app/api/stripe/webhook/route';
import { db as webDb } from '@/lib/firestore';
import { orderIdFor } from '@/lib/registrations';

let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Use: npm run test:group-purchase');
  db = webDb() as unknown as Firestore;
});

async function wipe(collection: string) {
  const snap = await db.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

const TIERS: Record<string, Record<string, unknown>> = {
  'main-conference': { name: 'Main Conference', priceCents: 59_900, inPerson: true, stripeProductId: 'prod_main' },
  'all-access': { name: 'All Access (VIP)', priceCents: 69_900, inPerson: true },
  virtual: { name: 'Virtual', priceCents: 12_900, inPerson: false },
  workshops: { name: 'Workshops', priceCents: 19_900, inPerson: true, addOnFor: 'main-conference', visible: false },
  'main-conference-workshops': { name: 'Main Conference + Workshops', priceCents: 0, inPerson: true, bundleOf: ['main-conference', 'workshops'], visible: false },
  'exhibitor-standard-booth': { name: 'Standard Booth', priceCents: 250_000, inPerson: true, audience: 'exhibitor' },
};

beforeEach(async () => {
  mocks.created.length = 0;
  mocks.sessions.clear();
  mocks.sessionByIntent.clear();
  mocks.sent.length = 0;
  await Promise.all(
    [COLLECTIONS.ticketTypes, COLLECTIONS.orders, COLLECTIONS.registrations, COLLECTIONS.rateLimits, COLLECTIONS.auditLog, COLLECTIONS.stripeIgnored].map(wipe),
  );
  for (const [id, t] of Object.entries(TIERS)) {
    await db.collection(COLLECTIONS.ticketTypes).doc(id).set({ eventId: EVENT_ID, currency: 'usd', quantityTotal: 100, quantitySold: 0, ...t });
  }
});

/** A checkout form: the buyer on `tiers[0]`, one extra attendee per further tier. */
function form(tiers: string[], extra: Record<string, string> = {}) {
  const f = new FormData();
  f.append('tier', tiers[0]);
  f.append('name', 'Ada Nakamura');
  f.append('email', 'ada@example.com');
  tiers.slice(1).forEach((t, i) => {
    f.append('seatName', `Guest ${i + 2}`);
    f.append('seatEmail', `guest${i + 2}@example.com`);
    f.append('seatTier', t);
  });
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
}

async function checkout(tiers: string[], extra?: Record<string, string>): Promise<Params> {
  try {
    const res = (await startCheckout({}, form(tiers, extra))) as { error?: string };
    throw new Error(`no redirect: ${res.error}`);
  } catch (err) {
    if (!(err as { url?: string }).url) throw err;
  }
  return mocks.created[mocks.created.length - 1] as Params;
}

const units = (p: Params) =>
  Object.fromEntries(
    p.line_items.map((l) => [l.price_data.product ?? l.price_data.product_data?.name ?? '?', [l.quantity, l.price_data.unit_amount]]),
  );
const charged = (p: Params) => p.line_items.reduce((n, l) => n + l.quantity * l.price_data.unit_amount, 0);
const tenPctOff = (cents: number) => cents - Math.round((cents * GROUP_RATE_PERCENT) / 100);

const MAIN = 'main-conference';

describe('which carts earn the group rate', () => {
  it(`charges list price for ${GROUP_RATE_MIN_SEATS - 1} in-person seats`, async () => {
    const p = await checkout(Array(4).fill(MAIN));
    expect(units(p)).toEqual({ prod_main: [4, 59_900] });
    expect(p.custom_text).toBeUndefined();
    expect(p.metadata.groupRate).toBeUndefined();
  });

  it(`takes ${GROUP_RATE_PERCENT}% off each of ${GROUP_RATE_MIN_SEATS} in-person seats, and says so on Stripe's page`, async () => {
    const p = await checkout(Array(5).fill(MAIN));
    expect(units(p)).toEqual({ prod_main: [5, tenPctOff(59_900)] });
    expect(p.custom_text?.submit?.message).toMatch(/Group rate: 10% off each in-person ticket/);
    expect(p.metadata).toMatchObject({ groupRate: '10%', groupDiscountCents: String(5 * 5_990) });
  });

  it('does not count Virtual: 4 in-person and 1 Virtual is no discount', async () => {
    const p = await checkout([MAIN, MAIN, MAIN, 'all-access', 'virtual']);
    expect(charged(p)).toBe(3 * 59_900 + 69_900 + 12_900);
    expect(p.metadata.groupRate).toBeUndefined();
  });

  it('discounts only the in-person seats when Virtual is mixed in: 5 in-person and 2 Virtual', async () => {
    const p = await checkout([MAIN, MAIN, MAIN, 'all-access', 'all-access', 'virtual', 'virtual']);
    expect(units(p)).toEqual({
      prod_main: [3, tenPctOff(59_900)],
      'KGC 2027: All Access (VIP) (group rate)': [2, tenPctOff(69_900)],
      'KGC 2027: Virtual': [2, 12_900],
    });
  });

  it('counts a Main Conference bundle, and takes 10% off the add-on with it', async () => {
    const bundle = 59_900 + 19_900;
    const p = await checkout(['main-conference-workshops', 'main-conference-workshops', MAIN, MAIN, MAIN]);
    expect(units(p)).toEqual({
      'KGC 2027: Main Conference + Workshops (group rate)': [2, tenPctOff(bundle)],
      prod_main: [3, tenPctOff(59_900)],
    });
  });

  it('keeps the tier product on a discounted line, which is what a product-restricted promotion code matches', async () => {
    const p = await checkout(Array(5).fill(MAIN));
    expect(p.line_items[0].price_data.product).toBe('prod_main');
    // Promotion codes stay available, so a code applies on top of the rate.
    expect(p.allow_promotion_codes).toBe(true);
    expect(p.discounts).toBeUndefined();
  });

  it('ignores anything the form posts about price or the rate', async () => {
    const p = await checkout(Array(4).fill(MAIN), { groupRate: '1', groupDiscount: '50', priceCents: '1', unit_amount: '1' });
    expect(units(p)).toEqual({ prod_main: [4, 59_900] });
  });
});

/** Stripe's side of a paid session: what it actually charged, promotion code included. */
function paid(p: Params, sessionId: string, amountTotal: number, discount = 0) {
  const session = {
    id: sessionId,
    object: 'checkout.session',
    payment_status: amountTotal === 0 ? 'no_payment_required' : 'paid',
    status: 'complete',
    payment_intent: `pi_${sessionId}`,
    amount_total: amountTotal,
    amount_subtotal: charged(p),
    currency: 'usd',
    customer_details: { email: 'ada@example.com', name: 'Ada Nakamura' },
    total_details: { amount_tax: 0, amount_discount: discount },
    metadata: p.metadata,
  };
  mocks.sessions.set(sessionId, session);
  mocks.sessionByIntent.set(`pi_${sessionId}`, sessionId);
  return session;
}

async function deliver(type: string, object: unknown) {
  const res = await webhook(
    new NextRequest('https://www.knowledgegraph.tech/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=x' },
      body: JSON.stringify({ id: `evt_${Math.random()}`, type, data: { object } }),
    }),
  );
  expect(res.status).toBe(200);
  return res;
}

const order = async (sessionId: string) =>
  (await db.collection(COLLECTIONS.orders).doc(orderIdFor(sessionId)).get()).data() as OrderDoc;

describe('the order, the confirmations and refunds', () => {
  it('records each seat at its group-rate price, and the total discount', async () => {
    await checkout([MAIN, MAIN, MAIN, 'all-access', 'all-access', 'virtual']);
    const sid = 'cs_test_rate_1';
    const o = await order(sid);
    expect(o.groupDiscountCents).toBe(3 * 5_990 + 2 * 6_990);
    const virtual = o.items.find((i) => i.ticketTypeId === 'virtual')!;
    expect(virtual).toMatchObject({ unitPriceCents: 12_900 });
    expect(virtual.groupDiscountCents).toBeUndefined();
    expect(o.items.filter((i) => i.ticketTypeId === MAIN).every((i) => i.unitPriceCents === 53_910 && i.listPriceCents === 59_900 && i.groupDiscountCents === 5_990)).toBe(true);
  });

  it.each([
    ['no promotion code', 0],
    ['a percent code on top (20% of the discounted total)', 0.2],
    ['a fixed code on top ($100)', 'fixed'],
  ] as const)('keeps the order right with %s, and each confirmation names its own share', async (_label, promo) => {
    const p = await checkout([MAIN, MAIN, MAIN, MAIN, 'all-access', 'virtual']);
    const sid = 'cs_test_rate_1';
    const subtotal = charged(p);
    const discount = promo === 'fixed' ? 10_000 : Math.round(subtotal * promo);
    paid(p, sid, subtotal - discount, discount);
    await deliver('checkout.session.completed', mocks.sessions.get(sid));

    const o = await order(sid);
    expect(o.status).toBe('paid');
    expect(o.totalCents).toBe(subtotal - discount);
    expect(o.discountCents).toBe(discount);
    expect(o.groupDiscountCents).toBe(4 * 5_990 + 6_990);
    // One confirmation per seat, adding up to the charge, each in proportion
    // to what that seat cost: the Virtual seat's share is the smallest.
    expect(mocks.sent).toHaveLength(6);
    expect(mocks.sent.reduce((n, m) => n + m.amountCents, 0)).toBe(subtotal - discount);
    const virtualShare = mocks.sent.find((m) => m.to === 'guest6@example.com')!.amountCents;
    expect(virtualShare).toBeLessThan(Math.min(...mocks.sent.filter((m) => m.to !== 'guest6@example.com').map((m) => m.amountCents)));
    if (promo === 0) expect(virtualShare).toBe(12_900);
  });

  it('issues every ticket when a 100% code brings it to $0', async () => {
    const p = await checkout(Array(5).fill(MAIN));
    const sid = 'cs_test_rate_1';
    paid(p, sid, 0, charged(p));
    await deliver('checkout.session.completed', mocks.sessions.get(sid));
    const regs = await db.collection(COLLECTIONS.registrations).where('orderId', '==', orderIdFor(sid)).get();
    expect(regs.docs.map((d) => (d.data() as RegistrationDoc).status)).toEqual(Array(5).fill('active'));
    expect((await order(sid)).totalCents).toBe(0);
  });

  it('refunds: one seat at its discounted price keeps the tickets; the full amount cancels them all', async () => {
    const p = await checkout(Array(5).fill(MAIN));
    const sid = 'cs_test_rate_1';
    const total = charged(p);
    paid(p, sid, total);
    await deliver('checkout.session.completed', mocks.sessions.get(sid));
    const seatPrice = (await order(sid)).items[0].unitPriceCents;
    expect(seatPrice).toBe(53_910);

    const charge = (amount: number) => ({ id: `ch_${sid}`, object: 'charge', payment_intent: `pi_${sid}`, amount_refunded: amount, currency: 'usd' });
    await deliver('charge.refunded', charge(seatPrice));
    expect(await order(sid)).toMatchObject({ status: 'partially_refunded', refundedCents: seatPrice });

    await deliver('charge.refunded', charge(total));
    expect(await order(sid)).toMatchObject({ status: 'refunded', refundedCents: total });
    const regs = await db.collection(COLLECTIONS.registrations).where('orderId', '==', orderIdFor(sid)).get();
    expect(regs.docs.map((d) => (d.data() as RegistrationDoc).status)).toEqual(Array(5).fill('cancelled'));
    expect((await db.collection(COLLECTIONS.ticketTypes).doc(MAIN).get()).data()?.quantitySold).toBe(0);
  });
});

describe('exhibitor and sponsor packages', () => {
  it('neither count nor get the rate', async () => {
    const p = await checkout([MAIN, MAIN, MAIN, MAIN, 'exhibitor-standard-booth']);
    expect(p.metadata.groupRate).toBeUndefined();
    expect(charged(p)).toBe(4 * 59_900 + 250_000);
  });
});

describe('an extra and the group rate (T169)', () => {
  it('Workshops never counts toward five and never gets the rate', () => {
    const main = { inPerson: true, audience: 'attendee', priceCents: 59_900 };
    const workshops = { inPerson: true, audience: 'attendee', kind: 'extra', priceCents: 19_900 };
    expect(countsForGroupRate(workshops)).toBe(false);
    expect(priceSeats(Array(5).fill(workshops)).applies).toBe(false);
    expect(priceSeats([...Array(4).fill(main), workshops]).applies).toBe(false);
    const five = priceSeats([...Array(5).fill(main), workshops]);
    expect(five.applies).toBe(true);
    expect(five.seats.at(-1)).toEqual({ listCents: 19_900, discountCents: 0, chargedCents: 19_900 });
  });
});
