/**
 * The discount-code split on Tickets › Orders and Transactions › Summary.
 *
 * Every case here is a way the panel could report money wrongly rather than
 * obviously break: two rows for one code because of capitalisation, a discount
 * that vanishes because no code was attached to it, or a refunded order still
 * counted as tickets the code sold.
 *
 * Lives in `tests/programme` for the reason the others here do: it is pure
 * logic needing no emulator, and `commerce.ts` carries `server-only` so Vitest
 * cannot load it at all.
 *
 * Run with: npm run test:programme
 */
import { describe, expect, it } from 'vitest';

import { codeKey, salesByCode, type CodedOrder } from '../../apps/organizer/src/lib/sales-core';

const order = (over: Partial<CodedOrder> = {}): CodedOrder => ({
  status: 'paid',
  seatCount: 1,
  totalCents: 10_000,
  netCents: 10_000,
  discountCents: 0,
  ...over,
});

describe('codeKey', () => {
  it('folds case and surrounding space, because Stripe upper-cases and a typist does not', () => {
    expect(codeKey(' speaker25 ')).toBe('SPEAKER25');
    expect(codeKey('SPEAKER25')).toBe('SPEAKER25');
  });

  it('treats a missing or blank code as no code at all', () => {
    expect(codeKey(undefined)).toBe('');
    expect(codeKey('   ')).toBe('');
  });
});

describe('salesByCode', () => {
  it('reads as nothing used rather than as an error when there are no orders', () => {
    const split = salesByCode([]);
    expect(split.codes).toEqual([]);
    expect(split.ordersWithoutCode).toBe(0);
    expect(split.discountWithoutCodeCents).toBe(0);
  });

  it('counts full-price orders without inventing a code row for them', () => {
    const split = salesByCode([order(), order(), order()]);
    expect(split.codes).toEqual([]);
    expect(split.ordersWithoutCode).toBe(3);
  });

  it('puts two spellings of one code on one row', () => {
    const split = salesByCode([
      order({ promotionCode: 'SPEAKER25', discountCents: 2_500, totalCents: 7_500, netCents: 7_500 }),
      order({ promotionCode: 'speaker25', discountCents: 2_500, totalCents: 7_500, netCents: 7_500 }),
    ]);

    expect(split.codes).toHaveLength(1);
    expect(split.codes[0].code).toBe('SPEAKER25');
    expect(split.codes[0].orders).toBe(2);
    expect(split.codes[0].tickets).toBe(2);
    expect(split.codes[0].discountCents).toBe(5_000);
    expect(split.codes[0].grossCents).toBe(15_000);
    expect(split.codes[0].netCents).toBe(15_000);
  });

  it('adds the seats on a multi-seat order rather than counting the order once', () => {
    const split = salesByCode([
      order({ promotionCode: 'TEAM', seatCount: 4, totalCents: 32_000, netCents: 32_000 }),
    ]);
    expect(split.codes[0].orders).toBe(1);
    expect(split.codes[0].tickets).toBe(4);
  });

  it('keeps a refunded order visible in the money but sells no tickets with it', () => {
    const split = salesByCode([
      order({ promotionCode: 'EARLY', totalCents: 8_000, netCents: 8_000 }),
      order({ promotionCode: 'EARLY', status: 'refunded', totalCents: 8_000, netCents: 0 }),
    ]);

    const row = split.codes[0];
    expect(row.orders).toBe(2);
    expect(row.refunded).toBe(1);
    expect(row.tickets).toBe(1);
    expect(row.grossCents).toBe(16_000);
    expect(row.netCents).toBe(8_000);
  });

  it('counts a part-refunded order as a live ticket, because one seat of it still stands', () => {
    const split = salesByCode([
      order({ promotionCode: 'EARLY', status: 'partially_refunded', seatCount: 2, totalCents: 16_000, netCents: 8_000 }),
    ]);
    expect(split.codes[0].refunded).toBe(0);
    expect(split.codes[0].tickets).toBe(2);
    expect(split.codes[0].netCents).toBe(8_000);
  });

  it('keeps a discount with no code out of the rows and still reports it', () => {
    const split = salesByCode([
      order({ promotionCode: 'EARLY', discountCents: 1_000, totalCents: 9_000, netCents: 9_000 }),
      order({ discountCents: 4_000, totalCents: 6_000, netCents: 6_000 }),
    ]);

    expect(split.codes).toHaveLength(1);
    expect(split.codes[0].discountCents).toBe(1_000);
    expect(split.ordersWithoutCode).toBe(1);
    expect(split.discountWithoutCodeCents).toBe(4_000);
  });

  it('puts the code that earned most first, and settles a tie by name', () => {
    const split = salesByCode([
      order({ promotionCode: 'SMALL', totalCents: 1_000, netCents: 1_000 }),
      order({ promotionCode: 'BIG', totalCents: 50_000, netCents: 50_000 }),
      order({ promotionCode: 'ALSOSMALL', totalCents: 1_000, netCents: 1_000 }),
    ]);

    expect(split.codes.map((c) => c.code)).toEqual(['BIG', 'ALSOSMALL', 'SMALL']);
  });
});
