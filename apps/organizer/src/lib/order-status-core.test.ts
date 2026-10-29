import { describe, expect, it } from 'vitest';

import { CHARGEBACK_HINT, INVOICE_NOT_COMPLETED_HINT, NOT_COMPLETED_HINT, matchesOrderFilter, orderFilterOf, orderStatusLabel } from './order-status-core';

/**
 * T357: "cancelled is a bit ambiguous". A cancelled order is either a checkout
 * that expired unpaid or a chargeback, and the dashboard has to say which.
 */
describe('orderStatusLabel', () => {
  it('calls an unpaid checkout "Not completed", in grey, and says no money was taken', () => {
    expect(orderStatusLabel({ status: 'cancelled' })).toEqual({
      label: 'Not completed',
      tone: 'grey',
      hint: NOT_COMPLETED_HINT,
    });
    expect(NOT_COMPLETED_HINT).toContain('No money was taken.');
  });

  it('says a voided invoice was voided, not that a payment page closed (T358)', () => {
    const r = orderStatusLabel({ status: 'cancelled', channel: 'invoice' });
    expect(r).toEqual({ label: 'Not completed', tone: 'grey', hint: INVOICE_NOT_COMPLETED_HINT });
    expect(r.hint).not.toContain('payment page');
    expect(orderStatusLabel({ status: 'cancelled', channel: 'checkout' }).hint).toBe(NOT_COMPLETED_HINT);
    expect(orderStatusLabel({ status: 'cancelled', channel: 'invoice', disputedAt: '2026-10-01' }).label).toBe('Chargeback');
  });

  it('calls a cancelled order with disputedAt a "Chargeback", in red', () => {
    const r = orderStatusLabel({ status: 'cancelled', disputedAt: '2026-10-01T12:00:00.000Z' });
    expect(r).toEqual({ label: 'Chargeback', tone: 'red', hint: CHARGEBACK_HINT });
  });

  it('treats an empty or missing disputedAt as not disputed', () => {
    expect(orderStatusLabel({ status: 'cancelled', disputedAt: undefined }).label).toBe('Not completed');
    expect(orderStatusLabel({ status: 'cancelled', disputedAt: null }).label).toBe('Not completed');
    expect(orderStatusLabel({ status: 'cancelled', disputedAt: '' }).label).toBe('Not completed');
  });

  it('leaves the other statuses as they were', () => {
    expect(orderStatusLabel({ status: 'paid' })).toEqual({ label: 'paid', tone: 'green' });
    expect(orderStatusLabel({ status: 'refunded' })).toEqual({ label: 'refunded', tone: 'red' });
    expect(orderStatusLabel({ status: 'partially_refunded' })).toEqual({ label: 'partially refunded', tone: 'orange' });
    expect(orderStatusLabel({ status: 'pending' })).toEqual({ label: 'pending', tone: 'grey' });
  });

  it('ignores disputedAt on any status but cancelled', () => {
    // A dispute won back leaves the order cancelled; nothing else carries the
    // stamp today, but a paid order must not turn into a chargeback if it did.
    expect(orderStatusLabel({ status: 'paid', disputedAt: '2026-10-01' }).label).toBe('paid');
  });

  it('shows an unknown status readably rather than dropping it', () => {
    expect(orderStatusLabel({ status: 'some_new_state' })).toEqual({ label: 'some new state', tone: 'grey' });
  });

  it('uses no em dashes in what an organizer reads', () => {
    for (const s of ['paid', 'refunded', 'partially_refunded', 'pending', 'cancelled']) {
      for (const d of [undefined, '2026-10-01']) {
        const r = orderStatusLabel({ status: s, disputedAt: d });
        expect(`${r.label} ${r.hint ?? ''}`).not.toContain('—');
      }
    }
  });
});

describe('the Attendee Orders filters', () => {
  const unpaid = { status: 'cancelled' };
  const chargeback = { status: 'cancelled', disputedAt: '2026-10-01' };
  const paid = { status: 'paid' };

  it('puts an unpaid checkout under Not completed and a chargeback under Chargeback', () => {
    expect(orderFilterOf(unpaid)).toBe('not_completed');
    expect(orderFilterOf(chargeback)).toBe('chargeback');
    expect(orderFilterOf(paid)).toBe('paid');
  });

  it('never counts a chargeback as Not completed', () => {
    expect(matchesOrderFilter(chargeback, 'not_completed')).toBe(false);
    expect(matchesOrderFilter(unpaid, 'chargeback')).toBe(false);
  });

  it('keeps an old ?status=cancelled link matching both, and an empty filter matching all', () => {
    expect(matchesOrderFilter(unpaid, 'cancelled')).toBe(true);
    expect(matchesOrderFilter(chargeback, 'cancelled')).toBe(true);
    expect(matchesOrderFilter(paid, 'cancelled')).toBe(false);
    expect(matchesOrderFilter(paid, '')).toBe(true);
  });
});
