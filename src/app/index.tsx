import { Redirect } from 'expo-router';

import { useDemoAuth } from '@/lib/auth/demo-auth';

/**
 * The root URL has no screen of its own — it decides where you land.
 * Without this file `/` matches nothing and falls through to +not-found.
 */
export default function Index() {
  const { signedIn, loading } = useDemoAuth();

  // Render nothing until the stored session has been read, so we never
  // flash the login screen at someone who is already signed in.
  if (loading) return null;

  return <Redirect href={signedIn ? '/home' : '/login'} />;
}
