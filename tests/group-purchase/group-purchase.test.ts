/**
 * A group purchase, with the buyer's redirect and Stripe's webhook racing.
 *
 * A card checkout is fulfilled twice: by `/checkout/return`, when Stripe sends
 * the buyer back, and by the webhook, which Stripe delivers on its own clock
 * and may redeliver for days. Usually the redirect wins. Until 2026-10-04 the
 * redirect ran a one-seat fulfilment that overwrote the order's seat list, so
 * the webhook that followed found no other seats: seats two and three got no
 * ticket and no email, and nothing was counted against capacity.
 *
 * These run both real route handlers against the Firestore emulator, in every
 * order they can arrive, and check what a group purchase must end up with:
 * one registration and one confirmation per seat, each seat counted once, and
 * the full seat list on the order. Stripe, email and Auth accounts are faked;
 * everything that writes Firestore is the real code.
 *
 * Run with: npm run test:group-purchase
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // Test values only: the route refuses to run without them.
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_group_purchase';
  process.env.WEB_ORDER_SECRET = 'test-order-secret-test-order-secret-0123';
  return {
  sessions: new Map<string, unknown>(),
  sent: [] as { to: string; ticketType: string; registrationId?: string }[],
  };
});

vi.mock('@/lib/stripe', () => ({
  stripeEnabled: () => true,
  siteOrigin: () => 'https://www.knowledgegraph.tech',
  stripe: () => ({
    webhooks: { constructEventAsync: async (raw: string) => JSON.parse(raw) },
    checkout: {
      sessions: {
        retrieve: async (id: string) => {
          const s = mocks.sessions.get(id);
          if (!s) throw Object.assign(new Error('No such session'), { type: 'StripeInvalidRequestError' });
          return s;
        },
        list: async () => ({ data: [] }),
        listLineItems: async () => ({ data: [] }),
      },
    },
  }),
}));
vi.mock('@/lib/email', () => ({
  sendPurchaseConfirmation: async (input: { to: string; ticketType: string; registrationId?: string }) => {
    mocks.sent.push({ to: input.to, ticketType: input.ticketType, registrationId: input.registrationId });
    return { status: 'sent' };
  },
  sendRefundConfirmation: async () => ({ status: 'sent' }),
  sendTicketWithdrawn: async () => ({ status: 'sent' }),
}));
vi.mock('@/lib/app-account', () => ({
  provisionPurchaserAccount: async () => ({ status: 'existing', uid: null, temporaryPassword: null }),
}));
vi.mock('@/lib/analytics', () => ({
  analyticsConfig: () => null,
  encodePurchase: () => '',
  PURCHASE_COOKIE: 'kgc_purchase',
}));

import { NextRequest } from '../../apps/web/node_modules/next/server.js';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type OrderDoc, type RegistrationDoc } from '@kgc/shared';
import { normaliseEmail } from '@kgc/scripts/src/lib/ids';
import { POST as webhook } from '@/app/api/stripe/webhook/route';
import { GET as checkoutReturn } from '@/app/checkout/return/route';
import { recordCartOrder, type CartSeat } from '@/app/tickets/cart-order';
import { db as webDb } from '@/lib/firestore';
import { orderIdFor } from '@/lib/registrations';

let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. These tests write orders and registrations ' +
        'and must never run against the live project. Use: npm run test:group-purchase',
    );
  }
  // The website's own store. Its `firebase-admin` is a separate install from
  // the repo root's, so a second app initialised here would be a different
  // client of the same emulator, and a sentinel built by one fails in the other.
  db = webDb() as unknown as Firestore;
});

const TIERS = {
  'main-conference': 'Main Conference',
  virtual: 'Virtual',
  'all-access': 'All Access (VIP)',
} as const;
type TierId = keyof typeof TIERS;

async function wipe(collection: string) {
  const snap = await db.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  mocks.sessions.clear();
  mocks.sent.length = 0;
  await Promise.all(
    [COLLECTIONS.registrations, COLLECTIONS.orders, COLLECTIONS.ticketTypes, 'referralCodes'].map(wipe),
  );
  for (const [id, name] of Object.entries(TIERS)) {
    await db.collection(COLLECTIONS.ticketTypes).doc(id).set({
      eventId: EVENT_ID,
      name,
      priceCents: 10_000,
      currency: 'usd',
      quantityTotal: 100,
      quantitySold: 0,
    });
  }
});

interface Party {
  sessionId: string;
  seats: (CartSeat & { ticketTypeId: TierId })[];
}

function seat(name: string, email: string, tier: TierId): CartSeat & { ticketTypeId: TierId } {
  return { name, email, ticketType: TIERS[tier], ticketTypeId: tier, priceCents: 10_000 };
}

const TWO: Omit<Party, 'sessionId'> = {
  seats: [seat('Ada Nakamura', 'Ada@Example.com', 'main-conference'), seat('Ben Olsen', 'ben@example.com', 'virtual')],
};
const THREE: Omit<Party, 'sessionId'> = {
  seats: [
    seat('Ada Nakamura', 'Ada@Example.com', 'main-conference'),
    seat('Ben Olsen', 'ben@example.com', 'virtual'),
    seat('Cara Diaz', 'cara@example.com', 'all-access'),
  ],
};

/** What `startCheckout` does for a multi-seat cart, then Stripe marks it paid. */
async function paidCart(party: Omit<Party, 'sessionId'>, sessionId: string): Promise<Party> {
  const [buyer] = party.seats;
  if (party.seats.length > 1) {
    await recordCartOrder({
      sessionId,
      buyerEmail: buyer.email,
      buyerName: buyer.name,
      seats: party.seats,
      currency: 'usd',
    });
  }
  mocks.sessions.set(sessionId, {
    id: sessionId,
    object: 'checkout.session',
    payment_status: 'paid',
    status: 'complete',
    amount_total: 10_000 * party.seats.length,
    amount_subtotal: 10_000 * party.seats.length,
    currency: 'usd',
    customer_details: { email: buyer.email, name: buyer.name },
    customer_email: buyer.email,
    total_details: { amount_tax: 0, amount_discount: 0 },
    metadata: {
      source: 'kgc-web',
      tier: buyer.ticketTypeId,
      ticketType: buyer.ticketType,
      name: buyer.name,
      seats: String(party.seats.length),
    },
  });
  return { ...party, sessionId };
}

async function deliverWebhook(sessionId: string) {
  const res = await webhook(
    new NextRequest('https://www.knowledgegraph.tech/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=x' },
      body: JSON.stringify({
        id: `evt_${sessionId}`,
        type: 'checkout.session.completed',
        data: { object: mocks.sessions.get(sessionId) },
      }),
    }),
  );
  expect(res.status).toBe(200);
  return res.json();
}

async function buyerReturns(sessionId: string) {
  const res = await checkoutReturn(
    new NextRequest(`https://www.knowledgegraph.tech/checkout/return?session_id=${sessionId}`),
  );
  expect(res.status).toBe(307);
  return res.headers.get('location') ?? '';
}

/** Everything a settled group purchase must have, whatever order things arrived in. */
async function expectFullyFulfilled(party: Party) {
  const oid = orderIdFor(party.sessionId);
  const emails = party.seats.map((s) => normaliseEmail(s.email));

  const regs = await db.collection(COLLECTIONS.registrations).where('orderId', '==', oid).get();
  const byEmail = new Map<string, RegistrationDoc[]>();
  for (const d of regs.docs) {
    const r = d.data() as RegistrationDoc;
    byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);
  }
  // One registration per seat, each active with its own tier.
  expect(regs.size).toBe(party.seats.length);
  for (const s of party.seats) {
    const rows = byEmail.get(normaliseEmail(s.email)) ?? [];
    expect(rows, `registrations for ${s.email}`).toHaveLength(1);
    expect(rows[0].status).toBe('active');
    expect(rows[0].ticketType).toBe(s.ticketType);
  }

  // One confirmation per seat, to that seat's own address.
  const sentTo = mocks.sent.map((m) => m.to).sort();
  expect(sentTo, 'confirmation emails').toEqual([...emails].sort());

  // Each seat counted once against its own tier.
  for (const tier of Object.keys(TIERS) as TierId[]) {
    const expected = party.seats.filter((s) => s.ticketTypeId === tier).length;
    const t = (await db.collection(COLLECTIONS.ticketTypes).doc(tier).get()).data();
    expect(t?.quantitySold, `quantitySold for ${tier}`).toBe(expected);
  }

  // The order is paid and still names every seat.
  const order = (await db.collection(COLLECTIONS.orders).doc(oid).get()).data() as OrderDoc;
  expect(order.status).toBe('paid');
  expect(order.items.map((i) => i.attendeeEmail).sort()).toEqual([...emails].sort());
  expect(order.items.map((i) => i.ticketTypeId).sort()).toEqual(party.seats.map((s) => s.ticketTypeId).sort());
  expect(new Set(order.registrationIds).size).toBe(party.seats.length);
  expect(order.registrationIds).toHaveLength(party.seats.length);
}

describe.each([
  ['2-seat', TWO],
  ['3-seat', THREE],
])('a %s mixed-tier group purchase', (label, party) => {
  it('is fully fulfilled when the buyer is redirected before the webhook arrives', async () => {
    const p = await paidCart(party, `cs_test_${label}_return_first`);
    const location = await buyerReturns(p.sessionId);
    expect(location).toMatch(/\/order\//);
    await deliverWebhook(p.sessionId);
    await expectFullyFulfilled(p);
  });

  it('is fully fulfilled when the webhook arrives before the buyer is redirected', async () => {
    const p = await paidCart(party, `cs_test_${label}_webhook_first`);
    await deliverWebhook(p.sessionId);
    expect(await buyerReturns(p.sessionId)).toMatch(/\/order\//);
    await expectFullyFulfilled(p);
  });

  it('is fully fulfilled when both arrive at the same moment', async () => {
    const p = await paidCart(party, `cs_test_${label}_together`);
    await Promise.all([buyerReturns(p.sessionId), deliverWebhook(p.sessionId)]);
    await expectFullyFulfilled(p);
  });

  it('is fulfilled once when both are replayed, in either order', async () => {
    const p = await paidCart(party, `cs_test_${label}_replayed`);
    await buyerReturns(p.sessionId);
    await deliverWebhook(p.sessionId);
    await deliverWebhook(p.sessionId);
    await buyerReturns(p.sessionId);
    await Promise.all([deliverWebhook(p.sessionId), buyerReturns(p.sessionId)]);
    await expectFullyFulfilled(p);
  });

  it('reports every seat counted from whichever path came first', async () => {
    const p = await paidCart(party, `cs_test_${label}_report`);
    const first = await deliverWebhook(p.sessionId);
    expect(first).toMatchObject({ seats: party.seats.length, seatsCounted: party.seats.length });
    const again = await deliverWebhook(p.sessionId);
    expect(again).toMatchObject({ seats: party.seats.length, seatsCounted: 0 });
  });
});

describe('a single-seat purchase', () => {
  it('is fulfilled once whichever path arrives first, and replays change nothing', async () => {
    const p = await paidCart({ seats: [seat('Dee Park', 'dee@example.com', 'virtual')] }, 'cs_test_single');
    await buyerReturns(p.sessionId);
    await deliverWebhook(p.sessionId);
    await deliverWebhook(p.sessionId);
    await buyerReturns(p.sessionId);
    await expectFullyFulfilled(p);
    const order = (await db.collection(COLLECTIONS.orders).doc(orderIdFor(p.sessionId)).get()).data() as OrderDoc;
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ ticketTypeId: 'virtual', ticketTypeName: 'Virtual', unitPriceCents: 10_000 });
  });
});

describe('a session the website did not start', () => {
  it('fulfils nothing on either path', async () => {
    const p = await paidCart({ seats: [seat('Eve Ross', 'eve@example.com', 'virtual')] }, 'cs_test_foreign');
    const session = mocks.sessions.get(p.sessionId) as { metadata: Record<string, string> };
    session.metadata = {};
    expect(await buyerReturns(p.sessionId)).toMatch(/\/tickets\/checkout$/);
    expect(await deliverWebhook(p.sessionId)).toMatchObject({ skipped: 'not a website checkout session' });
    expect((await db.collection(COLLECTIONS.registrations).get()).size).toBe(0);
    expect((await db.collection(COLLECTIONS.orders).get()).size).toBe(0);
    expect(mocks.sent).toHaveLength(0);
  });
});
