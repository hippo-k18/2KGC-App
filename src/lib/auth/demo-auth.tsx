import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { DEMO_CREDENTIALS } from '@/config/demo';

/**
 * Placeholder sign-in for the demo build. It compares against hard-coded
 * credentials and remembers the result in AsyncStorage — no server, no
 * verification, no security.
 *
 * Replace with the Firebase flow in src/lib/auth/auth-provider.tsx when real
 * auth lands, then delete this file and src/config/demo.ts.
 */

const STORAGE_KEY = 'kgc:demoSignedIn';

interface DemoAuthState {
  signedIn: boolean;
  /** True until the stored session has been read back. */
  loading: boolean;
  /** Resolves to an error message, or null on success. */
  signIn: (username: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const DemoAuthContext = createContext<DemoAuthState | null>(null);

export function DemoAuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore the previous session so Fast Refresh does not sign you out.
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => setSignedIn(value === 'true'))
      .catch(() => setSignedIn(false))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const matches =
      username.trim().toLowerCase() === DEMO_CREDENTIALS.username &&
      password === DEMO_CREDENTIALS.password;

    if (!matches) return 'Incorrect username or password.';

    await AsyncStorage.setItem(STORAGE_KEY, 'true');
    setSignedIn(true);
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setSignedIn(false);
  }, []);

  return (
    <DemoAuthContext value={{ signedIn, loading, signIn, signOut }}>
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
