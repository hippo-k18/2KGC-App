/**
 * The checkout form's server action, `startCheckout`, against the Firestore
 * emulator with Stripe and the request faked (T135, T136).
 *
 * Run with: npm run test:group-purchase
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  created: [] as { metadata: Record<string, string> }[],
  createError: null as null | (Error & { type?: string }),
  ip: '203.0.113.7',
}));

vi.mock('../../apps/web/node_modules/next/headers.js', () => ({
  headers: async () =>
    new Headers({ host: 'www.knowledgegraph.tech', 'x-forwarded-proto': 'https', 'x-forwarded-for': `198.51.100.1, ${mocks.ip}` }),
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
    checkout: {
      sessions: {
        create: async (params: { metadata: Record<string, string> }) => {
          if (mocks.createError) throw mocks.createError;
          mocks.created.push(params);
          const id = `cs_test_start_${mocks.created.length}`;
          return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
        },
      },
    },
  }),
}));

import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { startCheckout } from '@/app/tickets/actions';
import { CHECKOUT_STARTS_PER_WINDOW, CHECKOUT_WINDOW_MS, checkoutStartAllowed } from '@/lib/checkout-limit';
import { db as webDb } from '@/lib/firestore';

let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:group-purchase');
  }
  db = webDb() as unknown as Firestore;
});

async function wipe(collection: string) {
  const snap = await db.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  mocks.created.length = 0;
  mocks.createError = null;
  mocks.ip = '203.0.113.7';
  await Promise.all([COLLECTIONS.ticketTypes, COLLECTIONS.orders, COLLECTIONS.rateLimits, COLLECTIONS.auditLog].map(wipe));
  await db.collection(COLLECTIONS.ticketTypes).doc('main-conference').set({
    eventId: EVENT_ID,
    name: 'Main Conference',
    priceCents: 10_000,
    currency: 'usd',
    quantityTotal: 100,
    quantitySold: 0,
  });
});

function form(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
  return f;
}

const twoSeats = () =>
  form({
    tier: 'main-conference',
    name: 'Ada Nakamura',
    email: 'ada@example.com',
    seatName: ['Ben Olsen'],
    seatEmail: ['ben@example.com'],
    seatTier: ['main-conference'],
  });

/** What the buyer sees: an error, or the Stripe page they are sent to. */
async function submit(f: FormData): Promise<{ error?: string; url?: string }> {
  try {
    return (await startCheckout({}, f)) as { error?: string };
  } catch (err) {
    const url = (err as { url?: string }).url;
    if (url) return { url };
    throw err;
  }
}

describe('a flood of checkouts from one connection (S7, TK-401)', () => {
  it(`starts ${CHECKOUT_STARTS_PER_WINDOW} and refuses the rest, writing nothing for them`, async () => {
    const results = [];
    for (let i = 0; i < CHECKOUT_STARTS_PER_WINDOW + 5; i += 1) results.push(await submit(twoSeats()));

    expect(results.filter((r) => r.url)).toHaveLength(CHECKOUT_STARTS_PER_WINDOW);
    expect(results.slice(CHECKOUT_STARTS_PER_WINDOW).every((r) => /Too many checkouts/.test(r.error ?? ''))).toBe(true);
    expect(mocks.created).toHaveLength(CHECKOUT_STARTS_PER_WINDOW);
    expect((await db.collection(COLLECTIONS.orders).get()).size).toBe(CHECKOUT_STARTS_PER_WINDOW);
  });

  it('counts the address Apache saw, not one the client wrote into the header', async () => {
    for (let i = 0; i < CHECKOUT_STARTS_PER_WINDOW; i += 1) await submit(twoSeats());
    expect((await submit(twoSeats())).error).toMatch(/Too many checkouts/);
    mocks.ip = '203.0.113.8';
    expect((await submit(twoSeats())).url).toBeDefined();
  });
});

describe('a burst from one connection (T138B, TK-401)', () => {
  it('lets exactly the limit through when 200 arrive at once, and logs nothing to the audit trail', async () => {
    const results = await Promise.all(Array.from({ length: 200 }, () => submit(twoSeats())));
    expect(results.filter((r) => r.url)).toHaveLength(CHECKOUT_STARTS_PER_WINDOW);
    expect(mocks.created).toHaveLength(CHECKOUT_STARTS_PER_WINDOW);
    expect((await db.collection(COLLECTIONS.orders).get()).size).toBe(CHECKOUT_STARTS_PER_WINDOW);
    expect((await db.collection(COLLECTIONS.auditLog).get()).size).toBe(0);
  }, 120_000);

  it('holds for repeated bursts against the limiter itself, and opens again next window', async () => {
    const now = Date.UTC(2026, 9, 4, 12, 0, 0);
    for (let burst = 0; burst < 3; burst += 1) {
      const allowed = await Promise.all(Array.from({ length: 200 }, () => checkoutStartAllowed('198.51.100.9', now)));
      expect(allowed.filter(Boolean)).toHaveLength(burst === 0 ? CHECKOUT_STARTS_PER_WINDOW : 0);
    }
    expect(await checkoutStartAllowed('198.51.100.9', now + CHECKOUT_WINDOW_MS)).toBe(true);
  }, 120_000);
});

describe('a crafted tier id (TK-404)', () => {
  it.each(['main-conference/extra', '../ticketTypes/main-conference', 'a'.repeat(300)])(
    'is "Choose a ticket type", not a 500: %s',
    async (tier) => {
      expect(await submit(form({ tier, name: 'Ada Nakamura', email: 'ada@example.com' }))).toEqual({
        error: 'Choose a ticket type.',
      });
      expect(mocks.created).toHaveLength(0);
    },
  );
});

describe('a name too long for Stripe (S6, TK-031)', () => {
  it('is refused with the real reason before Stripe is called', async () => {
    const res = await submit(form({ tier: 'main-conference', name: 'A'.repeat(600), email: 'ada@example.com' }));
    expect(res.error).toBe('The name is too long. Use at most 120 characters.');
    expect(mocks.created).toHaveLength(0);
  });

  it('a request Stripe refuses is not reported as an unreachable processor', async () => {
    mocks.createError = Object.assign(new Error('Invalid metadata'), { type: 'StripeInvalidRequestError' });
    const res = await submit(form({ tier: 'main-conference', name: 'Ada Nakamura', email: 'ada@example.com' }));
    expect(res.error).toMatch(/did not accept this checkout/);
    expect(res.error).not.toMatch(/could not reach/);
  });
});
