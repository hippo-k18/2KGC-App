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
 * 3. **A guarded success path.** The error callback covers the listener, not the
 *    `map`/`sort` this hook runs inside it, so both are wrapped below.
 *
 * Errors are surfaced to the caller so a screen can say something useful,
 * rather than swallowed. `use-document.ts` is the single-document sibling.
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
    // Cleared on every resubscribe, not only when signed out. `loading` is
    // derived from `data === null`, so leaving the previous query's rows in
    // place reported "loaded" while the screen was still showing the old
    // category's posts under the new category's heading.
    setData(null);
    if (authLoading || !user) {
      // Not an error state — just nothing to listen to yet.
      return;
    }
    setError(null);
    const unsub = onSnapshot(
      buildQuery(),
      (snap) => {
        try {
          const rows = snap.docs.map((d) => map(d.id, d.data()));
          if (sort) rows.sort(sort);
          setData(rows);
        } catch (e) {
          // `map` and `sort` run inside the snapshot callback, which the error
          // observer below does not cover: a throw from here escapes the SDK
          // and unmounts the tree. One session missing `startsAtLocal` took the
          // agenda, Home and My Schedule down together. Keep the last good rows
          // and report the failure instead.
          const err = e instanceof Error ? e : new Error(String(e));
          console.warn('[firestore] snapshot mapping failed:', err.message);
          setError(err);
          setData((prev) => prev ?? []);
        }
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
