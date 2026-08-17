import { useCallback, useMemo } from 'react';
import { collection, deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';

import { useAuth } from '@/lib/auth/auth-provider';
import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';
import { runWrite, type WriteResult } from '@/lib/data/write';

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

  const toggle = useCallback(
    async (sessionId: string): Promise<WriteResult> => {
      if (!user) return { ok: false, error: new Error('Not signed in') };
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
      return saved.has(sessionId)
        ? runWrite('remove saved session', () => deleteDoc(ref))
        : runWrite('save session', () =>
            setDoc(ref, { sessionId, savedAt: serverTimestamp(), remind: true }),
          );
    },
    [user, saved],
  );

  return { saved, error, retry, toggle, isSaved: (id: string) => saved.has(id) };
}
