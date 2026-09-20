import { seatCap, seatsLeft, type SeatGate, type SeatState } from '@kgc/shared';

/**
 * The words on a capped session, kept apart from the hook so they can be
 * tested. The seat arithmetic itself is in `@kgc/shared`; this is only what an
 * attendee reads.
 */

export type MySeat = 'seated' | 'waitlisted' | null;

/** "12 of 40 seats taken", or the queue once it is full. Null when uncapped. */
export function seatLine(state: SeatState, gate: SeatGate): string | null {
  const cap = seatCap(gate);
  if (cap === null) return null;
  const left = seatsLeft(state, gate) ?? 0;
  if (left > 0 && state.waitlist.length === 0) {
    return `${state.taken} of ${cap} seats taken`;
  }
  const waiting = state.waitlist.length;
  return waiting > 0 ? `Full. ${waiting} on the waitlist.` : 'Full.';
}

/** Where the caller stands, in their own terms. */
export function mySeatLine(state: SeatState, uid: string | null, mine: MySeat): string | null {
  if (mine === 'seated') return 'You have a seat.';
  if (mine !== 'waitlisted' || !uid) return null;
  const position = state.waitlist.indexOf(uid) + 1;
  return position > 0
    ? `You are number ${position} on the waitlist. You get a seat when one frees.`
    : 'You are on the waitlist. You get a seat when one frees.';
}

export function seatButtonLabel(state: SeatState, gate: SeatGate, mine: MySeat): string {
  if (mine === 'seated') return 'In My Agenda';
  if (mine === 'waitlisted') return 'Leave Waitlist';
  const left = seatsLeft(state, gate);
  const full = (left !== null && left === 0) || state.waitlist.length > 0;
  return full ? 'Join Waitlist' : 'Reserve a Seat';
}
