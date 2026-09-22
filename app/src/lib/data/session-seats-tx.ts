import {
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';

import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  canClaim,
  ineligibleMessage,
  isGated,
  planJoin,
  planLeaveSeat,
  planLeaveWaitlist,
  seatStateOf,
  ticketEligible,
  type RegistrationDoc,
  type SessionDoc,
  type SessionSeatDoc,
} from '@kgc/shared';

import {
  myAddress,
  registrationByAltEmail,
  registrationByEmail,
} from '@/lib/data/registrations';

/**
 * The seat transactions: join, leave, and claim a seat from the front of the
 * waitlist.
 *
 * Takes the `Firestore` handle as an argument and imports nothing from the app,
 * so `tests/rules/session-seats-app.test.ts` runs this exact code against
 * `firestore.rules` on the emulator. The hooks are in `session-seats.ts`.
 *
 * Every decision is made from documents read inside the transaction, never from
 * what the screen was showing: the screen can be a minute stale and the last
 * seat goes in a second. The rules re-check all of it.
 */

/**
 * Runs a seat transaction again when the rules refuse it.
 *
 * When two phones press at once, the slower commit carries a count that is no
 * longer true. The rules look at the database as it now is and answer
 * `permission-denied`, which the SDK does not retry, because for every other
 * write in this app a denial is final. Here it usually means "read again", so
 * this does: a fresh read either finds a seat, finds the waitlist, or is
 * refused for a reason that really is final and comes back out after the last
 * attempt.
 */
async function retrying<T>(run: () => Promise<T>): Promise<T> {
  const ATTEMPTS = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'permission-denied' || attempt >= ATTEMPTS) throw e;
      // Spread out so the same phones do not collide again on the next try.
      await new Promise((r) => setTimeout(r, 40 * attempt + Math.random() * 120));
    }
  }
}

export type SeatOutcome =
  | 'seated'
  | 'waitlisted'
  | 'left'
  | 'saved'
  | 'ineligible'
  | 'no-ticket'
  | 'unavailable';

export interface SeatChange {
  outcome: SeatOutcome;
  /** A line for the attendee, when the outcome is not what they pressed for. */
  message: string | null;
}

interface Ticket {
  registrationId: string;
  ticketType: string | null;
  status: RegistrationDoc['status'];
}

/**
 * The caller's registration, by their own address. A query and not a `getDoc`
 * for the reason `badge.ts` gives: the id is a hash this client cannot compute.
 * Fetched when a seat is asked for rather than listened to, so the agenda does
 * not hold a second registrations listener open for a button most never press.
 *
 * Folded and then looked for under both addresses, the same two steps
 * `useSessionSeat` takes on the screen — the button and the transaction behind
 * it must not be able to reach different answers about one person's ticket.
 */
export async function findTicket(db: Firestore, email: string | null): Promise<Ticket | null> {
  const address = myAddress(email);
  if (!address) return null;
  let snap = await getDocs(registrationByEmail(db, address));
  // Their ticket may be held under a different primary address with this one
  // listed as an alternate, which is what a work purchase and a personal
  // sign-in look like together.
  if (snap.empty) snap = await getDocs(registrationByAltEmail(db, address));
  const d = snap.docs[0];
  if (!d) return null;
  const reg = d.data() as RegistrationDoc;
  return { registrationId: d.id, ticketType: reg.ticketType ?? null, status: reg.status };
}

function refs(db: Firestore, uid: string, sessionId: string) {
  const counter = doc(db, COLLECTIONS.sessionSeats, sessionId);
  return {
    session: doc(db, COLLECTIONS.sessions, sessionId),
    counter,
    seat: (who: string) => doc(counter, SUBCOLLECTIONS.seats, who),
    saved: doc(db, COLLECTIONS.users, uid, SUBCOLLECTIONS.savedSessions, sessionId),
  };
}

const NO_TICKET = 'We could not find your ticket, so this session cannot be added yet.';

/** Adds a session to the schedule, taking a seat or a waitlist place if it needs one. */
export async function joinSession(
  db: Firestore,
  uid: string,
  email: string | null,
  sessionId: string,
): Promise<SeatChange> {
  const ticket = await findTicket(db, email);
  const r = refs(db, uid, sessionId);

  return retrying(() => runTransaction(db, async (tx): Promise<SeatChange> => {
    const sessionSnap = await tx.get(r.session);
    if (!sessionSnap.exists()) {
      return { outcome: 'unavailable', message: 'This session is no longer on the programme.' };
    }
    const session = sessionSnap.data() as SessionDoc;
    const bookmark = { sessionId, savedAt: serverTimestamp(), remind: true };

    if (!isGated(session)) {
      tx.set(r.saved, bookmark);
      return { outcome: 'saved', message: null };
    }

    const [counterSnap, seatSnap] = [await tx.get(r.counter), await tx.get(r.seat(uid))];
    if (seatSnap.exists()) {
      // Already holds a place: make sure the schedule shows it and stop.
      tx.set(r.saved, bookmark);
      return { outcome: (seatSnap.data() as SessionSeatDoc).status, message: null };
    }

    if (!ticket || ticket.status !== 'active') return { outcome: 'no-ticket', message: NO_TICKET };
    if (!ticketEligible(session, ticket.ticketType)) {
      return { outcome: 'ineligible', message: ineligibleMessage(session, ticket.ticketType) };
    }

    const plan = planJoin(seatStateOf(counterSnap.data()), session, uid);
    tx.set(r.counter, {
      eventId: session.eventId,
      sessionId,
      ...plan.next,
      updatedAt: serverTimestamp(),
    });
    tx.set(r.seat(uid), {
      eventId: session.eventId,
      sessionId,
      uid,
      registrationId: ticket.registrationId,
      status: plan.kind,
      createdAt: serverTimestamp(),
    });
    tx.set(r.saved, bookmark);

    return plan.kind === 'seated'
      ? { outcome: 'seated', message: null }
      : {
          outcome: 'waitlisted',
          message: `This session is full. You are number ${plan.position} on the waitlist.`,
        };
  }));
}

/**
 * Takes a session off the schedule. A seat given up goes to the first person
 * waiting in the same commit, so there is never a free seat with a queue behind
 * it and nothing has to run later to hand it over.
 */
export async function leaveSession(db: Firestore, uid: string, sessionId: string): Promise<SeatChange> {
  const r = refs(db, uid, sessionId);

  return retrying(() => runTransaction(db, async (tx): Promise<SeatChange> => {
    const [sessionSnap, counterSnap, seatSnap] = [
      await tx.get(r.session),
      await tx.get(r.counter),
      await tx.get(r.seat(uid)),
    ];
    tx.delete(r.saved);
    if (!seatSnap.exists()) return { outcome: 'left', message: null };

    const session = (sessionSnap.data() ?? {}) as Partial<SessionDoc>;
    const state = seatStateOf(counterSnap.data());
    const counter = {
      eventId: (seatSnap.data() as SessionSeatDoc).eventId,
      sessionId,
      updatedAt: serverTimestamp(),
    };

    if ((seatSnap.data() as SessionSeatDoc).status === 'waitlisted') {
      if (state.waitlist.includes(uid)) {
        tx.set(r.counter, { ...counter, ...planLeaveWaitlist(state, uid) });
      }
      tx.delete(r.seat(uid));
      return { outcome: 'left', message: null };
    }

    const plan = planLeaveSeat(state, session);
    tx.set(r.counter, { ...counter, ...plan.next });
    tx.delete(r.seat(uid));
    if (plan.promote) {
      tx.update(r.seat(plan.promote), { status: 'seated', promotedAt: serverTimestamp() });
    }
    return { outcome: 'left', message: null };
  }));
}

/**
 * First in line takes a seat that opened without anybody leaving, which is what
 * a raised cap looks like from the phone. The dashboard promotes when it raises
 * a cap itself; this covers a cap changed anywhere else. Returns false when
 * there was nothing to claim.
 */
export async function claimSeat(db: Firestore, uid: string, sessionId: string): Promise<boolean> {
  const r = refs(db, uid, sessionId);

  return retrying(() => runTransaction(db, async (tx) => {
    const [sessionSnap, counterSnap, seatSnap] = [
      await tx.get(r.session),
      await tx.get(r.counter),
      await tx.get(r.seat(uid)),
    ];
    if (!sessionSnap.exists() || !seatSnap.exists()) return false;
    if ((seatSnap.data() as SessionSeatDoc).status !== 'waitlisted') return false;

    const state = seatStateOf(counterSnap.data());
    if (!canClaim(state, sessionSnap.data() as SessionDoc, uid)) return false;

    tx.set(r.counter, {
      eventId: (seatSnap.data() as SessionSeatDoc).eventId,
      sessionId,
      taken: state.taken + 1,
      waitlist: state.waitlist.slice(1),
      updatedAt: serverTimestamp(),
    });
    tx.update(r.seat(uid), { status: 'seated', promotedAt: serverTimestamp() });
    return true;
  }));
}
