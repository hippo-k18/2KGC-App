/**
 * Merch bought on its own (T380): `fulfilMerchSession` writes one order and one
 * receipt and touches no ticket; `settleMerchOrder` records a refund or a
 * chargeback on that order and nothing else.
 *
 * Firestore is a map here, with just enough of a transaction for these two
 * functions. No emulator, no network.
 *
 * Run with: npm run test:webhook
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  claims: new Map<string, number>(),
  sendMerchConfirmation: vi.fn(async () => 'sent'),
}));

function docRef(c: string, id: string) {
  const key = `${c}/${id}`;
  return {
    key,
    get: async () => ({ exists: mocks.docs.has(key), data: () => mocks.docs.get(key) }),
  };
}

vi.mock('@/lib/firestore', () => ({
  db: () => ({
    collection: (c: string) => ({ doc: (id: string) => docRef(c, id) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: (ref: ReturnType<typeof docRef>) => ref.get(),
        set: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => void mocks.docs.set(ref.key, data),
        update: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) =>
          void mocks.docs.set(ref.key, { ...mocks.docs.get(ref.key), ...data }),
      }),
  }),
}));
vi.mock('@/lib/merch', async () => {
  const carts: Record<string, unknown[]> = { mc_test: [
  { itemId: 'socks', name: 'KGC socks', quantity: 2, unitPriceCents: 1500 },
  { itemId: 'tshirt', name: 'T-shirt', optionId: 'et-al', optionLabel: 'Et al.', size: 'L', quantity: 1, unitPriceCents: 3500 },
] };
  return { merchFromMetadata: async (md: Record<string, string> | null) => carts[md?.merchRef ?? ''] ?? [] };
});
vi.mock('@/lib/email', () => ({ sendMerchConfirmation: mocks.sendMerchConfirmation }));
vi.mock('@/lib/order-token', () => ({ mintOrderToken: ({ rid }: { rid: string }) => `tok-${rid}` }));
vi.mock('@/lib/registrations', () => ({ orderIdFor: (id: string) => `ord_${id}` }));
// Claimed once per order and key, as the real `claimOnOrder` does.
vi.mock('@/lib/fulfil-order', () => ({
  claimConfirmation: async (oid: string, rid: string) => {
    const k = `${oid}/${rid}`;
    if (mocks.claims.has(k)) return null;
    mocks.claims.set(k, 1);
    return 1;
  },
  sendClaimed: async (_c: unknown, send: () => Promise<unknown>) => void (await send()),
  confirmationsOutstanding: async () => [],
}));

import { fulfilMerchSession, settleMerchOrder } from '../../apps/web/src/lib/merch-fulfil';

const session = {
  id: 'cs_merch',
  payment_status: 'paid',
  customer_details: { email: 'Ada@Example.com', name: 'Ada Holder' },
  customer: 'cus_1',
  payment_intent: 'pi_m',
  amount_total: 6500,
  amount_subtotal: 6500,
  currency: 'usd',
  total_details: { amount_tax: 0, amount_discount: 0 },
  metadata: {
    source: 'kgc-web',
    kind: 'merch',
    holder: 'reg_holder',
    name: 'Ada Holder',
    merchRef: 'mc_test',
    merchCents: '6500',
  },
} as never;

const run = () =>
  fulfilMerchSession({ session, holderRegistrationId: 'reg_holder', email: 'Ada@Example.com', origin: 'https://www.knowledgegraph.tech' });

beforeEach(() => {
  mocks.docs.clear();
  mocks.claims.clear();
  vi.clearAllMocks();
});

describe('fulfilMerchSession', () => {
  it('writes a merch-only order against the holder, with no seats and no registrations', async () => {
    const out = await run();
    expect(out).toEqual({ orderId: 'ord_cs_merch', registrationId: 'reg_holder', confirmationOutstanding: false });
    const order = mocks.docs.get('orders/ord_cs_merch')!;
    expect(order).toMatchObject({
      kind: 'merch',
      status: 'paid',
      email: 'ada@example.com',
      items: [],
      registrationIds: [],
      holderRegistrationId: 'reg_holder',
      totalCents: 6500,
      merchCents: 6500,
      merch: [
        { itemId: 'socks', name: 'KGC socks', quantity: 2, unitPriceCents: 1500 },
        { itemId: 'tshirt', name: 'T-shirt', optionId: 'et-al', optionLabel: 'Et al.', size: 'L', quantity: 1, unitPriceCents: 3500 },
      ],
    });
    // Nothing else was written: no registration, no user.
    expect([...mocks.docs.keys()]).toEqual(['orders/ord_cs_merch']);
    expect(mocks.sendMerchConfirmation).toHaveBeenCalledTimes(1);
    expect(mocks.sendMerchConfirmation.mock.calls[0]![0]).toMatchObject({
      to: 'ada@example.com',
      amountCents: 6500,
      orderUrl: 'https://www.knowledgegraph.tech/order/tok-reg_holder',
    });
  });

  it('is the same order and one receipt however many times it runs', async () => {
    await run();
    const first = mocks.docs.get('orders/ord_cs_merch');
    await run();
    expect(mocks.docs.get('orders/ord_cs_merch')).toBe(first);
    expect(mocks.sendMerchConfirmation).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an order already refunded', async () => {
    mocks.docs.set('orders/ord_cs_merch', { status: 'refunded', totalCents: 6500 });
    const out = await run();
    expect(out.settled).toBe('refunded');
    expect(mocks.sendMerchConfirmation).not.toHaveBeenCalled();
    expect(mocks.docs.get('orders/ord_cs_merch')).toEqual({ status: 'refunded', totalCents: 6500 });
  });
});

describe('settleMerchOrder', () => {
  beforeEach(async () => {
    await run();
  });

  it('a partial refund is partial, a full one is refunded, and a replay changes nothing', async () => {
    expect(await settleMerchOrder({ orderId: 'ord_cs_merch', reason: 'refunded', refundedCents: 1500 })).toEqual({
      status: 'partially_refunded',
      newly: true,
    });
    expect(await settleMerchOrder({ orderId: 'ord_cs_merch', reason: 'refunded', refundedCents: 6500 })).toEqual({
      status: 'refunded',
      newly: true,
    });
    expect(await settleMerchOrder({ orderId: 'ord_cs_merch', reason: 'refunded', refundedCents: 6500 })).toEqual({
      status: 'refunded',
      newly: false,
    });
    expect(mocks.docs.get('orders/ord_cs_merch')).toMatchObject({ status: 'refunded', refundedCents: 6500 });
  });

  it('a chargeback cancels the order once', async () => {
    expect(await settleMerchOrder({ orderId: 'ord_cs_merch', reason: 'disputed' })).toEqual({ status: 'cancelled', newly: true });
    expect((await settleMerchOrder({ orderId: 'ord_cs_merch', reason: 'disputed' }))?.newly).toBe(false);
  });

  it('a refund for an order we never wrote is reported, not invented', async () => {
    expect(await settleMerchOrder({ orderId: 'ord_missing', reason: 'refunded', refundedCents: 100 })).toBeNull();
    expect(mocks.docs.has('orders/ord_missing')).toBe(false);
  });
});
