import { describe, expect, it } from 'vitest';

import { attendeeListStats, cancelledOrTransferred, countsAsAttendee, mergeAttendees, ticketRows } from './attendees-core';

const user = (id: string, extra: Record<string, unknown> = {}) => ({
  id, data: { email: `${id}@example.com`, name: id, visibleInDirectory: true, ...extra },
});
const reg = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  id, data: { email, status: 'active' as const, ticketType: 'All Access (VIP)', ...extra },
});

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
    // Four registrations, one the demo and one cancelled: 2 active, 1 cancelled (T262).
    expect(attendeeListStats(rows)).toEqual({
      people: 3,
      hidden: 1,
      signedIn: 2,
      ticketHolders: 2,
      cancelled: 1,
      multiHolders: 0,
    });
  });

  it('divides "Signed into the app" by people only, so the demo is not one who has not (T228)', () => {
    // T228's seed: 3 active people, 1 cancelled, the demo badge; 2 people and the demo signed in.
    const rows = mergeAttendees(
      [user('ada'), user('ben'), user('demo', { demo: true })],
      [
        reg('reg_ada', 'ada@example.com'),
        reg('reg_ben', 'ben@example.com'),
        reg('reg_cy', 'cy@example.com'),
        reg('reg_gone', 'gone@example.com', { status: 'cancelled' }),
        reg('reg_demo', 'demo@example.com', { demo: true }),
      ],
    );
    const { people, signedIn } = attendeeListStats(rows);
    expect(rows).toHaveLength(5);
    expect({ people, signedIn, percent: Math.round((signedIn / people) * 100), haveNot: people - signedIn }).toEqual({
      people: 4,
      signedIn: 2,
      percent: 50,
      haveNot: 2,
    });
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

describe('delivery problems on the attendee list (T258 #9)', () => {
  it('names a bounce and a spam complaint, and nothing otherwise', async () => {
    const { emailProblemOf } = await import('./attendees-core');
    const at = { toDate: () => new Date() } as never;
    expect(emailProblemOf({ bouncedAt: at })).toBe('bounced');
    expect(emailProblemOf({ bouncedAt: at, complainedAt: at })).toBe('spam');
    expect(emailProblemOf({})).toBeUndefined();
  });
});

describe('ticketRows, one row per ticket (T262)', () => {
  it('lists a second ticket on a shared address as its own row', () => {
    const regs = [
      reg('reg_l', 'buyer39@example.com', { name: 'Łukasz' }),
      reg('reg_e', 'Buyer39@example.com', { name: 'Ελένη' }),
      reg('reg_ada', 'ada@example.com'),
    ];
    const users = [user('buyer39', { email: 'buyer39@example.com', name: 'Łukasz' }), user('staff')];
    expect(mergeAttendees(users, regs).filter((r) => r.registrationId)).toHaveLength(2);
    const rows = ticketRows(users, regs);
    expect(rows.map((r) => r.registrationId).filter(Boolean).sort()).toEqual(['reg_ada', 'reg_e', 'reg_l']);
    expect(rows.find((r) => r.registrationId === 'reg_e')?.name).toBe('Ελένη');
    // The profile stays on the ticket it was on, and staff with no ticket are listed once.
    expect(rows.find((r) => r.registrationId === 'reg_l')?.signedIn).toBe(true);
    expect(rows.filter((r) => !r.registrationId)).toHaveLength(1);
    const stats = attendeeListStats(rows);
    expect(stats.ticketHolders).toBe(3);
    expect(stats.multiHolders).toBe(1);
  });
});
