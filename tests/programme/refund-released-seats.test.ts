/**
 * A seat an organizer gave back by cancelling the attendee must not come back
 * a second time when the order is later refunded.
 *
 * Run with: npm test  (or npm run test:programme)
 */
import { describe, expect, it } from 'vitest';
import type { OrderDoc } from '@kgc/shared';
import { decideRefund } from '../../apps/web/src/lib/refund-core';

const seat = (email: string) => ({
  ticketTypeId: 'main-conference',
  ticketTypeName: 'Main Conference',
  quantity: 1,
  unitPriceCents: 79_900,
  attendeeEmail: email,
});

const order = (o: Partial<OrderDoc>) =>
  ({ status: 'paid', totalCents: 239_700, items: [seat('a@x.org'), seat('b@x.org'), seat('c@x.org')], ...o }) as OrderDoc;

describe('decideRefund with released seats', () => {
  it('gives every seat back when none was released', () => {
    const d = decideRefund(order({}), { reason: 'refunded' });
    expect(d.lines.reduce((n, l) => n + l.quantity, 0)).toBe(3);
  });

  it('leaves out the seat a cancellation already returned', () => {
    const d = decideRefund(order({ releasedSeats: { reg_b: 'main-conference' } }), { reason: 'refunded' });
    expect(d.newlyRefunded).toBe(true);
    expect(d.lines.reduce((n, l) => n + l.quantity, 0)).toBe(2);
  });

  it('takes a released seat out of a multi-seat line rather than dropping the line', () => {
    const d = decideRefund(
      order({ items: [{ ...seat('a@x.org'), quantity: 3 }], releasedSeats: { reg_b: 'main-conference' } }),
      { reason: 'refunded' },
    );
    expect(d.lines).toEqual([{ ticketTypeId: 'main-conference', quantity: 2 }]);
  });
});
