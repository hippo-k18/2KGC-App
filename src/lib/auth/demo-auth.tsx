import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

import { DEMO_CREDENTIALS } from '@/config/demo';

/**
 * Placeholder sign-in for the demo build. It compares against hard-coded
 * credentials — no server, no verification, no security.
 *
 * State is held in memory only and deliberately not persisted, so every reload
 * or fresh launch returns to the login screen. That makes the sign-in flow
 * repeatable when demonstrating the app.
 *
 * Replace with the Firebase flow in src/lib/auth/auth-provider.tsx when real
 * auth lands, then delete this file and src/config/demo.ts.
 */

interface DemoAuthState {
  signedIn: boolean;
  /** Returns an error message, or null on success. */
  signIn: (username: string, password: string) => string | null;
  signOut: () => void;
}

const DemoAuthContext = createContext<DemoAuthState | null>(null);

export function DemoAuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);

  const signIn = useCallback((username: string, password: string) => {
    const matches =
      username.trim().toLowerCase() === DEMO_CREDENTIALS.username &&
      password === DEMO_CREDENTIALS.password;

    if (!matches) return 'Incorrect username or password.';

    setSignedIn(true);
    return null;
  }, []);

  const signOut = useCallback(() => setSignedIn(false), []);

  return (
    <DemoAuthContext value={{ signedIn, signIn, signOut }}>
      {children}
    </DemoAuthContext>
  );
}

export function useDemoAuth() {
  const context = useContext(DemoAuthContext);
  if (!context) {
    throw new Error('useDemoAuth must be used inside <DemoAuthProvider>.');
  }
  return context;
}
