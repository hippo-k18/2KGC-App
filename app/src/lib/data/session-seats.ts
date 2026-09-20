import { useEffect, useRef } from 'react';
import { doc } from 'firebase/firestore';

import {
  COLLECTIONS,
  EMPTY_SEATS,
  SUBCOLLECTIONS,
  canClaim,
  isGated,
  seatStateOf,
  type SeatGate,
  type SeatState,
  type SessionSeatDoc,
} from '@kgc/shared';

import { useAuth } from '@/lib/auth/auth-provider';
import { getDb } from '@/lib/firebase/client';
import { mySeatLine, seatButtonLabel, seatLine, type MySeat } from '@/lib/data/session-seats-core';
import { claimSeat } from '@/lib/data/session-seats-tx';
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
 */
export function useSessionSeat(session: ({ id: string } & SeatGate) | null) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const id = session?.id ?? null;
  const gated = session ? isGated(session) : false;

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

  const state = counter.data ?? EMPTY_SEATS;
  const mine: MySeat = seat.data ?? null;

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

  return {
    gated,
    /** False until both listeners have answered, so the button does not flicker. */
    ready: gated && !counter.loading && !seat.loading,
    state,
    mine,
    seatLine: session && gated ? seatLine(state, session) : null,
    mySeatLine: mySeatLine(state, uid, mine),
    buttonLabel: session ? seatButtonLabel(state, session, mine) : '',
  };
}
