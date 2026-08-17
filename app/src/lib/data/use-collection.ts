import { useCallback, useEffect, useState } from 'react';
import { onSnapshot, type Query } from 'firebase/firestore';

import { useAuth } from '@/lib/auth/auth-provider';
import { refreshCredentials, type DataStatus } from '@/lib/data/errors';

export type { DataStatus };

export interface CollectionResult<T> {
  /**
   * The last rows that loaded, or `null` if none ever did. Deliberately *not*
   * cleared on failure — a listener that drops mid-conference should leave the
   * agenda on screen — and deliberately not faked as `[]` either. Read `status`
   * to know which of the two you are looking at.
   */
  data: T[] | null;
  error: Error | null;
  status: DataStatus;
  /** `status === 'loading'`, for the many callers that only need the boolean. */
  loading: boolean;
  /**
   * Resubscribes, after forcing a fresh ID token. Worth offering for every kind
   * of failure except `misconfigured` — see `isRetryable` in `errors.ts`.
   */
  retry: () => void;
}

/**
 * A Firestore collection listener that cannot take the app down, and cannot
 * quietly claim the conference is empty either.
 *
 * Four things every listener in this app needs, and which are easy to omit one
 * screen at a time:
 *
 * 1. **An error callback.** Without one, `onSnapshot` throws asynchronously and
 *    React unmounts the whole tree — a single `permission-denied` turns into a
 *    white screen with no message. That is the worst possible failure on a
 *    conference floor, and it is what happens by default.
 *
 * 2. **Not subscribing while signed out.** `firestore.rules` is default-closed,
 *    so a listener opened with no credential at all is denied outright — and a
 *    denial is terminal, see below, which means the screen would stay dead for
 *    the rest of its life. Note the narrow claim: this gate is about `user`
 *    being `null`, *not* about racing the token. Subscribing during the window
 *    where auth has not resolved yet does not fail — the SDK queues the listen
 *    until credentials arrive, measured at 35 ms — so no comment here should be
 *    read as saying otherwise.
 *
 * 3. **A guarded success path.** The error callback covers the listener, not the
 *    `map`/`sort` this hook runs inside it, so both are wrapped below.
 *
 * 4. **A status that distinguishes failure from emptiness**, which is the whole
 *    reason `DataStatus` exists. See the note on it.
 *
 * ## Recovery is manual, and that is not an oversight
 *
 * A `permission-denied` **terminates** a Firestore listener. The SDK does not
 * retry it, ever: the stream is closed and no later snapshot will arrive, so a
 * screen denied at mount stays empty even after the cause has gone away — the
 * attendee's claim lands, and nothing tells the listener. This hook resubscribes
 * only when `deps` change, which for the agenda and the directory is never.
 *
 * So `retry` below is the only way back, and it is deliberately a button rather
 * than a timer: a poll against the rules is a request loop nobody asked for, and
 * the thing that actually has to change first is the ID token, which only the
 * user can trigger by acting.
 *
 * `use-document.ts` is the single-document sibling.
 */
export function useCollection<T>(
  buildQuery: () => Query,
  deps: unknown[],
  map: (id: string, data: any) => T,
  sort?: (a: T, b: T) => number,
): CollectionResult<T> {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<{
    data: T[] | null;
    status: DataStatus;
    error: Error | null;
  }>({ data: null, status: 'loading', error: null });
  // Bumped by `retry`, and a dep of the effect below, so a retry is an ordinary
  // resubscribe rather than a second code path that can drift from the first.
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    // The token refresh is the part that can actually change the answer on a
    // `permission-denied` — see `refreshCredentials`. Resubscribing either way,
    // because the other failure kinds need only the second attempt.
    void refreshCredentials().then(() => setAttempt((n) => n + 1));
  }, []);

  useEffect(() => {
    // Cleared on every resubscribe, not only when signed out. Leaving the
    // previous query's rows in place reported "loaded" while the screen was
    // still showing the old category's posts under the new category's heading.
    setState({ data: null, status: 'loading', error: null });
    if (authLoading || !user) {
      // Not an error state — just nothing to listen to yet. Holding off until
      // `user` exists avoids opening a listener that would be denied outright and
      // then, because a denial is terminal, stay denied for the screen's whole
      // life. See point 2 above for what this is *not* claiming.
      return;
    }
    const unsub = onSnapshot(
      buildQuery(),
      (snap) => {
        try {
          const rows = snap.docs.map((d) => map(d.id, d.data()));
          if (sort) rows.sort(sort);
          setState({ data: rows, status: 'ready', error: null });
        } catch (e) {
          // `map` and `sort` run inside the snapshot callback, which the error
          // observer below does not cover: a throw from here escapes the SDK
          // and unmounts the tree. One session missing `startsAtLocal` took the
          // agenda, Home and My Schedule down together. Keep the last good rows
          // and report the failure instead.
          const err = e instanceof Error ? e : new Error(String(e));
          console.warn('[firestore] snapshot mapping failed:', err.message);
          setState((prev) => ({ data: prev.data, status: 'error', error: err }));
        }
      },
      (e) => {
        // Logged rather than thrown. A denied or dropped listener should leave
        // the screen showing stale data and an explanation, not a blank app —
        // and not a convincing empty one, which is what `data: []` bought.
        //
        // This is the end of the stream, not a hiccup in it: the SDK closes a
        // listener that takes a `permission-denied` and never reopens it. Nothing
        // after this line will fire until `retry` or a `deps` change builds a new
        // one, which is why the error is held in state rather than treated as a
        // transient.
        console.warn('[firestore] listener failed:', e.code, e.message);
        setState((prev) => ({ data: prev.data, status: 'error', error: e as Error }));
      },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, attempt, ...deps]);

  return {
    data: state.data,
    error: state.error,
    status: state.status,
    loading: state.status === 'loading',
    retry,
  };
}
