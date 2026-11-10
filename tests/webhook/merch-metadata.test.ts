/**
 * T386 D1: a merch cart must never take a Checkout session past Stripe's
 * metadata limits (50 keys, keys of 40 characters, values of 500), whatever
 * names an organizer types. Since T387 the cart is kept in `merchCarts` and
 * the session carries only `merchRef` and `merchCents`.
 *
 * `recordMerchCart` and `merchFromMetadata` run for real against a map
 * standing in for Firestore. No emulator, no network.
 *
 * Run with: npm run test:webhook
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const docs = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock('@/lib/firestore', () => ({
  db: () => ({
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: docs.has(`${c}/${id}`), data: () => docs.get(`${c}/${id}`) }),
        create: async (data: Record<string, unknown>) => {
          if (docs.has(`${c}/${id}`)) throw Object.assign(new Error('exists'), { code: 6 });
          docs.set(`${c}/${id}`, data);
        },
      }),
    }),
  }),
}));

import {
  MAX_MERCH_LINES,
  MAX_MERCH_QUANTITY,
  MERCH_SIZES,
  merchSlug,
  metadataProblem,
  priceMerchCart,
  type MerchItem,
  type MerchLine,
} from '@kgc/shared';
import { merchMetadata, recordMerchCart } from '../../apps/web/src/lib/merch-checkout';
import { merchFromMetadata } from '../../apps/web/src/lib/merch';
import { CHECKOUT_SOURCE } from '../../apps/web/src/lib/checkout-source';

beforeEach(() => docs.clear());

/** The gate's repro item, as an organizer would add it on Ticket Add-ons. */
const designs = [
  'Ontologies are a team sport all the way down',
  'A semantic layer under every enterprise AI',
  'Knowledge graphs connect every single dot',
];
const hoodie: MerchItem = {
  id: merchSlug('KGC 2027 limited edition knowledge graph hoodie'),
  name: 'KGC 2027 limited edition knowledge graph hoodie',
  priceCents: 6500,
  currency: 'usd',
  options: designs.map((label) => ({ id: merchSlug(label), label })),
  sizes: ['S', 'M'],
};

/** Metadata exactly as each checkout builds it, at its longest. */
function ticketMetadata(merch: Record<string, string>) {
  return {
    source: CHECKOUT_SOURCE,
    tier: 'main-conference-plus-continuing-education-units',
    ticketType: 'Main Conference + Continuing education units',
    name: 'N'.repeat(120),
    seats: '20',
    campaignCode: 'C'.repeat(40),
    buyerFeeCents: '99999',
    groupRate: '10%',
    groupDiscountCents: '999999',
    answersRef: `ans_${'a'.repeat(40)}`,
    ...merch,
  };
}
function merchOnlyMetadata(merch: Record<string, string>) {
  return { source: CHECKOUT_SOURCE, kind: 'merch', holder: `reg_${'r'.repeat(24)}`, name: 'N'.repeat(200), ...merch };
}

async function roundTrip(lines: MerchLine[]) {
  const ref = await recordMerchCart(lines);
  const md = merchMetadata(ref, lines);
  return { ref, md, back: await merchFromMetadata(md) };
}

describe('merch never breaks Stripe metadata (T386 D1)', () => {
  it("the gate's repro: six lines of a long-named hoodie", async () => {
    const posted = designs.flatMap((d) => ['S', 'M'].map((s) => `${hoodie.id}|${merchSlug(d)}|${s}|1`));
    const cart = priceMerchCart(posted, [hoodie]);
    if (!cart.ok) throw new Error(cart.error);
    expect(cart.lines).toHaveLength(6);

    const { md, back } = await roundTrip(cart.lines);
    // The old single value for this cart was over 500 characters.
    expect(Object.keys(md)).toEqual(['merchRef', 'merchCents']);
    expect(md.merchRef.length).toBeLessThanOrEqual(40);
    expect(md.merchCents).toBe('39000');
    expect(metadataProblem(ticketMetadata(md))).toBeNull();
    expect(metadataProblem(merchOnlyMetadata(md))).toBeNull();
    expect(back).toEqual(cart.lines);
  });

  it('a twelve-line cart of the longest ids, names and quantities', async () => {
    const id = (p: string, i: number) => `${p}${i}-${'x'.repeat(40)}`.slice(0, 40);
    const lines: MerchLine[] = Array.from({ length: MAX_MERCH_LINES }, (_, i) => ({
      itemId: id('item', i),
      name: 'N'.repeat(80),
      optionId: id('design', i),
      optionLabel: 'D'.repeat(60),
      size: MERCH_SIZES[i % MERCH_SIZES.length],
      quantity: MAX_MERCH_QUANTITY,
      unitPriceCents: 999999,
    }));
    const { md, back } = await roundTrip(lines);
    expect(metadataProblem(ticketMetadata(md))).toBeNull();
    expect(metadataProblem(merchOnlyMetadata(md))).toBeNull();
    expect(Number(md.merchCents)).toBe(12 * 10 * 999999);
    expect(back).toEqual(lines);
  });

  it('a ticket-only checkout gets no merch keys at all', () => {
    expect(merchMetadata(undefined, [])).toEqual({});
    expect(merchMetadata('mc_x', [])).toEqual({});
  });

  it('two carts never share a ref, and a cart is written once', async () => {
    const line = [{ itemId: 'socks', name: 'KGC socks', quantity: 1, unitPriceCents: 1500 }];
    const a = await recordMerchCart(line);
    const b = await recordMerchCart(line);
    expect(a).not.toBe(b);
    expect(docs.get(`merchCarts/${a}`)).toMatchObject({ eventId: 'kgc-2027', lines: line, merchCents: 1500 });
  });

  it('a session with no ref, an unknown ref or another event reads as no merch', async () => {
    expect(await merchFromMetadata(undefined)).toEqual([]);
    expect(await merchFromMetadata({ merchRef: 'mc_missing' })).toEqual([]);
    docs.set('merchCarts/mc_other', { eventId: 'kgc-2026', lines: [{ itemId: 'socks', quantity: 1, unitPriceCents: 1 }] });
    expect(await merchFromMetadata({ merchRef: 'mc_other' })).toEqual([]);
  });
});
