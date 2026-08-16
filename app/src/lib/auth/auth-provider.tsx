import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { COLLECTIONS, EVENT_ID, type UserDoc, type WithId } from '@kgc/shared';

import { useDocument } from '@/lib/data/use-document';
import { runWrite } from '@/lib/data/write';
import { getDb, getFirebaseAuth, isFirebaseConfigured } from '@/lib/firebase/client';

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
  const [auth, setAuth] = useState<{ user: User | null; loading: boolean }>({
    user: null,
    loading: configured,
  });

  useEffect(() => {
    if (!configured) return;
    return onAuthStateChanged(getFirebaseAuth(), (user) => {
      setAuth({ user, loading: false });
    });
  }, [configured]);

  const uid = auth.user?.uid;

  // Live profile, so organizer edits and other devices show up immediately.
  // `useDocument` rather than a bare `onSnapshot` for its error callback: the
  // credential dies the instant sign-out is tapped, but this effect's cleanup
  // does not run until the next render, and a `permission-denied` with no error
  // observer unmounts the entire app.
  const {
    data: profile,
    loading: profileLoading,
    error: profileError,
  } = useDocument<WithId<UserDoc>>(
    () => (uid ? doc(getDb(), COLLECTIONS.users, uid) : null),
    [uid],
    (id, d) => ({ id, ...d }) as WithId<UserDoc>,
  );

  useCreateProfileOnFirstSignIn(auth.user, profile, profileLoading || Boolean(profileError));

  const value = useMemo<AuthState>(
    () => ({ user: auth.user, profile, loading: auth.loading, configured }),
    [auth.user, auth.loading, profile, configured],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

/**
 * Writes `users/{uid}` the first time an attendee signs in.
 *
 * Nothing else creates it. The seed writes 50 profiles, which is why the demo
 * looks fine, but a real attendee arriving through sign-in had no document at
 * all: their name fell back to a placeholder, both privacy switches showed their
 * defaults rather than their choices, and every profile update failed with
 * `not-found`.
 *
 * The shape is exactly what the create rule permits — the caller's own uid,
 * `email` lowercased to match `token.email.lower()`, and `roles: ['attendee']`,
 * since nobody may grant themselves a role. `merge` so that an existing profile
 * is never clobbered, and it runs only once the listener has confirmed the
 * document is genuinely absent rather than merely not loaded yet.
 */
function useCreateProfileOnFirstSignIn(
  user: User | null,
  profile: WithId<UserDoc> | null,
  unsettled: boolean,
) {
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!user || profile || unsettled) return;
    // One attempt per uid. A denied write (no `registered` claim, i.e. not a
    // ticket holder) must not become a retry loop against the rules.
    if (attempted.current === user.uid) return;
    attempted.current = user.uid;

    const email = (user.email ?? '').toLowerCase();
    void runWrite('create profile', () =>
      setDoc(
        doc(getDb(), COLLECTIONS.users, user.uid),
        {
          eventId: EVENT_ID,
          email,
          name: user.displayName || email.split('@')[0] || 'Attendee',
          interests: [],
          onboarded: false,
          // Defaults that match the rest of the app: findable and messageable,
          // both switchable from Me.
          visibleInDirectory: true,
          messagingEnabled: true,
          notificationPrefs: { announcements: true, messages: true, sessionReminders: true },
          roles: ['attendee'],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );
  }, [user, profile, unsettled]);
}

export function useAuth() {
  return use(AuthContext);
}

export async function logout() {
  await signOut(getFirebaseAuth());
}
