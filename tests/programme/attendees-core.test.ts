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
import {
  losesAppAccess,
  mergeAttendees,
  preferRegistration,
  seatToRelease,
  validateAttendeeDetails,
  type SeatOrder,
} from '../../apps/organizer/src/lib/attendees-core';

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

describe('two registrations for one address', () => {
  const cancelled = reg('reg_old', { email: 'ada@example.org', ticketType: 'Workshop', status: 'cancelled' });
  const active = reg('reg_new', { email: 'ADA@example.org', ticketType: 'Main Conference', status: 'active' });

  it('shows the active ticket when the cancelled one is read last', () => {
    // The bug: the last one read won, so the list said "cancelled" about
    // somebody whose badge scans.
    const rows = mergeAttendees([], [active, cancelled]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      registrationId: 'reg_new',
      ticketType: 'Main Conference',
      registrationStatus: 'active',
    });
  });

  it('shows the active ticket when the cancelled one is read first', () => {
    const rows = mergeAttendees([], [cancelled, active]);
    expect(rows[0]).toMatchObject({ registrationId: 'reg_new', registrationStatus: 'active' });
  });

  it('does the same when a profile exists for the address', () => {
    const rows = mergeAttendees(
      [user('u1', { name: 'Ada Lovelace', email: 'ada@example.org' })],
      [active, cancelled],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ uid: 'u1', registrationId: 'reg_new', registrationStatus: 'active' });
  });

  it('still shows a cancelled ticket when it is the only one', () => {
    const rows = mergeAttendees([], [cancelled]);
    expect(rows[0].registrationStatus).toBe('cancelled');
  });

  it('breaks a tie on the later update, not on read order', () => {
    const older = { status: 'cancelled' as const, updatedAt: new Date('2026-09-01') as never };
    const newer = { status: 'cancelled' as const, updatedAt: new Date('2026-09-02') as never };
    expect(preferRegistration(older, newer)).toBe(newer);
    expect(preferRegistration(newer, older)).toBe(newer);
  });
});

describe('what an organizer typed on the registration', () => {
  it('fills title and company for a holder who has not signed in', () => {
    const rows = mergeAttendees(
      [],
      [reg('reg_1', { email: 'ada@example.org', name: 'Ada', title: 'Analyst', company: 'Engines Ltd', status: 'active' })],
    );
    expect(rows[0]).toMatchObject({ title: 'Analyst', company: 'Engines Ltd' });
  });

  it('does not overwrite what the attendee wrote on their own profile', () => {
    const rows = mergeAttendees(
      [user('u1', { name: 'Ada', email: 'ada@example.org', title: 'Countess' })],
      [reg('reg_1', { email: 'ada@example.org', title: 'Analyst', company: 'Engines Ltd', status: 'active' })],
    );
    expect(rows[0]).toMatchObject({ title: 'Countess', company: 'Engines Ltd' });
  });
});

describe('validateAttendeeDetails', () => {
  it('trims, collapses spaces and lowercases the address', () => {
    const r = validateAttendeeDetails({ name: '  Ada   Lovelace ', email: ' Ada@Example.ORG ', title: '', company: ' Engines ' });
    expect(r).toEqual({
      ok: true,
      values: { name: 'Ada Lovelace', email: 'ada@example.org', title: '', company: 'Engines' },
    });
  });

  it('names the field that is wrong', () => {
    const r = validateAttendeeDetails({ name: '', email: 'not-an-address' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors).sort()).toEqual(['email', 'name']);
  });
});

describe('losesAppAccess', () => {
  it('ends access for somebody who was only ever an attendee', () => {
    expect(losesAppAccess(['attendee'])).toBe(true);
    expect(losesAppAccess(undefined)).toBe(true);
  });

  it('keeps a speaker or organizer in the app when their ticket goes', () => {
    expect(losesAppAccess(['attendee', 'speaker'])).toBe(false);
    expect(losesAppAccess(['organizer'])).toBe(false);
  });
});

describe('seatToRelease', () => {
  const order = (o: Partial<SeatOrder>): SeatOrder => ({
    id: 'ord_1',
    status: 'paid',
    channel: 'checkout',
    email: 'ada@example.org',
    items: [{ ticketTypeId: 'main-conference', ticketTypeName: 'Main Conference', quantity: 1, unitPriceCents: 79_900 }],
    ...o,
  });
  const ada = { id: 'reg_ada', email: 'Ada@example.org', ticketType: 'Main Conference' };

  it('finds the paid seat behind a buyer', () => {
    expect(seatToRelease(ada, [order({})])).toEqual({ orderId: 'ord_1', ticketTypeId: 'main-conference' });
  });

  it('returns nothing for somebody added by hand, who never took a seat', () => {
    expect(seatToRelease(ada, [])).toBeNull();
    expect(seatToRelease(ada, [order({ email: 'someone@else.org' })])).toBeNull();
  });

  it('ignores refunded, unpaid and demo orders', () => {
    expect(seatToRelease(ada, [order({ status: 'refunded' })])).toBeNull();
    expect(seatToRelease(ada, [order({ status: 'pending', channel: 'invoice' })])).toBeNull();
    expect(seatToRelease(ada, [order({ channel: 'demo' })])).toBeNull();
  });

  it('picks the seat that names the attendee on a group order', () => {
    const group = order({
      email: 'buyer@example.org',
      items: [
        { ticketTypeId: 'workshop', ticketTypeName: 'Workshop', quantity: 1, unitPriceCents: 1, attendeeEmail: 'bob@example.org' },
        { ticketTypeId: 'main-conference', ticketTypeName: 'Main Conference', quantity: 1, unitPriceCents: 1, attendeeEmail: 'ada@example.org' },
      ],
    });
    expect(seatToRelease(ada, [group])?.ticketTypeId).toBe('main-conference');
  });

  it('does not release the same seat twice', () => {
    expect(seatToRelease(ada, [order({ releasedSeats: { reg_ada: 'main-conference' } })])).toBeNull();
  });

  it('does not release a seat that already went back for somebody else', () => {
    expect(seatToRelease(ada, [order({ releasedSeats: { reg_other: 'main-conference' } })])).toBeNull();
  });
});
