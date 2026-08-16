import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth/auth-provider';

/**
 * The root URL has no screen of its own — it decides where you land.
 * Without this file `/` matches nothing and falls through to +not-found.
 */
export default function Index() {
  const { user, loading } = useAuth();

  // Render nothing rather than redirecting to /login while the persisted
  // session is still resolving, or a returning user sees a login flash.
  if (loading) return null;

  return <Redirect href={user ? '/home' : '/login'} />;
}
