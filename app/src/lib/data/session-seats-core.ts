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

/** One registration listener, reduced to the three facts the answer needs. */
export interface TicketRead {
  /** The ticket types the listener returned, or null before it has answered. */
  rows: (string | null)[] | null;
  loading: boolean;
  error: unknown;
}

/** What the screen knows about the reader's ticket, and how firmly. */
export interface TicketAnswer {
  /** The ticket they hold, or null when none was found or none was read. */
  ticketType: string | null;
  /** True only when a lookup ran and settled. An empty result is an answer. */
  known: boolean;
  /** True while a lookup that really opened has yet to come back. */
  pending: boolean;
}

const UNKNOWN: TicketAnswer = { ticketType: null, known: false, pending: false };

/**
 * The reader's ticket, from the primary lookup and the alternates fallback.
 *
 * Three outcomes, and the difference between them is the whole point:
 *
 *   · **Known.** A registration answered, with a ticket type or without one.
 *     A restricted session can be honest about whether they may come.
 *   · **Pending.** A listener is out. The button waits rather than flickering
 *     between "Reserve a Seat" and "Not on your ticket".
 *   · **Unknown and settled.** No lookup could be made — the account carries no
 *     address — or the read was refused. The screen must NOT bar anybody on
 *     this: a screen that locks somebody out because its own lookup never ran
 *     is worse than one that asks and is told no, and the transaction and the
 *     rules still answer on the press. An account with no address used to sit
 *     in `pending` forever, because neither query is ever built and a listener
 *     that never opens never stops loading, so the button stayed disabled with
 *     nothing on screen to explain it.
 *
 * `address` is the folded address both queries were built from, so a caller
 * that has none is answered here rather than by two listeners that never open.
 */
export function ticketAnswer(
  address: string | null,
  primary: TicketRead,
  alternate: TicketRead,
): TicketAnswer {
  if (!address) return UNKNOWN;
  if (primary.loading) return { ...UNKNOWN, pending: true };
  if (primary.error || primary.rows === null) return UNKNOWN;
  if (primary.rows.length > 0) {
    return { ticketType: primary.rows[0] ?? null, known: true, pending: false };
  }
  // The primary address found nothing, so the alternates query is the one that
  // matters. It is not opened until the primary has settled empty, so
  // `rows === null` with nothing wrong is "not asked yet" rather than "no
  // answer" — which is why the refusal is checked before the rows.
  if (alternate.error) return UNKNOWN;
  if (alternate.loading || alternate.rows === null) return { ...UNKNOWN, pending: true };
  return {
    ticketType: alternate.rows.length > 0 ? (alternate.rows[0] ?? null) : null,
    known: true,
    pending: false,
  };
}
