import { describe, expect, it } from 'vitest';

import { countsAsAttendee } from './attendees-core';

describe('countsAsAttendee', () => {
  it('counts an active registration', () => {
    expect(countsAsAttendee({ status: 'active' })).toBe(true);
  });

  it('leaves out the shared demo login, though its badge is active', () => {
    expect(countsAsAttendee({ status: 'active', demo: true })).toBe(false);
  });

  it('leaves out cancelled and transferred registrations', () => {
    expect(countsAsAttendee({ status: 'cancelled' })).toBe(false);
    expect(countsAsAttendee({ status: 'transferred' })).toBe(false);
  });
});
