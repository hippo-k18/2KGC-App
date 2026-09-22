import { describe, expect, it } from 'vitest';

import { mySeatLine, seatButtonLabel, seatLine, ticketAnswer } from './session-seats-core';
import { myAddress } from './registrations';

describe('seatLine', () => {
  it('says nothing about an uncapped session', () => {
    expect(seatLine({ taken: 9, waitlist: [] }, {})).toBeNull();
  });

  it('counts seats while there is room', () => {
    expect(seatLine({ taken: 12, waitlist: [] }, { capacity: 40 })).toBe('12 of 40 seats taken');
  });

  it('switches to the queue once full', () => {
    expect(seatLine({ taken: 40, waitlist: [] }, { capacity: 40 })).toBe('Full.');
    expect(seatLine({ taken: 40, waitlist: ['a', 'b'] }, { capacity: 40 })).toBe(
      'Full. 2 on the waitlist.',
    );
  });
});

describe('mySeatLine', () => {
  it('gives the position in the queue', () => {
    expect(mySeatLine({ taken: 2, waitlist: ['a', 'b'] }, 'b', 'waitlisted')).toBe(
      'You are number 2 on the waitlist. You get a seat when one frees.',
    );
  });

  it('is silent for somebody with no seat', () => {
    expect(mySeatLine({ taken: 2, waitlist: [] }, 'a', null)).toBeNull();
    expect(mySeatLine({ taken: 2, waitlist: [] }, 'a', 'seated')).toBe('You have a seat.');
  });
});

describe('seatButtonLabel', () => {
  const gate = { capacity: 2 };

  it('offers a seat, then the waitlist', () => {
    expect(seatButtonLabel({ taken: 1, waitlist: [] }, gate, null)).toBe('Reserve a Seat');
    expect(seatButtonLabel({ taken: 2, waitlist: [] }, gate, null)).toBe('Join Waitlist');
    expect(seatButtonLabel({ taken: 1, waitlist: ['x'] }, gate, null)).toBe('Join Waitlist');
  });

  it('offers a seat on an uncapped, ticket-restricted session', () => {
    expect(seatButtonLabel({ taken: 99, waitlist: [] }, { eligibleTicketTypes: ['Full Pass'] }, null)).toBe(
      'Reserve a Seat',
    );
  });

  it('reflects what the caller already holds', () => {
    expect(seatButtonLabel({ taken: 2, waitlist: [] }, gate, 'seated')).toBe('In My Agenda');
    expect(seatButtonLabel({ taken: 2, waitlist: ['a'] }, gate, 'waitlisted')).toBe('Leave Waitlist');
  });
});

describe('myAddress', () => {
  it('folds the address the way registrations store it', () => {
    expect(myAddress('Ada.Okonkwo@Example.com')).toBe('ada.okonkwo@example.com');
    expect(myAddress('  ada@example.com  ')).toBe('ada@example.com');
  });

  it('is null for an account with no address to look up', () => {
    expect(myAddress(null)).toBeNull();
    expect(myAddress(undefined)).toBeNull();
    expect(myAddress('   ')).toBeNull();
  });
});

describe('ticketAnswer', () => {
  const out = { rows: null, loading: true, error: null };
  const empty = { rows: [], loading: false, error: null };
  const found = (type: string | null) => ({ rows: [type], loading: false, error: null });

  it('reads the ticket off the primary address', () => {
    expect(ticketAnswer('ada@example.com', found('Gold'), out)).toEqual({
      ticketType: 'Gold',
      known: true,
      pending: false,
    });
  });

  it('falls back to a registration holding the address as an alternate', () => {
    expect(ticketAnswer('ada@example.com', empty, found('Platinum'))).toEqual({
      ticketType: 'Platinum',
      known: true,
      pending: false,
    });
  });

  it('waits for the alternates lookup rather than settling on the empty primary', () => {
    expect(ticketAnswer('ada@example.com', empty, out).pending).toBe(true);
    expect(ticketAnswer('ada@example.com', empty, out).known).toBe(false);
  });

  it('settles on no ticket once both lookups have answered', () => {
    expect(ticketAnswer('ada@example.com', empty, empty)).toEqual({
      ticketType: null,
      known: true,
      pending: false,
    });
  });

  it('settles, without barring anybody, for an account carrying no address', () => {
    // Both queries are built from the address, so neither one ever opens and
    // neither one ever stops loading. Answered here instead of hanging.
    expect(ticketAnswer(null, out, out)).toEqual({
      ticketType: null,
      known: false,
      pending: false,
    });
  });

  it('leaves the ticket unknown when a lookup was refused', () => {
    const refused = { rows: null, loading: false, error: new Error('permission-denied') };
    expect(ticketAnswer('ada@example.com', refused, out).known).toBe(false);
    expect(ticketAnswer('ada@example.com', refused, out).pending).toBe(false);
    expect(ticketAnswer('ada@example.com', empty, refused).known).toBe(false);
    expect(ticketAnswer('ada@example.com', empty, refused).pending).toBe(false);
  });

  it('holds a registration with no ticket type apart from no registration', () => {
    // Both are `ticketType: null`, and both are refused by a restricted
    // session — but only the first is an answer the screen may act on.
    expect(ticketAnswer('ada@example.com', found(null), out).known).toBe(true);
  });
});
