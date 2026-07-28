import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';

import { COLLECTIONS } from '@/lib/firebase/collections';
import { getDb, getFirebaseAuth, isFirebaseConfigured } from '@/lib/firebase/client';
import type { UserDoc, WithId } from '@/types/models';

interface AuthState {
  /** Firebase auth user, or null when signed out. */
  user: User | null;
  /** The attendee's Firestore profile; null until it exists. */
  profile: WithId<UserDoc> | null;
  /** True until the first auth state resolves. Render nothing auth-dependent. */
  loading: boolean;
  /**
   * False when the Firebase env vars are absent. The app then runs in a
   * browsable "design mode" instead of trapping you on the login screen —
   * see the note in README.md.
   */
  configured: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  loading: true,
  configured: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isFirebaseConfigured();
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    loading: configured,
    configured,
  });

  useEffect(() => {
    if (!configured) return;
    return onAuthStateChanged(getFirebaseAuth(), (user) => {
      setState((prev) => ({ ...prev, user, profile: null, loading: false }));
    });
  }, [configured]);

  const uid = state.user?.uid;
  useEffect(() => {
    if (!uid) return;
    // Live profile, so organizer edits and other devices show up immediately.
    return onSnapshot(doc(getDb(), COLLECTIONS.users, uid), (snap) => {
      setState((prev) => ({
        ...prev,
        profile: snap.exists()
          ? ({ id: snap.id, ...snap.data() } as WithId<UserDoc>)
          : null,
      }));
    });
  }, [uid]);

  return <AuthContext value={state}>{children}</AuthContext>;
}

export function useAuth() {
  return use(AuthContext);
}

export async function logout() {
  await signOut(getFirebaseAuth());
}
