import { Redirect } from 'expo-router';

import { useDemoAuth } from '@/lib/auth/demo-auth';

/**
 * The root URL has no screen of its own — it decides where you land.
 * Without this file `/` matches nothing and falls through to +not-found.
 *
 * The demo session is not persisted, so this sends you to /login on every
 * fresh launch.
 */
export default function Index() {
  const { signedIn } = useDemoAuth();

  return <Redirect href={signedIn ? '/home' : '/login'} />;
}
