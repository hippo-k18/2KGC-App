import { useEffect, useRef } from 'react';
import { collection, doc, limit, query, where } from 'firebase/firestore';

import {
  COLLECTIONS,
  EMPTY_SEATS,
  SUBCOLLECTIONS,
  canClaim,
  eligibleTypes,
  ineligibleMessage,
  isGated,
  seatStateOf,
  ticketEligible,
  type RegistrationDoc,
  type SeatGate,
  type SeatState,
  type SessionSeatDoc,
} from '@kgc/shared';

import { useAuth } from '@/lib/auth/auth-provider';
import { getDb } from '@/lib/firebase/client';
import { mySeatLine, seatButtonLabel, seatLine, type MySeat } from '@/lib/data/session-seats-core';
import { claimSeat } from '@/lib/data/session-seats-tx';
import { useCollection } from '@/lib/data/use-collection';
import { useDocument } from '@/lib/data/use-document';
import { detachWrite } from '@/lib/data/write';

/**
 * One session's seats, live: the count everybody sees and the caller's own
 * place. Listens to nothing for a session with no cap and no ticket list.
 *
 * The caller's place is its own document because a waitlisted attendee becomes
 * seated when somebody else leaves, and this listener is how their phone finds
 * out. When the front of the queue can simply take a seat, because a cap was
 * raised, it is claimed here on sight.
 *
 * ## Why the ticket is read here and not only inside the transaction
 *
 * A session can be restricted to certain ticket types, and until this hook read
 * the ticket the screen had no way of knowing whether the reader was allowed in
 * — so it drew a full-width Join Waitlist button, and a tap was the only way to
 * find out the answer was no. The refusal then arrived as a red line that a
 * reload wiped. The transaction still decides, because the screen can be stale
 * and the rules re-check everything; this is so the screen can say up front who
 * the session is for and stop offering a place it cannot give.
 *
 * Only subscribed for a session that names ticket types. A merely capped
 * session is open to every ticket and needs no registration read.
 */
export function useSessionSeat(session: ({ id: string } & SeatGate) | null) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const email = user?.email ?? null;
  const id = session?.id ?? null;
  const gated = session ? isGated(session) : false;
  const restricted = session ? eligibleTypes(session).length > 0 : false;

  const counter = useDocument<SeatState>(
    () => (gated && id ? doc(getDb(), COLLECTIONS.sessionSeats, id) : null),
    [gated, id],
    (_id, d) => seatStateOf(d),
  );
  const seat = useDocument<MySeat>(
    () =>
      gated && id && uid
        ? doc(getDb(), COLLECTIONS.sessionSeats, id, SUBCOLLECTIONS.seats, uid)
        : null,
    [gated, id, uid],
    (_id, d: SessionSeatDoc) => d.status,
  );

  /**
   * The reader's own ticket type, by their address — the same lookup
   * `findTicket` makes before a seat transaction, and compared the same way.
   */
  const ticket = useCollection<string | null>(
    () =>
      restricted && email
        ? query(
            collection(getDb(), COLLECTIONS.registrations),
            where('email', '==', email),
            limit(1),
          )
        : null,
    [restricted, email],
    (_id, d: RegistrationDoc) => d.ticketType ?? null,
  );

  const state = counter.data ?? EMPTY_SEATS;
  const mine: MySeat = seat.data ?? null;

  // A refused or failed registration read leaves the button alone: the
  // transaction and the rules still answer, and a screen that locks somebody
  // out because its own lookup broke is worse than one that asks and is told no.
  const ticketKnown = restricted && !ticket.loading && !ticket.error;
  const ticketType = ticket.data?.[0] ?? null;
  const eligible = !restricted || !ticketKnown || ticketEligible(session ?? {}, ticketType);

  // One attempt per opening. A failed claim is retried when the counter next
  // changes, not in a loop.
  const claimedAt = useRef<string | null>(null);
  useEffect(() => {
    if (!session || !uid || !id || mine !== 'waitlisted' || !canClaim(state, session, uid)) return;
    const key = `${id}:${state.taken}:${state.waitlist.length}`;
    if (claimedAt.current === key) return;
    claimedAt.current = key;
    detachWrite('claim seat', claimSeat(getDb(), uid, id));
  }, [session, uid, id, mine, state]);

  // Somebody who already holds a place keeps it, whatever their ticket says
  // now. Taking it away on screen would not take it away in the database.
  const barred = !eligible && mine === null;

  return {
    gated,
    /** False until every listener has answered, so the button does not flicker. */
    ready: gated && !counter.loading && !seat.loading && (!restricted || !ticket.loading),
    state,
    mine,
    /** True when this session is for ticket types the reader does not hold. */
    barred,
    /** Who the session is for, and what the reader holds. Null when they may come. */
    ticketLine: barred && session ? ineligibleMessage(session, ticketType) : null,
    seatLine: session && gated ? seatLine(state, session) : null,
    mySeatLine: mySeatLine(state, uid, mine),
    buttonLabel: barred
      ? 'Not on your ticket'
      : session
        ? seatButtonLabel(state, session, mine)
        : '',
  };
}
