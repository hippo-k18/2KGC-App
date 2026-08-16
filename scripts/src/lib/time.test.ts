import { describe, expect, it } from 'vitest';

import { deriveTimes, toWallClock } from './time.js';

/**
 * The timezone logic is the highest-risk code in the importer, because every way
 * it fails is silent: a session appears, it just appears on the wrong day, at the
 * wrong hour, or four hours out. Nobody notices until an attendee walks to an
 * empty room.
 */
describe('deriveTimes', () => {
  it('keeps a late-evening session on its local calendar day', () => {
    // KGC's Monday reception: 21:00 in New York is 01:00 UTC on Tuesday. The day
    // tab must say Monday. This is the bug the denormalised `day` string exists
    // to prevent, and it is invisible to anyone testing at 10am Eastern.
    const t = deriveTimes('2027-05-04T21:00', '2027-05-04T23:00');

    expect(t.day).toBe('2027-05-04');
    expect(t.startsAt.toDate().toISOString()).toBe('2027-05-05T01:00:00.000Z');
  });

  it('applies the correct offset in daylight time', () => {
    // May is EDT, UTC-4. A 09:00 session is 13:00Z, not 14:00Z.
    const t = deriveTimes('2027-05-05T09:00', '2027-05-05T09:45');
    expect(t.startsAt.toDate().toISOString()).toBe('2027-05-05T13:00:00.000Z');
  });

  it('applies the correct offset in standard time', () => {
    // The same wall clock in January is EST, UTC-5. Storing a fixed offset
    // instead of a zone would put this an hour out.
    const t = deriveTimes('2027-01-05T09:00', '2027-01-05T09:45');
    expect(t.startsAt.toDate().toISOString()).toBe('2027-01-05T14:00:00.000Z');
  });

  it('round-trips the local strings unchanged', () => {
    const t = deriveTimes('2027-05-06T14:00', '2027-05-06T15:30');
    expect(t.startsAtLocal).toBe('2027-05-06T14:00');
    expect(t.endsAtLocal).toBe('2027-05-06T15:30');
    expect(t.timeZone).toBe('America/New_York');
  });

  it('rejects an ISO instant masquerading as wall clock', () => {
    // Accepting both shapes here is how a whole schedule silently shifts.
    expect(() => deriveTimes('2027-05-05T09:00:00Z', '2027-05-05T09:45')).toThrow(/wall clock/);
    expect(() => deriveTimes('2027-05-05T09:00-04:00', '2027-05-05T09:45')).toThrow(/wall clock/);
  });

  it('rejects a session that ends before it starts', () => {
    expect(() => deriveTimes('2027-05-05T15:00', '2027-05-05T14:00')).toThrow(/ends at or before/);
  });
});

describe('toWallClock', () => {
  it('accepts the shapes spreadsheets actually emit', () => {
    expect(toWallClock('2027-05-05', '09:00')).toBe('2027-05-05T09:00');
    expect(toWallClock('05/05/2027', '9:00 AM')).toBe('2027-05-05T09:00');
    expect(toWallClock('5/5/2027', '2:30 PM')).toBe('2027-05-05T14:30');
    expect(toWallClock('2027-05-05', '14:30:00')).toBe('2027-05-05T14:30');
  });

  it('handles the two midnight cases that break naive parsers', () => {
    expect(toWallClock('2027-05-05', '12:00 AM')).toBe('2027-05-05T00:00');
    expect(toWallClock('2027-05-05', '12:00 PM')).toBe('2027-05-05T12:00');
  });

  it('refuses input it does not understand rather than guessing', () => {
    expect(() => toWallClock('May 5 2027', '09:00')).toThrow(/unrecognised date/);
    expect(() => toWallClock('2027-05-05', 'morning')).toThrow(/unrecognised time/);
  });
});
