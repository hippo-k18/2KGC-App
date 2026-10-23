/**
 * A paid checkout queues its registrations for the HubSpot sync (T333), and a
 * HubSpot failure changes nothing about the sale.
 *
 * Unlike `stripe-webhook.test.ts`, `fulfilOrder` runs for real here, from the
 * webhook route down, because the trigger lives inside it (so the
 * `/checkout/return` redirect queues too). What it calls to write Firestore,
 * create accounts and send email is mocked, as is the HubSpot module itself:
 * no network, no emulator.
 *
 * Run with: npm run test:webhook
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queueAndKickHubspot: vi.fn(),
  recordError: vi.fn(async () => undefined),
  recordWarning: vi.fn(async () => undefined),
  fulfilPurchase: vi.fn(),
  ensureRegistration: vi.fn(),
  cartLines: vi.fn(),
  attachSeatRegistrations: vi.fn(async () => undefined),
  provisionPurchaserAccount: vi.fn(),
  sendPurchaseConfirmation: vi.fn(async () => 'sent'),
  incrementSold: vi.fn(async () => undefined),
  docs: new Map<string, Record<string, unknown>>(),
}));

vi.mock('@kgc/scripts/src/lib/hubspot-sync', () => ({ queueAndKickHubspot: mocks.queueAndKickHubspot }));
vi.mock('@/lib/stripe', () => ({
  stripeEnabled: () => true,
  siteOrigin: () => 'https://www.knowledgegraph.tech',
  stripe: () => ({
    webhooks: { constructEventAsync: async (raw: string) => JSON.parse(raw) },
    checkout: { sessions: { retrieve: async () => ({ payment_intent: null, discounts: [] }), list: vi.fn() } },
  }),
}));
vi.mock('@/lib/errors', () => ({ recordError: mocks.recordError, recordWarning: mocks.recordWarning }));
vi.mock('@/lib/registrations', () => ({
  fulfilPurchase: mocks.fulfilPurchase,
  ensureRegistration: mocks.ensureRegistration,
  orderIdFor: (id: string) => `ord_${id}`,
  invoiceOrderId: (id: string) => `ord_${id}`,
  cancelRegistrationByOrder: vi.fn(),
  cancelUnpaidOrder: vi.fn(),
  markInvoiceOrderPaid: vi.fn(),
  seatsFromOrder: vi.fn(),
}));
vi.mock('@/app/tickets/cart-order', () => ({
  cartLines: mocks.cartLines,
  attachSeatRegistrations: mocks.attachSeatRegistrations,
}));
vi.mock('@/lib/app-account', () => ({
  provisionPurchaserAccount: mocks.provisionPurchaserAccount,
  endAppAccessAfterWithdrawal: vi.fn(),
}));
vi.mock('@/lib/app-account-core', () => ({
  grantOrderEntitlements: vi.fn(),
  uidForEmail: vi.fn(),
  withdrawOrderEntitlements: vi.fn(),
}));
vi.mock('@/lib/catalogue', () => ({
  incrementSold: mocks.incrementSold,
  overCapacity: async () => [],
  tierFulfilment: async () => ({ onSale: true, entitlements: [] }),
}));
vi.mock('@/lib/email', () => ({
  sendPurchaseConfirmation: mocks.sendPurchaseConfirmation,
  sendRefundConfirmation: vi.fn(),
  sendTicketWithdrawn: vi.fn(),
}));
vi.mock('@/lib/stripe-ignored', () => ({ noteIgnoredStripe: vi.fn() }));
vi.mock('@/lib/order-token', () => ({ mintOrderToken: () => 'token' }));
vi.mock('@/lib/question-forms', () => ({ claimAnswers: async () => undefined }));
vi.mock('@kgc/scripts/src/lib/referrals', () => ({
  ensureReferralCode: async () => 'KGC27-TEST',
  recordReferral: vi.fn(),
}));
vi.mock('@kgc/scripts/src/lib/order-claims', async (original) => ({
  ...(await original<typeof import('../../scripts/src/lib/order-claims')>()),
  claimOnOrder: async () => 1,
  countOrderSeatsOnce: vi.fn(),
}));
// A map standing in for Firestore: enough for the order and registration reads
// and the confirmation bookkeeping `fulfilOrder` does.
vi.mock('@/lib/firestore', () => ({
  db: () => ({
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: mocks.docs.has(`${c}/${id}`), data: () => mocks.docs.get(`${c}/${id}`) }),
        // A merge write, one level deep, as `confirmations.{rid}` needs.
        set: async (data: Record<string, unknown>) => {
          const prev = mocks.docs.get(`${c}/${id}`) ?? {};
          const next: Record<string, unknown> = { ...prev };
          for (const [k, v] of Object.entries(data)) {
            const old = prev[k];
            next[k] =
              v && typeof v === 'object' && old && typeof old === 'object' ? { ...(old as object), ...(v as object) } : v;
          }
          mocks.docs.set(`${c}/${id}`, next);
        },
      }),
    }),
  }),
}));

import { POST } from '../../apps/web/src/app/api/stripe/webhook/route';
import { CHECKOUT_SOURCE } from '../../apps/web/src/lib/checkout-source';

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

function deliverCheckout() {
  const event = {
    id: 'evt_hs',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_live_group',
        object: 'checkout.session',
        payment_status: 'paid',
        customer_details: { email: 'buyer@example.com', name: 'Ada Buyer' },
        customer_email: null,
        customer: 'cus_1',
        payment_intent: 'pi_1',
        payment_link: null,
        amount_total: 159800,
        amount_subtotal: 159800,
        currency: 'usd',
        total_details: { amount_tax: 0, amount_discount: 0 },
        metadata: { source: CHECKOUT_SOURCE, tier: 'main-conference', ticketType: 'Main Conference', name: 'Ada Buyer' },
      },
    },
  };
  const req = new Request('https://www.knowledgegraph.tech/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=x', host: 'www.knowledgegraph.tech' },
    body: JSON.stringify(event),
  });
  return POST(req as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.docs.clear();
  mocks.queueAndKickHubspot.mockResolvedValue(undefined);
  // Two seats: the buyer and a colleague.
  mocks.cartLines.mockResolvedValue([
    { attendeeEmail: 'buyer@example.com', attendeeName: 'Ada Buyer', ticketTypeId: 'main-conference', ticketTypeName: 'Main Conference', unitPriceCents: 79900 },
    { attendeeEmail: 'ben@example.com', attendeeName: 'Ben Colleague', ticketTypeId: 'main-conference', ticketTypeName: 'Main Conference', unitPriceCents: 79900 },
  ]);
  mocks.fulfilPurchase.mockResolvedValue({
    registrationId: 'reg_buyer',
    email: 'buyer@example.com',
    name: 'Ada Buyer',
    ticketType: 'Main Conference',
    created: true,
    claimCode: '111111',
  });
  mocks.ensureRegistration.mockImplementation(async (input: { email: string; name: string }) => ({
    registrationId: 'reg_ben',
    email: input.email,
    name: input.name,
    created: true,
    claimCode: '222222',
  }));
  mocks.provisionPurchaserAccount.mockResolvedValue({ status: 'created', uid: 'uid_1', temporaryPassword: null });
});

describe('a paid checkout and the HubSpot sync (T333)', () => {
  it("queues every registration on the order with trigger 'order'", async () => {
    const res = await deliverCheckout();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, seats: 2, seatsRegistered: 1 });
    expect(mocks.queueAndKickHubspot).toHaveBeenCalledTimes(1);
    const [, ids, trigger, report] = mocks.queueAndKickHubspot.mock.calls[0]!;
    expect([...ids].sort()).toEqual(['reg_ben', 'reg_buyer']);
    expect(trigger).toBe('order');
    expect(typeof report).toBe('function');
    // After the seat list is on the order, which the sync reads.
    expect(mocks.attachSeatRegistrations.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.queueAndKickHubspot.mock.invocationCallOrder[0]!,
    );
  });

  it('queues the same registrations again on a second run, which is harmless', async () => {
    await deliverCheckout();
    await deliverCheckout();
    expect(mocks.queueAndKickHubspot).toHaveBeenCalledTimes(2);
    expect(mocks.queueAndKickHubspot.mock.calls[1]![1]).toEqual(mocks.queueAndKickHubspot.mock.calls[0]![1]);
  });

  it('still answers 200 and finishes fulfilment when the HubSpot module throws', async () => {
    mocks.queueAndKickHubspot.mockRejectedValue(new Error('hubspot down'));
    const res = await deliverCheckout();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, registrationId: 'reg_buyer', seats: 2 });
    // Both confirmations went out, the buyer's after the trigger, and the
    // account was provisioned: nothing after the trigger was skipped.
    expect(mocks.sendPurchaseConfirmation).toHaveBeenCalledTimes(2);
    expect(mocks.provisionPurchaserAccount).toHaveBeenCalledTimes(2);
    expect(mocks.incrementSold).toHaveBeenCalledWith('main-conference', 2);
    expect(mocks.recordError).toHaveBeenCalledWith('hubspot.trigger', expect.any(Error));
  });

  it('survives a synchronous throw as well', async () => {
    mocks.queueAndKickHubspot.mockImplementation(() => {
      throw new Error('hubspot exploded');
    });
    const res = await deliverCheckout();
    expect(res.status).toBe(200);
    expect(mocks.sendPurchaseConfirmation).toHaveBeenCalledTimes(2);
  });
});
