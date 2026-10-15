/**
 * T266: payment edge cases found by the T257 audit, each run through the real
 * `startCheckout`, webhook and return route against the Firestore emulator.
 * Stripe, email and Auth accounts are faked.
 *
 * Run with: npm run test:group-purchase
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Params = {
  line_items: { quantity: number }[];
  metadata: Record<string, string>;
  allow_promotion_codes?: boolean;
  payment_method_types?: string[];
  expires_at?: number;
};

const mocks = vi.hoisted(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_edges';
  process.env.WEB_ORDER_SECRET = 'test-order-secret-test-order-secret-0123';
  return {
    created: [] as Params[],
    /** Refuse Link once, as Stripe does when it is not switched on. */
    refuseLink: false,
    sessions: new Map<string, Record<string, unknown>>(),
    sessionByIntent: new Map<string, string>(),
    invoiceByIntent: new Map<string, string>(),
    sent: [] as string[],
    refunds: [] as string[],
    accessEnded: [] as string[],
  };
});

vi.mock('../../apps/web/node_modules/next/headers.js', () => ({
  headers: async () => new Headers({ host: 'www.knowledgegraph.tech', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.66' }),
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
        create: async (params: Params) => {
          if (mocks.refuseLink && params.payment_method_types?.includes('link')) {
            mocks.refuseLink = false;
            throw Object.assign(new Error('The payment method type "link" is invalid.'), {
              type: 'StripeInvalidRequestError',
              param: 'payment_method_types',
            });
          }
          mocks.created.push(params);
          const id = `cs_test_edges_${mocks.created.length}`;
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
    invoicePayments: {
      list: async ({ payment }: { payment?: { payment_intent: string } }) => {
        const invoice = payment ? mocks.invoiceByIntent.get(payment.payment_intent) : undefined;
        return { data: invoice ? [{ invoice }] : [] };
      },
    },
  }),
}));
vi.mock('@/lib/email', () => ({
  sendPurchaseConfirmation: async (input: { to: string }) => {
    mocks.sent.push(input.to);
    return 'sent';
  },
  sendRefundConfirmation: async (input: { to: string }) => {
    mocks.refunds.push(input.to);
    return 'sent';
  },
  sendTicketWithdrawn: async () => 'sent',
}));
vi.mock('@/lib/app-account', () => ({
  provisionPurchaserAccount: async () => ({ status: 'existing', uid: null, temporaryPassword: null }),
  endAppAccessAfterWithdrawal: async (emails: string[]) => {
    mocks.accessEnded.push(...emails);
    return emails;
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
// The website's own copy: a Timestamp from the root install fails its store's
// instanceof check (AGENTS.md gotcha 8).
import { Timestamp } from '../../apps/web/node_modules/firebase-admin/lib/firestore/index.js';
import { COLLECTIONS, EVENT_ID, type OrderDoc, type RegistrationDoc } from '@kgc/shared';
import { normaliseEmail, registrationId } from '@kgc/scripts/src/lib/ids';
import { startCheckout } from '@/app/tickets/actions';
import { POST as webhook } from '@/app/api/stripe/webhook/route';
import { GET as checkoutReturn } from '@/app/checkout/return/route';
import { recordCartOrder, type CartSeat } from '@/app/tickets/cart-order';
import { overCapacity, tierById, tierFulfilment } from '@/lib/catalogue';
import { db as webDb } from '@/lib/firestore';
import { invoiceOrderId, orderIdFor, recordInvoiceOrder } from '@/lib/registrations';

let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Use: npm run test:group-purchase');
  db = webDb() as unknown as Firestore;
});

async function wipe(collection: string) {
  const snap = await db.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

const MAIN = 'main-conference';
const BUNDLE = 'main-conference-ceu';
const TIERS: Record<string, Record<string, unknown>> = {
  [MAIN]: { name: 'Main Conference', priceCents: 10_000 },
  ceu: { name: 'Continuing education units', priceCents: 4_900, addOnFor: MAIN, visible: false },
  [BUNDLE]: { name: 'Main Conference + Continuing education units', priceCents: 0, bundleOf: [MAIN, 'ceu'], visible: false },
  'speaker-comp': { name: 'Speaker comp', priceCents: 0, visible: false },
};

beforeEach(async () => {
  mocks.created.length = 0;
  mocks.refuseLink = false;
  mocks.sessions.clear();
  mocks.sessionByIntent.clear();
  mocks.invoiceByIntent.clear();
  mocks.sent.length = 0;
  mocks.refunds.length = 0;
  mocks.accessEnded.length = 0;
  await Promise.all(
    [
      COLLECTIONS.ticketTypes,
      COLLECTIONS.orders,
      COLLECTIONS.registrations,
      COLLECTIONS.rateLimits,
      COLLECTIONS.auditLog,
      COLLECTIONS.stripeIgnored,
      COLLECTIONS.emailLog,
      'referralCodes',
    ].map(wipe),
  );
  for (const [id, t] of Object.entries(TIERS)) {
    await db.collection(COLLECTIONS.ticketTypes).doc(id).set({
      eventId: EVENT_ID,
      currency: 'usd',
      inPerson: true,
      quantitySold: 0,
      ...t,
    });
  }
});

const setTier = (id: string, data: Record<string, unknown>) => db.collection(COLLECTIONS.ticketTypes).doc(id).update(data);

// ---------------------------------------------------------------------------
// Checkout

function form(tiers: string[]) {
  const f = new FormData();
  f.append('tier', tiers[0]);
  f.append('name', 'Ada Nakamura');
  f.append('email', 'ada@example.com');
  tiers.slice(1).forEach((t, i) => {
    f.append('seatName', `Guest ${i + 2}`);
    f.append('seatEmail', `guest${i + 2}@example.com`);
    f.append('seatTier', t);
  });
  return f;
}

/** The session Stripe was asked for, or the error the form shows. */
async function checkout(tiers: string[]): Promise<Params | string> {
  try {
    const res = (await startCheckout({}, form(tiers))) as { error?: string };
    return res.error ?? 'no redirect and no error';
  } catch (err) {
    if (!(err as { url?: string }).url) throw err;
  }
  return mocks.created[mocks.created.length - 1];
}

async function session(tiers: string[]): Promise<Params> {
  const p = await checkout(tiers);
  if (typeof p === 'string') throw new Error(p);
  return p;
}

describe('what a Checkout session is created with', () => {
  it('takes card and Link only, so no delayed bank method appears (T257 #3)', async () => {
    expect((await session([MAIN])).payment_method_types).toEqual(['card', 'link']);
  });

  it('falls back to card alone when Stripe refuses Link', async () => {
    mocks.refuseLink = true;
    expect((await session([MAIN])).payment_method_types).toEqual(['card']);
  });

  it('takes a promotion code on one seat and not on a group cart (T257 #2)', async () => {
    expect((await session([MAIN])).allow_promotion_codes).toBe(true);
    expect((await session([MAIN, MAIN])).allow_promotion_codes).toBe(false);
  });

  it('expires within the hour (T257 #6)', async () => {
    const before = Math.floor(Date.now() / 1000);
    const p = await session([MAIN]);
    expect(p.expires_at! - before).toBeGreaterThanOrEqual(3_595);
    expect(p.expires_at! - before).toBeLessThanOrEqual(3_605);
  });

  it('expires when the sales window closes, if that is sooner', async () => {
    const close = new Date(Date.now() + 45 * 60_000);
    await setTier(MAIN, { salesCloseAt: Timestamp.fromDate(close) });
    expect((await session([MAIN])).expires_at).toBe(Math.floor(close.getTime() / 1000));
  });

  it('expires when a bundle part closes, too', async () => {
    const close = new Date(Date.now() + 40 * 60_000);
    await setTier('ceu', { salesCloseAt: Timestamp.fromDate(close) });
    expect((await session([BUNDLE])).expires_at).toBe(Math.floor(close.getTime() / 1000));
  });
});

describe('hidden tiers are not for sale (T262)', () => {
  it('refuses a hidden tier posted by id', async () => {
    expect(await checkout(['speaker-comp'])).toMatch(/Speaker comp is not available/);
    expect(mocks.created).toHaveLength(0);
  });

  it('refuses it as an extra seat too', async () => {
    expect(await checkout([MAIN, 'speaker-comp'])).toMatch(/Speaker comp is not available/);
  });

  it('still sells a hidden bundle whose base ticket is on the page', async () => {
    expect((await session([BUNDLE])).line_items).toHaveLength(1);
  });

  it('refuses a hidden bundle whose base ticket is hidden', async () => {
    await setTier(MAIN, { visible: false });
    expect(await checkout([BUNDLE])).toMatch(/not available/);
  });
});

describe('bundle sales count against their parts (T257 #8)', () => {
  it('a part is sold out once its bundles fill its cap', async () => {
    await setTier(MAIN, { quantityTotal: 2 });
    await setTier(BUNDLE, { quantitySold: 2 });
    expect((await tierById(MAIN))?.onSale).toBe(false);
    expect((await tierFulfilment(MAIN))?.remaining).toBe(0);
    expect((await tierFulfilment(BUNDLE))?.remaining).toBe(0);
    expect(await checkout([MAIN])).toMatch(/Main Conference is not available \(sold out\)/);
    expect(await checkout([BUNDLE])).toMatch(/not available \(sold out\)/);
  });

  it('a cart with a bundle and its base asks the base for both seats', async () => {
    await setTier(MAIN, { quantityTotal: 3 });
    await setTier(BUNDLE, { quantitySold: 2 });
    expect(await checkout([BUNDLE, MAIN])).toMatch(/Main Conference has only 1 seat left, and you asked for 2/);
  });

  it('overCapacity counts the bundle against the part', async () => {
    await setTier(MAIN, { quantityTotal: 2, quantitySold: 1 });
    await setTier(BUNDLE, { quantitySold: 2 });
    expect(await overCapacity([BUNDLE])).toEqual([{ id: MAIN, name: 'Main Conference', sold: 3, total: 2 }]);
  });
});

// ---------------------------------------------------------------------------
// After payment

type Seat = CartSeat;
const seat = (name: string, email: string, tier = MAIN): Seat => ({
  name,
  email,
  ticketType: TIERS[tier].name as string,
  ticketTypeId: tier,
  priceCents: 10_000,
});
const ADA = seat('Ada Nakamura', 'ada@example.com');
const BEN = seat('Ben Olsen', 'ben@example.com');
const CY = seat('Cy Park', 'cy@example.com');

async function paidSession(
  seats: Seat[],
  sessionId: string,
  over: { payment_status?: string; status?: string; discount?: number } = {},
) {
  const [buyer] = seats;
  if (seats.length > 1) {
    await recordCartOrder({ sessionId, buyerEmail: buyer.email, buyerName: buyer.name, seats, currency: 'usd' });
  }
  const pi = `pi_${sessionId}`;
  const subtotal = 10_000 * seats.length;
  mocks.sessionByIntent.set(pi, sessionId);
  mocks.sessions.set(sessionId, {
    id: sessionId,
    object: 'checkout.session',
    payment_status: over.payment_status ?? 'paid',
    status: over.status ?? 'complete',
    payment_intent: pi,
    amount_total: subtotal - (over.discount ?? 0),
    amount_subtotal: subtotal,
    currency: 'usd',
    customer_details: { email: buyer.email, name: buyer.name },
    customer_email: buyer.email,
    total_details: { amount_tax: 0, amount_discount: over.discount ?? 0 },
    metadata: { source: 'kgc-web', tier: buyer.ticketTypeId, ticketType: buyer.ticketType, name: buyer.name, seats: String(seats.length) },
  });
  return { sessionId, pi, oid: orderIdFor(sessionId) };
}

async function deliver(type: string, object: unknown) {
  return webhook(
    new NextRequest('https://www.knowledgegraph.tech/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=x' },
      body: JSON.stringify({ id: `evt_${type}_${Math.random()}`, type, data: { object } }),
    }),
  );
}

const completed = (sessionId: string) => deliver('checkout.session.completed', mocks.sessions.get(sessionId));
const refunded = (pi: string, amount: number) =>
  deliver('charge.refunded', { id: `ch_${pi}`, object: 'charge', payment_intent: pi, amount_refunded: amount, currency: 'usd' });
const dispute = (pi: string, status = 'needs_response', extra: Record<string, unknown> = {}) => ({
  id: `dp_${pi}`,
  object: 'dispute',
  payment_intent: pi,
  amount: 10_000,
  currency: 'usd',
  reason: 'fraudulent',
  status,
  evidence_details: { due_by: 1_800_000_000 },
  ...extra,
});

const order = async (oid: string) => (await db.collection(COLLECTIONS.orders).doc(oid).get()).data() as OrderDoc | undefined;
const reg = async (rid: string) => (await db.collection(COLLECTIONS.registrations).doc(rid).get()).data() as RegistrationDoc | undefined;
const sold = async (tier: string) => (await db.collection(COLLECTIONS.ticketTypes).doc(tier).get()).data()?.quantitySold;
const audits = async (action: string) =>
  (await db.collection(COLLECTIONS.auditLog).where('action', '==', action).get()).docs.map((d) => d.data());

async function existingTicket(email: string, how: string) {
  const rid = registrationId(normaliseEmail(email));
  await db.collection(COLLECTIONS.registrations).doc(rid).set({
    eventId: EVENT_ID,
    email: normaliseEmail(email),
    name: how,
    ticketType: how,
    status: 'active',
    claimCode: 'ABCD-EFGH',
    qrSecret: 'q'.repeat(32),
    altEmails: [],
  });
  return rid;
}

describe('a discount that pays for a whole group cart (T257 #2)', () => {
  it('is fulfilled and flagged in auditLog once', async () => {
    const c = await paidSession([ADA, BEN, CY], 'cs_free_group', { payment_status: 'no_payment_required', discount: 30_000 });
    expect((await completed(c.sessionId)).status).toBe(200);
    expect((await completed(c.sessionId)).status).toBe(200);
    const flagged = await audits('checkout.discountCoveredCart');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].after).toMatchObject({ seats: 3, discountCents: 30_000, subtotalCents: 30_000 });
  });

  it('is not flagged for a single seat, or a partial discount', async () => {
    await completed((await paidSession([ADA], 'cs_free_single', { payment_status: 'no_payment_required', discount: 10_000 })).sessionId);
    await completed((await paidSession([ADA, BEN], 'cs_part_group', { discount: 5_000 })).sessionId);
    expect(await audits('checkout.discountCoveredCart')).toHaveLength(0);
  });
});

describe('a delayed payment that has not cleared (T257 #3)', () => {
  it('sends the buyer to "payment processing", not "Checkout was cancelled"', async () => {
    const c = await paidSession([ADA], 'cs_ach', { payment_status: 'unpaid', status: 'complete' });
    const res = await checkoutReturn(new NextRequest(`https://www.knowledgegraph.tech/checkout/return?session_id=${c.sessionId}`));
    expect(res.headers.get('location')).toBe('https://www.knowledgegraph.tech/checkout/received?state=processing');
    expect(await order(c.oid)).toBeUndefined();
  });

  it('still sends an unpaid session that never completed back to checkout', async () => {
    const c = await paidSession([ADA], 'cs_open', { payment_status: 'unpaid', status: 'open' });
    const res = await checkoutReturn(new NextRequest(`https://www.knowledgegraph.tech/checkout/return?session_id=${c.sessionId}`));
    expect(res.headers.get('location')).toBe('https://www.knowledgegraph.tech/tickets/checkout?cancelled=1');
  });
});

describe('a refund or dispute on an order still pending (T257 #4)', () => {
  it.each([
    ['charge.refunded', 'refunded'],
    ['charge.dispute.created', 'cancelled'],
  ] as const)('%s cancels no unrelated ticket and moves no seat', async (type, status) => {
    const speaker = await existingTicket('ada@example.com', 'Speaker');
    const imported = await existingTicket('ben@example.com', 'Imported');
    const c = await paidSession([ADA, BEN, CY], `cs_pending_${type}`);
    // Fulfilment never ran: the cart order is still pending.
    expect((await order(c.oid))?.status).toBe('pending');

    const res =
      type === 'charge.refunded' ? await refunded(c.pi, 30_000) : await deliver(type, dispute(c.pi));
    expect(res.status).toBe(200);
    expect((await reg(speaker))?.status).toBe('active');
    expect((await reg(imported))?.status).toBe('active');
    expect(await sold(MAIN)).toBe(0);
    expect((await order(c.oid))?.status).toBe(status);
    expect(await audits('refund.unfulfilledOrder')).toHaveLength(1);
    expect(mocks.accessEnded).toEqual([]);
    if (type === 'charge.refunded') expect(mocks.refunds).toEqual(['ada@example.com']);
    else expect((await order(c.oid))?.disputedAt).toBeTruthy();
  });
});

describe('the card path tells organizers when it oversells (T257 #5)', () => {
  it('flags the second buyer of the last seat', async () => {
    await setTier(MAIN, { quantityTotal: 1 });
    await completed((await paidSession([ADA], 'cs_last_1')).sessionId);
    expect(await audits('checkout.oversold')).toHaveLength(0);
    const second = await paidSession([BEN], 'cs_last_2');
    await completed(second.sessionId);
    await completed(second.sessionId);
    const flagged = await audits('checkout.oversold');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].after).toMatchObject({ tickets: ['Main Conference: 2 sold of 1'] });
  });
});

describe('disputes raise a task for a person (T257 #7)', () => {
  it('dispute.created withdraws the ticket, ends app access and says so in auditLog once', async () => {
    const c = await paidSession([ADA], 'cs_disputed');
    await completed(c.sessionId);
    expect((await deliver('charge.dispute.created', dispute(c.pi))).status).toBe(200);
    expect((await deliver('charge.dispute.created', dispute(c.pi))).status).toBe(200);
    const opened = await audits('dispute.opened');
    expect(opened).toHaveLength(1);
    expect(opened[0].after).toMatchObject({ disputeId: `dp_${c.pi}`, reason: 'fraudulent', ticketsWithdrawn: 1 });
    expect(mocks.accessEnded).toEqual(['ada@example.com']);
  });

  it.each(['won', 'warning_closed'])('dispute.closed (%s) asks for the tickets to be reinstated', async (status) => {
    const c = await paidSession([ADA], `cs_won_${status}`);
    await completed(c.sessionId);
    await deliver('charge.dispute.created', dispute(c.pi));
    expect((await deliver('charge.dispute.closed', dispute(c.pi, status))).status).toBe(200);
    const won = await audits('dispute.won');
    expect(won).toHaveLength(1);
    expect(won[0].after).toMatchObject({ buyer: 'ada@example.com', orderStatus: 'cancelled' });
    // Nothing is reinstated by the webhook itself.
    expect((await order(c.oid))?.status).toBe('cancelled');
  });

  it('a lost dispute raises nothing more', async () => {
    const c = await paidSession([ADA], 'cs_lost');
    await completed(c.sessionId);
    await deliver('charge.dispute.created', dispute(c.pi));
    await deliver('charge.dispute.closed', dispute(c.pi, 'lost'));
    expect(await audits('dispute.won')).toHaveLength(0);
  });

  it('a dispute that is not ticketing is ignored', async () => {
    const res = await deliver('charge.dispute.closed', dispute('pi_someone_else', 'won'));
    expect(await res.json()).toMatchObject({ ignored: 'not a ticketing payment' });
    expect(await audits('dispute.won')).toHaveLength(0);
  });
});

describe('a refund ends app access for whoever is left with no ticket (T259 #6)', () => {
  it('passes every withdrawn seat to the access check', async () => {
    const c = await paidSession([ADA, BEN], 'cs_refund_access');
    await completed(c.sessionId);
    await refunded(c.pi, 20_000);
    expect(mocks.accessEnded.sort()).toEqual(['ada@example.com', 'ben@example.com']);
  });

  it('a partial refund ends nothing', async () => {
    const c = await paidSession([ADA], 'cs_partial_access');
    await completed(c.sessionId);
    await refunded(c.pi, 2_000);
    expect(mocks.accessEnded).toEqual([]);
  });
});

describe('invoices that will never be paid (T257 #9)', () => {
  async function raised(invoiceId: string) {
    await recordInvoiceOrder({
      invoiceId,
      billingEmail: 'ap@acme.example',
      companyName: 'Acme',
      seats: [ADA, BEN],
      currency: 'usd',
      totalCents: 20_000,
    });
    return invoiceOrderId(invoiceId);
  }

  it.each(['invoice.voided', 'invoice.marked_uncollectible'])('%s cancels the pending order', async (type) => {
    const oid = await raised(`in_${type}`);
    expect((await order(oid))?.status).toBe('pending');
    expect((await deliver(type, { id: `in_${type}`, object: 'invoice', metadata: {} })).status).toBe(200);
    expect((await order(oid))?.status).toBe('cancelled');
    expect(await sold(MAIN)).toBe(0);
  });

  it('writes nothing for an invoice ticketing never raised', async () => {
    await deliver('invoice.voided', { id: 'in_sponsorship', object: 'invoice', metadata: {} });
    expect(await order(invoiceOrderId('in_sponsorship'))).toBeUndefined();
  });
});

describe('an abandoned single-seat checkout keeps who started it (T257)', () => {
  it('stores the buyer’s email on the cancelled stub', async () => {
    const c = await paidSession([ADA], 'cs_abandoned', { payment_status: 'unpaid', status: 'expired' });
    await deliver('checkout.session.expired', mocks.sessions.get(c.sessionId));
    expect(await order(c.oid)).toMatchObject({ status: 'cancelled', email: 'ada@example.com', buyerName: 'Ada Nakamura' });
  });
});
