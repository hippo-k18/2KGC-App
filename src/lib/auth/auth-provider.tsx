"use client";

import { createContext, use, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { getDb, getFirebaseAuth } from "@/lib/firebase/client";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { UserDoc, WithId } from "@/types/models";

interface AuthState {
  /** Firebase auth user, or null when signed out. */
  user: User | null;
  /** The attendee's Firestore profile; null until it exists. */
  profile: WithId<UserDoc> | null;
  /** True until the first auth state resolves — render nothing auth-dependent. */
  loading: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    loading: true,
  });

  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (user) => {
      setState({ user, profile: null, loading: false });
    });
  }, []);

  const uid = state.user?.uid;
  useEffect(() => {
    if (!uid) return;
    // Live profile so edits elsewhere (or organizer changes) show up immediately.
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
