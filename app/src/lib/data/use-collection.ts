import { useEffect, useState } from 'react';
import { onSnapshot, type Query } from 'firebase/firestore';

import { useAuth } from '@/lib/auth/auth-provider';

/**
 * A Firestore collection listener that cannot take the app down.
 *
 * Two things every listener in this app needs, and which are easy to omit one
 * screen at a time:
 *
 * 1. **An error callback.** Without one, `onSnapshot` throws asynchronously and
 *    React unmounts the whole tree — a single `permission-denied` turns into a
 *    white screen with no message. That is the worst possible failure on a
 *    conference floor, and it is what happens by default.
 *
 * 2. **Waiting for auth.** Every rule in this app gates on the `registered`
 *    claim, so a listener started before sign-in resolves is guaranteed to be
 *    denied. Subscribing eagerly does not race — it reliably fails.
 *
 * Errors are surfaced to the caller so a screen can say something useful,
 * rather than swallowed.
 */
export function useCollection<T>(
  buildQuery: () => Query,
  deps: unknown[],
  map: (id: string, data: any) => T,
  sort?: (a: T, b: T) => number,
) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<T[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (authLoading || !user) {
      // Not an error state — just nothing to listen to yet.
      setData(null);
      return;
    }
    setError(null);
    const unsub = onSnapshot(
      buildQuery(),
      (snap) => {
        const rows = snap.docs.map((d) => map(d.id, d.data()));
        if (sort) rows.sort(sort);
        setData(rows);
      },
      (e) => {
        // Logged rather than thrown. A denied or dropped listener should leave
        // the screen showing stale data and an explanation, not a blank app.
        console.warn('[firestore] listener failed:', e.message);
        setError(e as Error);
        setData((prev) => prev ?? []);
      },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, ...deps]);

  return { data, error, loading: data === null && !error };
}
