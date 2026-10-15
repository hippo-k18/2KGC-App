import { describe, expect, it } from 'vitest';
import { badgeIncludesWorkshops, dayListId, eventDayOf, isDayListId } from './checkin-core';
import { CHECKIN_SESSION_TTL_MS, SESSION_TTL_MS, sessionTtlMs } from './team-core';

describe('Day lists (T259 #12)', () => {
  it('reads the day on the New York clock', () => {
    expect(eventDayOf(new Date('2027-05-05T03:00:00Z'))).toBe('2027-05-04');
    expect(eventDayOf(new Date('2027-05-05T13:00:00Z'))).toBe('2027-05-05');
  });

  it('knows a Day list id from any other', () => {
    expect(isDayListId(dayListId('2027-05-04'))).toBe(true);
    expect(isDayListId('event-door')).toBe(false);
    expect(isDayListId('session-abc')).toBe(false);
    expect(isDayListId('day-tuesday')).toBe(false);
  });
});

describe('a workshop door (T259 #10)', () => {
  const workshops = new Set(['Workshops', 'All Access (VIP)']);

  it('lets in Workshops, All Access, and Main Conference with Workshops added', () => {
    expect(badgeIncludesWorkshops({ ticketType: 'Workshops' }, workshops)).toBe(true);
    expect(badgeIncludesWorkshops({ ticketType: 'All Access (VIP)' }, workshops)).toBe(true);
    expect(badgeIncludesWorkshops({ ticketType: 'Main Conference', extraNames: ['Workshops'] }, workshops)).toBe(true);
  });

  it('flags a Main Conference badge on its own', () => {
    expect(badgeIncludesWorkshops({ ticketType: 'Main Conference' }, workshops)).toBe(false);
    expect(badgeIncludesWorkshops({}, workshops)).toBe(false);
  });
});

describe('dashboard session length (T259 #13)', () => {
  it('gives the check-in crew 14 hours and everybody else 8', () => {
    expect(sessionTtlMs(['checkin'])).toBe(CHECKIN_SESSION_TTL_MS);
    expect(sessionTtlMs(['finance', 'checkin'])).toBe(14 * 60 * 60 * 1000);
    expect(sessionTtlMs(['finance'])).toBe(SESSION_TTL_MS);
  });
});
