/**
 * Session seats — the arithmetic behind a capped or ticket-restricted session.
 *
 * Three writers move a seat: the app (an attendee joining or leaving, inside a
 * client transaction that `firestore.rules` re-checks), the dashboard (an
 * organizer removing somebody or raising the cap, with the Admin SDK), and the
 * rules themselves, which restate the same cases so a hand-built request cannot
 * skip them. The first two call the functions below, so the app and the
 * dashboard cannot disagree about who is next.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 *
 * `sessionSeats/{sessionId}` holds `taken` and the waitlist as an ordered list
 * of uids. It is a list on the counter and not a query over the seat documents
 * because rules cannot run a query: "is this uid first in line" has to be one
 * field read. A waitlist is tens of people, so the one-write-a-second limit on
 * the document is the same limit the counter already has.
 *
 * Plain functions over plain values. No Firestore import, so the same file runs
 * in the app, in the dashboard and under Vitest.
 */

/** The counter half of `SessionSeatsDoc`, which is all the arithmetic needs. */
export interface SeatState {
  taken: number;
  waitlist: string[];
}

export const EMPTY_SEATS: SeatState = { taken: 0, waitlist: [] };

/** What a session says about who may come, as far as seats are concerned. */
export interface SeatGate {
  capacity?: number;
  eligibleTicketTypes?: string[];
}

/** 0 and absent both mean uncapped: no organizer means "nobody may attend". */
export function seatCap(gate: SeatGate): number | null {
  return typeof gate.capacity === "number" && gate.capacity > 0 ? gate.capacity : null;
}

export function eligibleTypes(gate: SeatGate): string[] {
  return Array.isArray(gate.eligibleTicketTypes) ? gate.eligibleTicketTypes.filter(Boolean) : [];
}

/** A session needs a seat when it has a cap or a ticket restriction. */
export function isGated(gate: SeatGate): boolean {
  return seatCap(gate) !== null || eligibleTypes(gate).length > 0;
}

/**
 * Compared verbatim against `RegistrationDoc.ticketType`, because that is the
 * comparison the rules make and the two must not differ. An attendee with no
 * ticket type on record is refused by a restricted session.
 */
export function ticketEligible(gate: SeatGate, ticketType: string | null | undefined): boolean {
  const allowed = eligibleTypes(gate);
  if (allowed.length === 0) return true;
  return typeof ticketType === "string" && allowed.includes(ticketType);
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The line an attendee reads when their ticket does not cover a session. */
export function ineligibleMessage(gate: SeatGate, ticketType: string | null | undefined): string {
  const allowed = eligibleTypes(gate);
  const forWhom = `This session is for ${listNames(allowed)} tickets.`;
  return ticketType ? `${forWhom} Your ticket is ${ticketType}.` : forWhom;
}

export function seatsLeft(state: SeatState, gate: SeatGate): number | null {
  const cap = seatCap(gate);
  return cap === null ? null : Math.max(0, cap - state.taken);
}

export type JoinPlan =
  | { kind: "seated"; next: SeatState }
  | { kind: "waitlisted"; next: SeatState; position: number };

/**
 * What joining does. A free seat goes to the waitlist first: somebody who joins
 * while people are queueing queues behind them, even if a seat happens to be
 * open at that instant.
 */
export function planJoin(state: SeatState, gate: SeatGate, uid: string): JoinPlan {
  const cap = seatCap(gate);
  const queueing = state.waitlist.length > 0;
  if (cap === null ? !queueing : state.taken < cap && !queueing) {
    return { kind: "seated", next: { taken: state.taken + 1, waitlist: state.waitlist } };
  }
  const waitlist = state.waitlist.includes(uid) ? state.waitlist : [...state.waitlist, uid];
  return { kind: "waitlisted", next: { ...state, waitlist }, position: waitlist.indexOf(uid) + 1 };
}

export interface LeavePlan {
  next: SeatState;
  /** The uid whose waitlisted seat becomes a real one in the same write. */
  promote: string | null;
}

/**
 * What giving up a seat does. The first person waiting takes it, unless the
 * session is already over its cap (the organizer lowered it), in which case the
 * seat simply goes.
 */
export function planLeaveSeat(state: SeatState, gate: SeatGate): LeavePlan {
  const cap = seatCap(gate);
  const head = state.waitlist[0];
  if (head !== undefined && (cap === null || state.taken <= cap)) {
    return { next: { taken: state.taken, waitlist: state.waitlist.slice(1) }, promote: head };
  }
  return { next: { taken: Math.max(0, state.taken - 1), waitlist: state.waitlist }, promote: null };
}

export function planLeaveWaitlist(state: SeatState, uid: string): SeatState {
  return { taken: state.taken, waitlist: state.waitlist.filter((u) => u !== uid) };
}

/**
 * Whether the first person waiting may take a seat themselves. True after a cap
 * is raised somewhere that did not promote anybody; the app claims it on sight.
 */
export function canClaim(state: SeatState, gate: SeatGate, uid: string): boolean {
  const cap = seatCap(gate);
  return state.waitlist[0] === uid && (cap === null || state.taken < cap);
}

/** Everybody a new cap lets in, in order. Used when an organizer raises it. */
export function planPromotions(
  state: SeatState,
  gate: SeatGate,
): { next: SeatState; promoted: string[] } {
  const cap = seatCap(gate);
  const room = cap === null ? state.waitlist.length : Math.max(0, cap - state.taken);
  const promoted = state.waitlist.slice(0, room);
  return {
    next: { taken: state.taken + promoted.length, waitlist: state.waitlist.slice(promoted.length) },
    promoted,
  };
}

/** Reads a stored counter defensively; a missing document is an empty room. */
export function seatStateOf(data: unknown): SeatState {
  const d = (data ?? {}) as { taken?: unknown; waitlist?: unknown };
  return {
    taken: typeof d.taken === "number" && d.taken > 0 ? Math.floor(d.taken) : 0,
    waitlist: Array.isArray(d.waitlist)
      ? d.waitlist.filter((u): u is string => typeof u === "string")
      : [],
  };
}
