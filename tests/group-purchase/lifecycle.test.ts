/**
 * What happens to a purchase after it is paid, or when it never is: refunds,
 * disputes, expiries, replays and failures, each arriving in the order Stripe
 * can actually send them.
 *
 * Every case here failed against `ba76188` (T135, T136). They run the real
 * webhook and return-route handlers against the Firestore emulator; Stripe,
 * email and Auth accounts are faked.
 *
 * Run with: npm run test:group-purchase
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORDER_SECRET = 'test-order-secret-test-order-secret-0123';

const mocks = vi.hoisted(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_lifecycle';
  process.env.WEB_ORDER_SECRET = 'test-order-secret-test-order-secret-0123';
  return {
    sessions: new Map<string, unknown>(),
    /** payment intent → Checkout session id, as `checkout.sessions.list` answers. */
    sessionByIntent: new Map<string, string>(),
    /** payment intent → invoice id, as `invoicePayments.list` answers. */
    invoiceByIntent: new Map<string, string>(),
    sent: [] as { to: string; ticketType: string; registrationId?: string; orderId?: string }[],
    refunds: [] as { to: string; amountCents?: number }[],
    failNext: new Map<string, 'failed' | 'throw'>(),
    provisionThrows: false,
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
        list: async ({ payment_intent }: { payment_intent: string }) => {
          const id = mocks.sessionByIntent.get(payment_intent);
          return { data: id ? [mocks.sessions.get(id)] : [] };
        },
        listLineItems: async () => ({ data: [] }),
      },
    },
    invoicePayments: {
      list: async ({ payment }: { payment: { payment_intent: string } }) => {
        const invoice = mocks.invoiceByIntent.get(payment.payment_intent);
        return { data: invoice ? [{ invoice }] : [] };
      },
    },
  }),
}));
vi.mock('@/lib/email', () => ({
  sendPurchaseConfirmation: async (input: { to: string; ticketType: string; registrationId?: string; orderId?: string }) => {
    const fail = mocks.failNext.get(input.to);
    if (fail) {
      mocks.failNext.delete(input.to);
      if (fail === 'throw') throw new Error('send blew up');
      return fail;
    }
    mocks.sent.push({ to: input.to, ticketType: input.ticketType, registrationId: input.registrationId, orderId: input.orderId });
    return 'sent';
  },
  sendRefundConfirmation: async (input: { to: string; amountCents?: number }) => {
    mocks.refunds.push({ to: input.to, amountCents: input.amountCents });
    return 'sent';
  },
  sendTicketWithdrawn: async () => 'sent',
}));
vi.mock('@/lib/app-account', () => ({
  provisionPurchaserAccount: async () => {
    if (mocks.provisionThrows) throw new Error('auth unreachable');
    return { status: 'existing', uid: null, temporaryPassword: null };
  },
}));
vi.mock('@/lib/analytics', () => ({
  analyticsConfig: () => null,
  encodePurchase: () => '',
  decodePurchase: () => null,
  PURCHASE_COOKIE: 'kgc_purchase',
}));

import { NextRequest } from '../../apps/web/node_modules/next/server.js';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type OrderDoc, type RegistrationDoc } from '@kgc/shared';
import { normaliseEmail, registrationId } from '@kgc/scripts/src/lib/ids';
import { POST as webhook } from '@/app/api/stripe/webhook/route';
import { GET as checkoutReturn } from '@/app/checkout/return/route';
import { recordCartOrder, type CartSeat } from '@/app/tickets/cart-order';
import { db as webDb } from '@/lib/firestore';
import { getRegistration, invoiceOrderId, orderIdFor, recordInvoiceOrder } from '@/lib/registrations';

let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:group-purchase');
  }
  db = webDb() as unknown as Firestore;
});

const TIERS = { 'main-conference': 'Main Conference', virtual: 'Virtual' } as const;
type TierId = keyof typeof TIERS;

async function wipe(collection: string) {
  const snap = await db.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  mocks.sessions.clear();
  mocks.sessionByIntent.clear();
  mocks.invoiceByIntent.clear();
  mocks.sent.length = 0;
  mocks.refunds.length = 0;
  mocks.failNext.clear();
  mocks.provisionThrows = false;
  process.env.WEB_ORDER_SECRET = ORDER_SECRET;
  await Promise.all(
    [COLLECTIONS.registrations, COLLECTIONS.orders, COLLECTIONS.ticketTypes, COLLECTIONS.auditLog, 'referralCodes'].map(wipe),
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

type Seat = CartSeat & { ticketTypeId: TierId };
const seat = (name: string, email: string, tier: TierId): Seat => ({
  name,
  email,
  ticketType: TIERS[tier],
  ticketTypeId: tier,
  priceCents: 10_000,
});
const ADA = seat('Ada Nakamura', 'ada@example.com', 'main-conference');
const BEN = seat('Ben Olsen', 'ben@example.com', 'virtual');

/** What `startCheckout` writes, and the session Stripe holds for it. */
async function checkout(seats: Seat[], sessionId: string, paid = true, metadata?: Record<string, string>) {
  const [buyer] = seats;
  if (seats.length > 1) {
    await recordCartOrder({ sessionId, buyerEmail: buyer.email, buyerName: buyer.name, seats, currency: 'usd' });
  }
  const pi = `pi_${sessionId}`;
  mocks.sessionByIntent.set(pi, sessionId);
  mocks.sessions.set(sessionId, {
    id: sessionId,
    object: 'checkout.session',
    payment_status: paid ? 'paid' : 'unpaid',
    status: paid ? 'complete' : 'open',
    payment_intent: pi,
    amount_total: 10_000 * seats.length,
    amount_subtotal: 10_000 * seats.length,
    currency: 'usd',
    customer_details: { email: buyer.email, name: buyer.name },
    customer_email: buyer.email,
    total_details: { amount_tax: 0, amount_discount: 0 },
    metadata: metadata ?? {
      source: 'kgc-web',
      tier: buyer.ticketTypeId,
      ticketType: buyer.ticketType,
      name: buyer.name,
      seats: String(seats.length),
    },
  });
  return { sessionId, pi, oid: orderIdFor(sessionId) };
}

async function deliver(type: string, object: unknown, id = `evt_${type}_${Math.random()}`) {
  return webhook(
    new NextRequest('https://www.knowledgegraph.tech/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=x' },
      body: JSON.stringify({ id, type, data: { object } }),
    }),
  );
}

const completed = (sessionId: string) => deliver('checkout.session.completed', mocks.sessions.get(sessionId));
const refunded = (pi: string, amount: number) =>
  deliver('charge.refunded', { id: `ch_${pi}`, object: 'charge', payment_intent: pi, amount_refunded: amount, currency: 'usd' });

async function buyerReturns(sessionId: string) {
  const res = await checkoutReturn(
    new NextRequest(`https://www.knowledgegraph.tech/checkout/return?session_id=${sessionId}`),
  );
  expect(res.status).toBe(307);
  return res.headers.get('location') ?? '';
}

const order = async (oid: string) => (await db.collection(COLLECTIONS.orders).doc(oid).get()).data() as OrderDoc | undefined;
const reg = async (rid: string) => (await db.collection(COLLECTIONS.registrations).doc(rid).get()).data() as RegistrationDoc | undefined;
const sold = async (tier: TierId) => (await db.collection(COLLECTIONS.ticketTypes).doc(tier).get()).data()?.quantitySold;
const statuses = async (oid: string) => {
  const snap = await db.collection(COLLECTIONS.registrations).where('orderId', '==', oid).get();
  return snap.docs.map((d) => (d.data() as RegistrationDoc).status).sort();
};

/** A registration that is not backed by a paid order under its own address. */
async function existingTicket(email: string, how: string) {
  const rid = registrationId(normaliseEmail(email));
  await db.collection(COLLECTIONS.registrations).doc(rid).set({
    eventId: EVENT_ID,
    email: normaliseEmail(email),
    name: 'Ada Nakamura',
    ticketType: how,
    status: 'active',
    claimCode: 'ABCD-EFGH',
    qrSecret: 'q'.repeat(32),
    altEmails: [],
  });
  return rid;
}

describe('an unpaid checkout that ends (S1, TK-205/206, TK-144/145)', () => {
  it.each(['checkout.session.expired', 'checkout.session.async_payment_failed'])(
    '%s on an abandoned group cart leaves the buyer’s existing ticket alone',
    async (type) => {
      for (const how of ['Imported', 'Comp', 'Speaker']) {
        const rid = await existingTicket('ada@example.com', how);
        const c = await checkout([ADA, BEN], `cs_abandon_${type}_${how}`, false);
        const res = await deliver(type, mocks.sessions.get(c.sessionId));
        expect(res.status).toBe(200);
        expect((await reg(rid))?.status, how).toBe('active');
        expect((await order(c.oid))?.status).toBe('cancelled');
      }
    },
  );

  it.each(['checkout.session.expired', 'checkout.session.async_payment_failed'])(
    'a late %s does not cancel a paid order or any of its tickets',
    async (type) => {
      const c = await checkout([ADA, BEN], `cs_late_${type}`);
      expect((await completed(c.sessionId)).status).toBe(200);
      const res = await deliver(type, mocks.sessions.get(c.sessionId));
      expect(res.status).toBe(200);
      expect((await order(c.oid))?.status).toBe('paid');
      expect(await statuses(c.oid)).toEqual(['active', 'active']);
      expect(await sold('main-conference')).toBe(1);
      expect(await sold('virtual')).toBe(1);
    },
  );

  it('still records an expired single-seat checkout as cancelled, with nothing issued', async () => {
    const c = await checkout([ADA], 'cs_single_expired', false);
    await deliver('checkout.session.expired', mocks.sessions.get(c.sessionId));
    expect(await order(c.oid)).toMatchObject({ status: 'cancelled', totalCents: 0 });
    expect((await order(c.oid))?.refundedAt).toBeUndefined();
    expect((await db.collection(COLLECTIONS.registrations).get()).size).toBe(0);
  });
});

describe('a refunded order never comes back (S12/S13, TK-143/146/162/163)', () => {
  it('a replayed sale after a full refund leaves both tickets cancelled and sends nothing (TK-146)', async () => {
    const c = await checkout([ADA, BEN], 'cs_replay_after_refund');
    await completed(c.sessionId);
    expect(mocks.sent).toHaveLength(2);
    const before = (await order(c.oid))?.purchasedAt;
    expect((await refunded(c.pi, 20_000)).status).toBe(200);
    expect(await statuses(c.oid)).toEqual(['cancelled', 'cancelled']);

    const res = await completed(c.sessionId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: 'order refunded' });
    expect(await statuses(c.oid)).toEqual(['cancelled', 'cancelled']);
    expect(mocks.sent).toHaveLength(2);
    expect(await sold('main-conference')).toBe(0);
    expect(await sold('virtual')).toBe(0);
    expect(await order(c.oid)).toMatchObject({ status: 'refunded' });
    expect((await order(c.oid))?.purchasedAt).toEqual(before);
  });

  it('the buyer reopening the return page after a refund gets the cancelled page, not a ticket (TK-162)', async () => {
    const c = await checkout([ADA], 'cs_reopen_after_refund');
    await buyerReturns(c.sessionId);
    await refunded(c.pi, 10_000);
    const location = await buyerReturns(c.sessionId);
    expect(location).toMatch(/\/order\//);
    const rid = registrationId('ada@example.com');
    expect((await reg(rid))?.status).toBe('cancelled');
    expect((await getRegistration(rid))?.status).toBe('cancelled');
    expect(mocks.sent).toHaveLength(1);
  });

  it('a redelivery after the refund neither re-activates nor sends the outstanding confirmation (TK-163)', async () => {
    const c = await checkout([ADA, BEN], 'cs_redeliver_after_refund');
    mocks.failNext.set('ben@example.com', 'failed');
    expect((await completed(c.sessionId)).status).toBe(503);
    await refunded(c.pi, 20_000);
    const res = await completed(c.sessionId);
    expect(res.status).toBe(200);
    expect(await statuses(c.oid)).toEqual(['cancelled', 'cancelled']);
    expect(mocks.sent.map((m) => m.to)).toEqual(['ada@example.com']);
  });

  it('a refund that arrives before the sale leaves no active ticket and sends nothing (TK-143)', async () => {
    const c = await checkout([ADA], 'cs_refund_first');
    expect((await refunded(c.pi, 10_000)).status).toBe(200);
    expect((await completed(c.sessionId)).status).toBe(200);
    expect((await db.collection(COLLECTIONS.registrations).where('status', '==', 'active').get()).size).toBe(0);
    expect(mocks.sent).toHaveLength(0);
    expect(await sold('main-conference')).toBe(0);
    expect(await buyerReturns(c.sessionId)).toBe('https://www.knowledgegraph.tech/checkout/received?state=refunded');
  });

  it('a dispute is final in the same way', async () => {
    const c = await checkout([ADA], 'cs_replay_after_dispute');
    await completed(c.sessionId);
    await deliver('charge.dispute.created', { id: 'dp_1', object: 'dispute', payment_intent: c.pi, amount: 10_000 });
    await completed(c.sessionId);
    expect(await statuses(c.oid)).toEqual(['cancelled']);
  });
});

describe('the order page (S4, TK-322)', () => {
  it('reads the registration status, so a cancelled ticket is not shown as a pass', async () => {
    const c = await checkout([ADA], 'cs_order_page');
    await completed(c.sessionId);
    const rid = registrationId('ada@example.com');
    expect((await getRegistration(rid))?.status).toBe('active');
    await refunded(c.pi, 10_000);
    expect((await getRegistration(rid))?.status).toBe('cancelled');

    const { default: OrderPage } = await import('@/app/order/[token]/page');
    const { OrderVoidView, OrderView } = await import('@/app/order/order-view');
    const { mintOrderToken } = await import('@/lib/order-token');
    const el = (await OrderPage({ params: Promise.resolve({ token: mintOrderToken({ rid }) }) })) as { type: unknown };
    expect(el.type).toBe(OrderVoidView);
    expect(el.type).not.toBe(OrderView);
  });
});

describe('the return redirect when fulfilment fails (S5, TK-140, TK-326)', () => {
  it('sends a paying buyer to "payment received" rather than a 500, and the webhook finishes the job', async () => {
    const c = await checkout([ADA, BEN], 'cs_return_throws');
    mocks.provisionThrows = true;
    expect(await buyerReturns(c.sessionId)).toBe('https://www.knowledgegraph.tech/checkout/received');
    const logged = await db.collection(COLLECTIONS.auditLog).where('action', '==', 'checkout.return').get();
    expect(logged.size).toBe(1);

    mocks.provisionThrows = false;
    expect((await completed(c.sessionId)).status).toBe(200);
    expect(await statuses(c.oid)).toEqual(['active', 'active']);
    expect(mocks.sent.map((m) => m.to).sort()).toEqual(['ada@example.com', 'ben@example.com']);
  });

  it('writes no ticket when the order-link secret is missing, so no ticket goes unannounced (TK-326)', async () => {
    const c = await checkout([ADA], 'cs_no_secret');
    delete process.env.WEB_ORDER_SECRET;
    await expect(completed(c.sessionId)).rejects.toThrow(/WEB_ORDER_SECRET/);
    expect(await buyerReturns(c.sessionId)).toBe('https://www.knowledgegraph.tech/checkout/received');
    expect((await db.collection(COLLECTIONS.registrations).get()).size).toBe(0);

    process.env.WEB_ORDER_SECRET = ORDER_SECRET;
    expect((await completed(c.sessionId)).status).toBe(200);
    expect(await statuses(c.oid)).toEqual(['active']);
    expect(mocks.sent).toHaveLength(1);
  });
});

describe('refunds and disputes reach the right order', () => {
  async function paidInvoice(invoiceId: string, pi: string) {
    await recordInvoiceOrder({
      invoiceId,
      billingEmail: 'ap@acme.example',
      companyName: 'Acme',
      seats: [ADA, BEN].map((s) => ({ ...s, priceCents: 10_000 })),
      currency: 'usd',
      totalCents: 20_000,
    });
    mocks.invoiceByIntent.set(pi, invoiceId);
    const res = await deliver('invoice.paid', { id: invoiceId, object: 'invoice', total: 20_000, currency: 'usd', metadata: {} });
    expect(res.status).toBe(200);
    return invoiceOrderId(invoiceId);
  }

  it('a refunded invoice cancels every seat and gives the seats back (S2, TK-262)', async () => {
    const oid = await paidInvoice('in_refund', 'pi_invoice');
    expect(await statuses(oid)).toEqual(['active', 'active']);
    expect(await sold('main-conference')).toBe(1);

    const res = await refunded('pi_invoice', 20_000);
    expect(res.status).toBe(200);
    expect(await statuses(oid)).toEqual(['cancelled', 'cancelled']);
    expect(await order(oid)).toMatchObject({ status: 'refunded', refundedCents: 20_000 });
    expect(await sold('main-conference')).toBe(0);
    expect(await sold('virtual')).toBe(0);
  });

  it('a dispute gives the seat back and records no refund (S3, TK-265)', async () => {
    const c = await checkout([ADA], 'cs_dispute');
    await completed(c.sessionId);
    expect(await sold('main-conference')).toBe(1);
    const dispute = { id: 'dp_2', object: 'dispute', payment_intent: c.pi, amount: 10_000 };
    await deliver('charge.dispute.created', dispute);
    await deliver('charge.dispute.created', dispute);
    expect(await sold('main-conference')).toBe(0);
    const o = await order(c.oid);
    expect(o).toMatchObject({ status: 'cancelled', refundedCents: 0 });
    expect(o?.disputedAt).toBeDefined();
  });

  it('a refund of a payment the website did not take writes no order, only a warning (S9, TK-251)', async () => {
    const c = await checkout([ADA], 'cs_payment_link', true, {});
    const res = await refunded(c.pi, 17_500);
    expect(res.status).toBe(200);
    expect(await order(c.oid)).toBeUndefined();
    const warned = await db.collection(COLLECTIONS.auditLog).where('action', '==', 'refund.notFromWebsite').get();
    expect(warned.size).toBe(1);
  });
});

describe('confirmation rows name the order (TK-202)', () => {
  it('passes the order id with every seat’s confirmation', async () => {
    const c = await checkout([ADA, BEN], 'cs_email_order_id');
    await completed(c.sessionId);
    expect(mocks.sent).toHaveLength(2);
    for (const m of mocks.sent) expect(m.orderId).toBe(c.oid);
  });
});

describe('replays send nothing twice (S10/TK-255, TK-230)', () => {
  async function invoice(invoiceId: string) {
    await recordInvoiceOrder({
      invoiceId,
      billingEmail: 'ap@acme.example',
      companyName: 'Acme',
      seats: [ADA, BEN].map((s) => ({ ...s, priceCents: 10_000 })),
      currency: 'usd',
      totalCents: 20_000,
    });
    return { id: invoiceId, object: 'invoice', total: 20_000, currency: 'usd', metadata: {} };
  }

  it('a replayed invoice.paid emails each seat once', async () => {
    const inv = await invoice('in_replayed');
    for (let i = 0; i < 3; i += 1) expect((await deliver('invoice.paid', inv)).status).toBe(200);
    expect(mocks.sent.map((m) => m.to).sort()).toEqual(['ada@example.com', 'ben@example.com']);
    for (const m of mocks.sent) expect(m.orderId).toBe(invoiceOrderId('in_replayed'));
  });

  it('a replayed invoice.paid after the invoice was refunded issues and sends nothing', async () => {
    const inv = await invoice('in_refunded_replay');
    mocks.invoiceByIntent.set('pi_in_refunded_replay', 'in_refunded_replay');
    await deliver('invoice.paid', inv);
    await refunded('pi_in_refunded_replay', 20_000);
    const res = await deliver('invoice.paid', inv);
    expect(res.status).toBe(200);
    expect(await statuses(invoiceOrderId('in_refunded_replay'))).toEqual(['cancelled', 'cancelled']);
    expect(mocks.sent).toHaveLength(2);
  });

  it('a redelivered charge.refunded sends the refund receipt once', async () => {
    const c = await checkout([ADA], 'cs_refund_replayed');
    await completed(c.sessionId);
    for (let i = 0; i < 3; i += 1) expect((await refunded(c.pi, 10_000)).status).toBe(200);
    expect(mocks.refunds).toEqual([{ to: 'ada@example.com', amountCents: 10_000 }]);
  });

  it('a second refund that completes a partial one still gets its receipt', async () => {
    const c = await checkout([ADA], 'cs_refund_partial_then_full');
    await completed(c.sessionId);
    await refunded(c.pi, 4_000);
    await refunded(c.pi, 10_000);
    await refunded(c.pi, 10_000);
    expect(mocks.refunds).toEqual([{ to: 'ada@example.com', amountCents: 10_000 }]);
  });
});

describe('an invoice seat that names no ticket (S11, TK-256)', () => {
  it('is not registered as Main Conference; organizers are told', async () => {
    const res = await deliver('invoice.paid', {
      id: 'in_untyped',
      object: 'invoice',
      total: 20_000,
      currency: 'usd',
      metadata: { attendees: JSON.stringify([{ n: 'Ada Nakamura', e: 'ada@example.com', t: 'Virtual' }, { n: 'Ben Olsen', e: 'ben@example.com' }]) },
    });
    expect(res.status).toBe(200);
    const regs = (await db.collection(COLLECTIONS.registrations).get()).docs.map((d) => d.data() as RegistrationDoc);
    expect(regs.map((r) => [r.email, r.ticketType])).toEqual([['ada@example.com', 'Virtual']]);
    const warned = await db.collection(COLLECTIONS.auditLog).where('action', '==', 'invoice.seatWithoutTicket').get();
    expect(warned.size).toBe(1);
    expect(warned.docs[0].data().after.seats).toEqual(['ben@example.com']);
  });
});
