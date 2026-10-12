import { describe, expect, it } from 'vitest';

import { attendeeListStats, cancelledOrTransferred, countsAsAttendee, mergeAttendees } from './attendees-core';

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

describe('the demo login on the attendee list', () => {
  const user = (id: string, extra: Record<string, unknown> = {}) => ({
    id, data: { email: `${id}@example.com`, name: id, visibleInDirectory: true, ...extra },
  });
  const reg = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
    id, data: { email, status: 'active' as const, ticketType: 'All Access (VIP)', ...extra },
  });

  it('marks the demo row from its profile or its registration', () => {
    const rows = mergeAttendees(
      [user('ada'), user('demo', { demo: true, visibleInDirectory: false })],
      [reg('reg_ada', 'ada@example.com'), reg('reg_demo', 'demo@example.com', { demo: true }), reg('reg_solo', 'solo@example.com', { demo: true })],
    );
    expect(rows.filter((r) => r.demo).map((r) => r.email).sort()).toEqual(['demo@example.com', 'solo@example.com']);
    expect(rows.find((r) => r.email === 'ada@example.com')?.demo).toBeUndefined();
  });

  it('leaves it out of "Holding a ticket", signed in and hidden', () => {
    const rows = mergeAttendees(
      [user('ada'), user('ben', { visibleInDirectory: false }), user('demo', { demo: true, visibleInDirectory: false })],
      [
        reg('reg_ada', 'ada@example.com'),
        reg('reg_ben', 'ben@example.com'),
        reg('reg_gone', 'gone@example.com', { status: 'cancelled' }),
        reg('reg_demo', 'demo@example.com', { demo: true }),
      ],
    );
    // Four registrations, one of them the demo: the page reads "3 of 3".
    expect(attendeeListStats(rows)).toEqual({ hidden: 1, signedIn: 2, ticketHolders: 3, multiHolders: 0 });
  });
});

describe('cancelledOrTransferred', () => {
  it('counts cancelled and transferred badges, never the active demo badge', () => {
    expect(
      cancelledOrTransferred([
        { status: 'active' },
        { status: 'active', demo: true } as { status: string },
        { status: 'cancelled' },
        { status: 'transferred' },
      ]),
    ).toBe(2);
  });
});
