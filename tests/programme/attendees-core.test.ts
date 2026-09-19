/**
 * Tests for the join behind `listAttendees()`.
 *
 * Pure, for the same reason `attendance-core` is: the merge takes plain arrays
 * and the two Firestore reads around it are a separate module.
 *
 * The last test is the one with a history. Both reads were once projected to
 * `email` alone, and the merge did not throw on the stubs it was handed: it
 * printed the address as the name and "no ticket" for every holder. That is
 * what a projected document looks like from in here, so it is pinned as the
 * shape to recognise rather than as behaviour to rely on.
 *
 * Run with: npm test  (or npm run test:programme)
 */
import { describe, expect, it } from 'vitest';
import { mergeAttendees } from '../../apps/organizer/src/lib/attendees-core';

const user = (id: string, data: Record<string, unknown>) => ({ id, data });
const reg = (id: string, data: Record<string, unknown>) => ({ id, data });

describe('mergeAttendees', () => {
  it('attaches the ticket to the profile with the same address, whatever its case', () => {
    const rows = mergeAttendees(
      [
        user('u1', {
          name: 'Ada Lovelace',
          email: 'Ada@Example.org ',
          title: 'Analyst',
          company: 'Engines Ltd',
          roles: ['attendee'],
          visibleInDirectory: true,
        }),
      ],
      [reg('reg_1', { email: 'ada@example.org', ticketType: 'Main Conference', status: 'active' })],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      uid: 'u1',
      name: 'Ada Lovelace',
      title: 'Analyst',
      company: 'Engines Ltd',
      visibleInDirectory: true,
      signedIn: true,
      registrationId: 'reg_1',
      ticketType: 'Main Conference',
      registrationStatus: 'active',
    });
  });

  it('keeps a ticket holder who has never signed in, under the name on the ticket', () => {
    const rows = mergeAttendees(
      [],
      [reg('reg_2', { email: 'grace@example.org', name: 'Grace Hopper', ticketType: 'Workshop' })],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        name: 'Grace Hopper',
        signedIn: false,
        visibleInDirectory: false,
        ticketType: 'Workshop',
      }),
    ]);
    expect(rows[0].uid).toBeUndefined();
  });

  it('keeps a profile with no ticket, and says it has none', () => {
    const rows = mergeAttendees([user('staff', { name: 'Desk Staff', email: 's@example.org' })], []);
    expect(rows[0].ticketType).toBeUndefined();
    expect(rows[0].registrationId).toBeUndefined();
  });

  it('sorts by name and survives a profile with no name', () => {
    const rows = mergeAttendees(
      [user('u2', { email: 'zed@example.org' }), user('u3', { name: 'Alan', email: 'a@example.org' })],
      [],
    );
    expect(rows.map((r) => r.name)).toEqual(['Alan', 'zed@example.org']);
  });

  it('shows what an email-only projection does to the list, so it is recognised next time', () => {
    const rows = mergeAttendees(
      [user('u1', { email: 'ada@example.org' })],
      [reg('reg_1', { email: 'ada@example.org' })],
    );
    expect(rows[0].name).toBe('ada@example.org');
    expect(rows[0].ticketType).toBeUndefined();
  });
});
