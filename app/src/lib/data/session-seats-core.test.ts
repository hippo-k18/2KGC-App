import { describe, expect, it } from 'vitest';

import { mySeatLine, seatButtonLabel, seatLine } from './session-seats-core';

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
