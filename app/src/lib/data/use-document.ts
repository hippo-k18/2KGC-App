import { useEffect, useState } from 'react';
import { onSnapshot, type DocumentReference } from 'firebase/firestore';

/**
 * The single-document sibling of `useCollection`, with the same guarantee: a
 * listener here cannot take the app down.
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
) {
  // `loaded` is tracked separately rather than inferred from `data === null`
  // the way `useCollection` does: for a document, "absent" is a real, settled
  // answer — it is how a first sign-in is detected — and must not read as
  // "still loading" forever.
  const [state, setState] = useState<{ data: T | null; loaded: boolean }>({
    data: null,
    loaded: false,
  });
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Reset before resubscribing, so a change of deps never shows the previous
    // document's contents as though they were the new one's.
    setState({ data: null, loaded: false });
    setError(null);

    const ref = buildRef();
    if (!ref) return;

    return onSnapshot(
      ref,
      (snap) => {
        try {
          setState({ data: snap.exists() ? map(snap.id, snap.data()) : null, loaded: true });
        } catch (e) {
          // `map` runs inside the snapshot callback, where the error observer
          // below cannot see it, so one malformed document would throw out of
          // the SDK and unmount the tree.
          const err = e instanceof Error ? e : new Error(String(e));
          console.warn('[firestore] document mapping failed:', err.message);
          setError(err);
        }
      },
      (e) => {
        console.warn('[firestore] document listener failed:', e.message);
        setError(e as Error);
        setState((prev) => ({ data: prev.data, loaded: true }));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data: state.data, error, loading: !state.loaded && !error };
}
