import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';

import { useAuth } from '@/lib/auth/auth-provider';
import { getDb } from '@/lib/firebase/client';

/**
 * The personal agenda: `users/{uid}/savedSessions/{sessionId}`.
 *
 * Keyed by session id rather than an auto id, so saving twice is idempotent and
 * "is this saved?" is a set membership test rather than a query. It also means
 * the offline queue cannot produce two copies of the same save.
 */
export function useSavedSessions() {
  const { user } = useAuth();
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) {
      setSaved(new Set());
      return;
    }
    const ref = collection(getDb(), COLLECTIONS.users, user.uid, SUBCOLLECTIONS.savedSessions);
    return onSnapshot(ref, (snap) => {
      setSaved(new Set(snap.docs.map((d) => d.id)));
    });
  }, [user]);

  const toggle = useCallback(
    async (sessionId: string) => {
      if (!user) return;
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
      if (saved.has(sessionId)) {
        await deleteDoc(ref);
      } else {
        await setDoc(ref, { sessionId, savedAt: serverTimestamp(), remind: true });
      }
    },
    [user, saved],
  );

  return { saved, toggle, isSaved: (id: string) => saved.has(id) };
}
