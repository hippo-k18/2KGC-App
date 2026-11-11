import { useCallback, useMemo } from 'react';
import { collection, deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { COLLECTIONS, SUBCOLLECTIONS, isGated, type SeatGate } from '@kgc/shared';

import { useAuth } from '@/lib/auth/auth-provider';
import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';
import { joinSession, leaveSession, type SeatChange } from '@/lib/data/session-seats-tx';
import { runWrite, type WriteResult } from '@/lib/data/write';

/** A toggle's result, with a line to show when it did not do what was pressed. */
export interface ToggleResult extends WriteResult {
  message: string | null;
}

const SEAT_FAILED = 'That did not go through. Check your connection and try again.';

/**
 * A capped or ticket-restricted session goes through the seat transaction, and
 * needs the network: a seat cannot be promised from a queue of offline writes.
 */
async function runSeatChange(label: string, op: () => Promise<SeatChange>): Promise<ToggleResult> {
  try {
    const change = await op();
    const refused = change.outcome === 'ineligible' || change.outcome === 'no-ticket' || change.outcome === 'unavailable';
    return { ok: !refused, error: null, message: change.message };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.warn(`[firestore] ${label} failed:`, error.message);
    return { ok: false, error, message: SEAT_FAILED };
  }
}

/**
 * The personal agenda: `users/{uid}/savedSessions/{sessionId}`.
 *
 * Keyed by session id rather than an auto id, so saving twice is idempotent and
 * "is this saved?" is a set membership test rather than a query. It also means
 * the offline queue cannot produce two copies of the same save.
 *
 * Routed through `useCollection` rather than a bare `onSnapshot`: this listener
 * had no error callback, and signing out denies it before effect cleanup runs,
 * which took the whole app down instead of one screen.
 */
export function useSavedSessions() {
  const { user } = useAuth();
  const { data, error, retry } = useCollection<string>(
    () =>
      collection(
        getDb(),
        COLLECTIONS.users,
        user?.uid ?? '_',
        SUBCOLLECTIONS.savedSessions,
      ),
    [user?.uid],
    (id) => id,
  );

  const saved = useMemo(() => new Set(data ?? []), [data]);

  /**
   * Pass the session when the caller has it. One with a cap or a ticket list
   * takes or gives up a seat; anything else is the plain bookmark below. The
   * rules refuse a bookmark on a gated session without a seat, so leaving the
   * session out cannot get around either limit.
   */
  const toggle = useCallback(
    async (sessionId: string, session?: SeatGate): Promise<ToggleResult> => {
      if (!user) return { ok: false, error: new Error('Not signed in'), message: null };
      if (session && isGated(session)) {
        return saved.has(sessionId)
          ? runSeatChange('leave session', () => leaveSession(getDb(), user.uid, sessionId))
          : runSeatChange('join session', () =>
              joinSession(getDb(), user.uid, user.email?.trim().toLowerCase() ?? null, sessionId),
            );
      }
      const ref = doc(
        getDb(),
        COLLECTIONS.users,
        user.uid,
        SUBCOLLECTIONS.savedSessions,
        sessionId,
      );
      // The snapshot listener updates `saved`, including optimistically while
      // offline — Firestore applies the local mutation before it reaches the
      // server, which is what makes this feel instant on bad conference wifi.
      const result = await (saved.has(sessionId)
        ? runWrite('remove saved session', () => deleteDoc(ref))
        : runWrite('save session', () =>
            setDoc(ref, { sessionId, savedAt: serverTimestamp(), remind: true }),
          ));
      return { ...result, message: null };
    },
    [user, saved],
  );

  return { saved, error, retry, toggle, isSaved: (id: string) => saved.has(id) };
}
