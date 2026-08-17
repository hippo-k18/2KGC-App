import { useCallback, useEffect, useState } from 'react';
import { onSnapshot, type DocumentReference } from 'firebase/firestore';

import { refreshCredentials, type DataStatus } from '@/lib/data/errors';

export interface DocumentResult<T> {
  /**
   * The document, or `null` for "settled and absent" *when `status` is `ready`*.
   * On `error` this holds whatever last loaded, which may also be `null` — the
   * two cases are told apart by `status`, never by the value, because "this
   * attendee has no profile" and "you were not allowed to read it" lead to
   * completely different screens.
   */
  data: T | null;
  error: Error | null;
  status: DataStatus;
  /** `status === 'loading'`. */
  loading: boolean;
  retry: () => void;
}

/**
 * The single-document sibling of `useCollection`, with the same two guarantees:
 * a listener here cannot take the app down, and a refused read is never reported
 * as an absent document.
 *
 * Every `onSnapshot` needs an error callback. Without one the Firebase SDK
 * rethrows asynchronously and React unmounts the whole tree — a white screen
 * instead of a screen. The reliable way to trigger that is signing out: the
 * credential is invalidated immediately, but effect cleanup does not run until
 * the next render, so every live listener takes a `permission-denied` in the
 * window between the two.
 *
 * Unlike `useCollection` this does not consult the auth context, because
 * `AuthProvider` itself uses it to watch the signed-in attendee's profile and
 * would read its own default context value. Callers gate instead by returning
 * `null` from `buildRef` when there is nothing to watch yet — which is the same
 * thing they already do with the uid they are keying on.
 */
export function useDocument<T>(
  buildRef: () => DocumentReference | null,
  deps: unknown[],
  map: (id: string, data: any) => T,
): DocumentResult<T> {
  // `status` is tracked rather than inferred from `data === null` the way
  // `useCollection` originally did: for a document, "absent" is a real, settled
  // answer — it is how a first sign-in is detected — and must not read as
  // "still loading" forever, nor as a denial.
  const [state, setState] = useState<{ data: T | null; status: DataStatus; error: Error | null }>({
    data: null,
    status: 'loading',
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    void refreshCredentials().then(() => setAttempt((n) => n + 1));
  }, []);

  useEffect(() => {
    // Reset before resubscribing, so a change of deps never shows the previous
    // document's contents as though they were the new one's.
    setState({ data: null, status: 'loading', error: null });

    const ref = buildRef();
    if (!ref) return;

    return onSnapshot(
      ref,
      (snap) => {
        try {
          if (!snap.exists()) {
            // `fromCache` is the whole difference between "this document is gone"
            // and "this phone cannot reach the server". The SDK gives the backend
            // ten seconds and then raises whatever the local cache holds — and for
            // a document the cache has never seen, that is an *absent* one. Taken
            // at face value it made a stalled read indistinguishable from a
            // deletion, so `people/[uid].tsx` told attendees a colleague was "not
            // listed in the directory" and `community/[id].tsx` said "Post
            // removed", both because the wifi had dropped. Only a
            // server-confirmed absence is worth reporting as an absence; until
            // then this stays in `loading`, which is the truth.
            if (snap.metadata.fromCache) return;
            setState({ data: null, status: 'ready', error: null });
            return;
          }
          setState({ data: map(snap.id, snap.data()), status: 'ready', error: null });
        } catch (e) {
          // `map` runs inside the snapshot callback, where the error observer
          // below cannot see it, so one malformed document would throw out of
          // the SDK and unmount the tree.
          const err = e instanceof Error ? e : new Error(String(e));
          console.warn('[firestore] document mapping failed:', err.message);
          setState((prev) => ({ data: prev.data, status: 'error', error: err }));
        }
      },
      (e) => {
        // Terminal, like the collection listener's: a denied stream is closed by
        // the SDK and never reopened, so `retry` is the only way back.
        console.warn('[firestore] document listener failed:', e.code, e.message);
        setState((prev) => ({ data: prev.data, status: 'error', error: e as Error }));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, ...deps]);

  return {
    data: state.data,
    error: state.error,
    status: state.status,
    loading: state.status === 'loading',
    retry,
  };
}
