import { Redirect } from 'expo-router';

/**
 * The root URL has no screen of its own — the app opens on the Agenda tab.
 * Without this file `/` matches nothing and falls through to +not-found.
 *
 * When auth is wired up this is the place to branch: signed-out users to
 * /login, users who have not finished onboarding to /onboarding.
 */
export default function Index() {
  return <Redirect href="/agenda" />;
}
