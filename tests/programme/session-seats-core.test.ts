import { describe, expect, it } from 'vitest';

import {
  joinNames,
  parseCap,
  resolveEligibility,
  seatFill,
} from '../../apps/organizer/src/lib/session-seats-core';

describe('parseCap', () => {
  it('reads blank as no cap', () => {
    expect(parseCap('  ')).toEqual({ ok: true, capacity: null });
  });

  it('accepts a whole number of seats', () => {
    expect(parseCap(' 40 ')).toEqual({ ok: true, capacity: 40 });
  });

  it('refuses zero, negatives, fractions, words and absurd numbers', () => {
    for (const raw of ['0', '-3', '12.5', 'forty', '1e3', '100001']) {
      expect(parseCap(raw).ok).toBe(false);
    }
  });
});

describe('resolveEligibility', () => {
  const tiers = ['All Access (VIP)', 'Main Conference', 'Workshops'];

  it('keeps real ticket types, in catalogue order, once each', () => {
    expect(resolveEligibility(['Workshops', 'All Access (VIP)', 'Workshops'], tiers)).toEqual([
      'All Access (VIP)',
      'Workshops',
    ]);
  });

  it('drops a name that is not a ticket type', () => {
    expect(resolveEligibility(['Workshop', 'workshops', ''], tiers)).toEqual([]);
  });

  it('means open to everybody when nothing is ticked', () => {
    expect(resolveEligibility([], tiers)).toEqual([]);
  });
});

describe('joinNames and seatFill', () => {
  it('joins the way a sentence does', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Gold'])).toBe('Gold');
    expect(joinNames(['Gold', 'Platinum', 'Workshops'])).toBe('Gold, Platinum and Workshops');
  });

  it('tells open from full from over', () => {
    expect(seatFill(3, 5)).toBe('open');
    expect(seatFill(5, 5)).toBe('full');
    expect(seatFill(6, 5)).toBe('over');
  });
});
