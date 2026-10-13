/**
 * The Stripe webhook decides which payments become tickets.
 *
 * Since 2026-10-03 the answer is "only the ones the website's tickets page
 * started". Before that, any paid Checkout session in the account was
 * fulfilled, and one without a ticket name fell back to Main Conference, which
 * is how a Payment Link made in the Stripe dashboard issued a full ticket on
 * 2026-10-01.
 *
 * The route is imported for real. What it calls to write Firestore, create
 * accounts and send email is mocked, so each test can say exactly which of
 * those happened.
 *
 * `/checkout/return`, the redirect that fulfils the same session a moment
 * before the webhook does, is held to the same rule.
 *
 * Run with: npm run test:webhook
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fulfilOrder: vi.fn(),
  recordWarning: vi.fn(),
  recordError: vi.fn(),
  ensureRegistration: vi.fn(),
  seatsFromOrder: vi.fn(),
  markInvoiceOrderPaid: vi.fn(),
  cancelRegistrationByOrder: vi.fn(),
  provisionPurchaserAccount: vi.fn(),
  sendPurchaseConfirmation: vi.fn(),
  incrementSold: vi.fn(),
  countOrderSeatsOnce: vi.fn(async () => 0),
  noteIgnoredStripe: vi.fn(async () => undefined),
  tierFulfilment: vi.fn(),
  sessionsRetrieve: vi.fn(),
  fulfilPurchase: vi.fn(),
}));

vi.mock('@/lib/stripe', () => ({
  stripeEnabled: () => true,
  siteOrigin: () => 'https://www.knowledgegraph.tech',
  stripe: () => ({
    // The signature check is Stripe's; here the body is simply the event.
    webhooks: { constructEventAsync: async (raw: string) => JSON.parse(raw) },
    checkout: { sessions: { retrieve: mocks.sessionsRetrieve, list: vi.fn() } },
  }),
}));
vi.mock('@/lib/fulfil-order', () => ({
  fulfilOrder: mocks.fulfilOrder,
  // The invoice path claims each seat's email the same way a card purchase does.
  claimConfirmation: async () => 1,
  sendClaimed: async (_claim: unknown, send: () => Promise<unknown>) => void (await send()),
  confirmationsOutstanding: async () => [],
}));
vi.mock('@/lib/errors', () => ({
  recordWarning: mocks.recordWarning,
  recordError: mocks.recordError,
}));
vi.mock('@/lib/registrations', () => ({
  ensureRegistration: mocks.ensureRegistration,
  seatsFromOrder: mocks.seatsFromOrder,
  markInvoiceOrderPaid: mocks.markInvoiceOrderPaid,
  cancelRegistrationByOrder: mocks.cancelRegistrationByOrder,
  invoiceOrderId: (id: string) => `ord_${id}`,
  fulfilPurchase: mocks.fulfilPurchase,
  orderIdFor: (id: string) => `ord_${id}`,
}));
vi.mock('@/lib/analytics', () => ({
  analyticsConfig: () => null,
  encodePurchase: vi.fn(),
  PURCHASE_COOKIE: 'kgc_purchase',
}));
vi.mock('@/lib/app-account', () => ({ provisionPurchaserAccount: mocks.provisionPurchaserAccount }));
vi.mock('@/lib/app-account-core', () => ({
  grantOrderEntitlements: vi.fn(),
  uidForEmail: vi.fn(),
  withdrawOrderEntitlements: vi.fn(),
}));
vi.mock('@/lib/catalogue', () => ({
  incrementSold: mocks.incrementSold,
  tierFulfilment: mocks.tierFulfilment,
}));
vi.mock('@/lib/email', () => ({
  sendPurchaseConfirmation: mocks.sendPurchaseConfirmation,
  sendRefundConfirmation: vi.fn(),
  sendTicketWithdrawn: vi.fn(),
}));
// Every order read finds nothing: the invoice has not been refunded.
vi.mock('@/lib/stripe-ignored', () => ({ noteIgnoredStripe: mocks.noteIgnoredStripe }));
vi.mock('@kgc/scripts/src/lib/order-claims', () => ({ countOrderSeatsOnce: mocks.countOrderSeatsOnce }));
vi.mock('@/lib/firestore', () => ({
  db: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }) }) }),
}));
vi.mock('@/lib/order-token', () => ({ mintOrderToken: () => 'token' }));
vi.mock('@/app/tickets/cart-order', () => ({ cartLines: vi.fn() }));

import { POST } from '../../apps/web/src/app/api/stripe/webhook/route';
import { GET as checkoutReturn } from '../../apps/web/src/app/checkout/return/route';
import { NextRequest } from '../../apps/web/node_modules/next/server.js';
import { CHECKOUT_SOURCE, ticketingInvoice, websiteCheckout } from '../../apps/web/src/lib/checkout-source';

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

function deliver(event: { id: string; type: string; data: { object: unknown } }) {
  const req = new Request('https://www.knowledgegraph.tech/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=x', host: 'www.knowledgegraph.tech' },
    body: JSON.stringify(event),
  });
  return POST(req as never);
}

function session(metadata: Record<string, string>, over: Record<string, unknown> = {}) {
  return {
    id: 'cs_live_test',
    object: 'checkout.session',
    payment_status: 'paid',
    customer_details: { email: 'buyer@example.com', name: 'Ada Buyer' },
    customer_email: null,
    customer: 'cus_1',
    payment_intent: 'pi_1',
    payment_link: null,
    amount_total: 79900,
    amount_subtotal: 79900,
    currency: 'usd',
    total_details: { amount_tax: 0, amount_discount: 0 },
    metadata,
    ...over,
  };
}

const fulfilled = {
  registrationId: 'reg_1',
  created: true,
  account: 'created',
  seats: 1,
  seatsRegistered: 0,
  seatsCounted: 1,
  seatAccountsCreated: 0,
  seatAccountsFailed: 0,
  confirmationsOutstanding: [] as string[],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fulfilOrder.mockResolvedValue(fulfilled);
  mocks.sessionsRetrieve.mockResolvedValue({ payment_intent: null, discounts: [] });
  mocks.provisionPurchaserAccount.mockResolvedValue({
    status: 'created',
    uid: 'uid_1',
    temporaryPassword: null,
  });
  mocks.ensureRegistration.mockImplementation(async (input: { email: string; name: string }) => ({
    registrationId: `reg_${input.email}`,
    email: input.email,
    name: input.name,
    created: true,
    claimCode: '123456',
  }));
  mocks.markInvoiceOrderPaid.mockResolvedValue('ord_in_1');
  mocks.tierFulfilment.mockResolvedValue({ onSale: true, remaining: undefined, entitlements: [] });
  mocks.fulfilPurchase.mockResolvedValue({ registrationId: 'reg_1' });
});

describe('which Checkout sessions become tickets', () => {
  it('fulfils a session the tickets page created, with its own tier and name', async () => {
    const res = await deliver({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: session({
          source: CHECKOUT_SOURCE,
          tier: 'workshops',
          ticketType: 'Workshops Day',
          name: 'Ada Buyer',
          seats: '1',
        }),
      },
    });

    expect(res.status).toBe(200);
    expect(mocks.fulfilOrder).toHaveBeenCalledTimes(1);
    expect(mocks.fulfilOrder.mock.calls[0][0]).toMatchObject({
      externalId: 'cs_live_test',
      email: 'buyer@example.com',
      tierId: 'workshops',
      ticketType: 'Workshops Day',
      channel: 'checkout',
    });
    expect(mocks.recordWarning).not.toHaveBeenCalled();
  });

  it('no longer fulfils a session without the source marker (T142)', async () => {
    // Accepted for a day after the marker went live on 2026-10-03; sessions
    // last 24 hours, and the shared account makes a bare tier meaningless.
    const res = await deliver({
      id: 'evt_2',
      type: 'checkout.session.completed',
      data: { object: session({ tier: 'main-conference', ticketType: 'Main Conference', name: 'Ada' }) },
    });

    expect(res.status).toBe(200);
    expect(mocks.fulfilOrder).not.toHaveBeenCalled();
    expect(mocks.noteIgnoredStripe).toHaveBeenCalledTimes(1);
  });

  it('fulfils a free website order ($0, no_payment_required)', async () => {
    await deliver({
      id: 'evt_3',
      type: 'checkout.session.completed',
      data: {
        object: session(
          { source: CHECKOUT_SOURCE, tier: 'main-conference', ticketType: 'Main Conference' },
          { payment_status: 'no_payment_required', amount_total: 0 },
        ),
      },
    });
    expect(mocks.fulfilOrder).toHaveBeenCalledTimes(1);
  });

  it('fulfils a website session when a delayed payment clears', async () => {
    await deliver({
      id: 'evt_4',
      type: 'checkout.session.async_payment_succeeded',
      data: {
        object: session({ source: CHECKOUT_SOURCE, tier: 'main-conference', ticketType: 'Main Conference' }),
      },
    });
    expect(mocks.fulfilOrder).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a foreign session with no metadata and issues nothing', async () => {
    const res = await deliver({
      id: 'evt_5',
      type: 'checkout.session.completed',
      data: {
        object: session({}, { amount_total: 17500, payment_link: 'plink_1' }),
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, skipped: 'not a website checkout session' });
    // No order, registration, account, directory entry or email: all of those
    // live behind fulfilOrder and the account and mail helpers.
    expect(mocks.fulfilOrder).not.toHaveBeenCalled();
    expect(mocks.ensureRegistration).not.toHaveBeenCalled();
    expect(mocks.provisionPurchaserAccount).not.toHaveBeenCalled();
    expect(mocks.sendPurchaseConfirmation).not.toHaveBeenCalled();
    expect(mocks.incrementSold).not.toHaveBeenCalled();
    // Noted quietly, not as a warning: the Stripe account takes non-ticket
    // money as a matter of course (T142). Enough is kept to find the payment.
    expect(mocks.recordWarning).not.toHaveBeenCalled();
    expect(mocks.noteIgnoredStripe).toHaveBeenCalledTimes(1);
    expect(mocks.noteIgnoredStripe.mock.calls[0][0]).toMatchObject({
      kind: 'payment',
      stripeId: 'cs_live_test',
      email: 'buyer@example.com',
      amountCents: 17500,
      description: 'plink_1',
    });
  });

  it('does not fulfil a session whose metadata carries only a name, or another source', async () => {
    for (const metadata of [
      { name: 'Someone' },
      { tier: 'main-conference' },
      { ticketType: 'Main Conference' },
      { source: 'payment-link', tier: 'main-conference', ticketType: 'Main Conference' },
    ]) {
      const res = await deliver({
        id: 'evt_6',
        type: 'checkout.session.completed',
        data: { object: session(metadata) },
      });
      expect(res.status).toBe(200);
    }
    expect(mocks.fulfilOrder).not.toHaveBeenCalled();
    expect(mocks.noteIgnoredStripe).toHaveBeenCalledTimes(4);
    expect(mocks.recordWarning).not.toHaveBeenCalled();
  });

  it('says nothing about a foreign session until it is actually paid', async () => {
    const res = await deliver({
      id: 'evt_7',
      type: 'checkout.session.completed',
      data: { object: session({}, { payment_status: 'unpaid' }) },
    });
    expect(await res.json()).toMatchObject({ received: true, pending: true });
    expect(mocks.recordWarning).not.toHaveBeenCalled();
    expect(mocks.fulfilOrder).not.toHaveBeenCalled();
  });
});

describe('invoice.paid is unchanged', () => {
  function invoice(over: Record<string, unknown> = {}) {
    return {
      id: 'in_1',
      object: 'invoice',
      total: 160000,
      currency: 'usd',
      total_taxes: [],
      hosted_invoice_url: 'https://invoice.stripe.com/i/x',
      invoice_pdf: null,
      // Raised by `raiseInvoice`, so it carries the ticketing marker (T142).
      metadata: { source: 'kgc-web', kgcKind: 'group-registration' },
      ...over,
    };
  }

  it('registers every seat on our own invoice order', async () => {
    mocks.seatsFromOrder.mockResolvedValue([
      { name: 'Ben', email: 'ben@example.com', ticketType: 'Main Conference', ticketTypeId: 'main-conference' },
      { name: 'Cara', email: 'cara@example.com', ticketType: 'Main Conference', ticketTypeId: 'main-conference' },
    ]);

    const res = await deliver({ id: 'evt_8', type: 'invoice.paid', data: { object: invoice() } });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ registered: 2, orderId: 'ord_in_1' });
    expect(mocks.ensureRegistration).toHaveBeenCalledTimes(2);
    // Counted once for the order, shared with the dashboard's mark-paid (T139, N2).
    expect(mocks.countOrderSeatsOnce).toHaveBeenCalledTimes(1);
    expect(mocks.countOrderSeatsOnce.mock.calls[0].slice(1)).toEqual(['ord_in_1', ['main-conference', 'main-conference']]);
    expect(mocks.sendPurchaseConfirmation).toHaveBeenCalledTimes(2);
    expect(mocks.markInvoiceOrderPaid).toHaveBeenCalledTimes(1);
  });

  it('registers seats recovered from our invoice metadata when there is no order record', async () => {
    mocks.seatsFromOrder.mockResolvedValue([]);
    const attendees = JSON.stringify([{ n: 'Dee', e: 'dee@example.com', t: 'Main Conference' }]);

    const res = await deliver({
      id: 'evt_9',
      type: 'invoice.paid',
      data: { object: invoice({ metadata: { kgcKind: 'group-registration', attendees } }) },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ registered: 1 });
    expect(mocks.ensureRegistration.mock.calls[0][0]).toMatchObject({
      email: 'dee@example.com',
      ticketType: 'Main Conference',
    });
    // ticketTypeId '' from metadata: no catalogue entry, so no counter to move.
    expect(mocks.incrementSold).not.toHaveBeenCalled();
    expect(mocks.markInvoiceOrderPaid).toHaveBeenCalledTimes(1);
  });
});

describe('websiteCheckout', () => {
  it('trims and returns the tier and ticket name', () => {
    expect(websiteCheckout({ source: 'kgc-web', tier: ' vip ', ticketType: ' VIP ' })).toEqual({
      tierId: 'vip',
      ticketType: 'VIP',
    });
  });

  it('refuses null, empty and blank metadata', () => {
    expect(websiteCheckout(null)).toBeNull();
    expect(websiteCheckout(undefined)).toBeNull();
    expect(websiteCheckout({})).toBeNull();
    expect(websiteCheckout({ source: 'kgc-web', tier: ' ', ticketType: 'X' })).toBeNull();
  });

  it('requires the marker: a tier and ticket name alone are not a ticket (T142)', () => {
    expect(websiteCheckout({ tier: 'vip', ticketType: 'VIP' })).toBeNull();
    expect(websiteCheckout({ source: 'sponsor-portal', tier: 'vip', ticketType: 'VIP' })).toBeNull();
  });
});

describe('ticketingInvoice (T142)', () => {
  it('accepts our marker and the older kgcKind, and nothing else', () => {
    expect(ticketingInvoice({ source: 'kgc-web' })).toBe(true);
    expect(ticketingInvoice({ kgcKind: 'group-registration' })).toBe(true);
    expect(ticketingInvoice({ attendees: '[{"n":"A","e":"a@example.com","t":"VIP"}]' })).toBe(false);
    expect(ticketingInvoice({})).toBe(false);
    expect(ticketingInvoice(null)).toBe(false);
  });
});

describe('/checkout/return applies the same rule', () => {
  function visit(sessionId: string) {
    return checkoutReturn(
      new NextRequest(`https://www.knowledgegraph.tech/checkout/return?session_id=${sessionId}`, {
        headers: { host: 'www.knowledgegraph.tech', 'x-forwarded-proto': 'https' },
      }),
    );
  }

  it('fulfils a website session the same way the webhook does, with its tier', async () => {
    mocks.sessionsRetrieve.mockResolvedValue(
      session({ source: CHECKOUT_SOURCE, tier: 'vip', ticketType: 'All Access (VIP)', name: 'Ada' }),
    );
    mocks.fulfilOrder.mockResolvedValue({ registrationId: 'reg_1' });
    const res = await visit('cs_live_test');

    expect(res.headers.get('location')).toContain('/order/token');
    // The full fulfilment, not the one-seat `fulfilPurchase` it used to run,
    // which erased a group purchase's seat list before the webhook read it.
    expect(mocks.fulfilPurchase).not.toHaveBeenCalled();
    expect(mocks.fulfilOrder).toHaveBeenCalledTimes(1);
    expect(mocks.fulfilOrder.mock.calls[0][0]).toMatchObject({
      externalId: 'cs_live_test',
      tierId: 'vip',
      ticketType: 'All Access (VIP)',
      channel: 'checkout',
    });
  });

  it('will not mint a ticket from the id of a paid session the website did not start', async () => {
    mocks.sessionsRetrieve.mockResolvedValue(session({}, { payment_link: 'plink_1' }));
    const res = await visit('cs_live_foreign');

    expect(res.headers.get('location')).toBe('https://www.knowledgegraph.tech/tickets/checkout');
    expect(mocks.fulfilPurchase).not.toHaveBeenCalled();
    expect(mocks.fulfilOrder).not.toHaveBeenCalled();
  });
});

describe('a confirmation that has not gone out', () => {
  it('answers 503 so Stripe delivers the event again', async () => {
    mocks.fulfilOrder.mockResolvedValue({ ...fulfilled, confirmationsOutstanding: ['reg_2'] });
    const res = await deliver({
      id: 'evt_unsent',
      type: 'checkout.session.completed',
      data: {
        object: session({ source: CHECKOUT_SOURCE, tier: 'virtual', ticketType: 'Virtual', name: 'Ada Buyer' }),
      },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ confirmationsOutstanding: ['reg_2'] });
  });
});

