import 'server-only';

/**
 * Demo mode for the dashboard.
 *
 * Distinct from `isDemoMode()` in `demo/store.ts`, which asks a different
 * question — "can this process reach a real Firestore at all?" — and answers it
 * by looking for credentials. This one is an explicit switch that says "this
 * deployment is being shown to a room", and its only effect is to print the
 * sign-in credentials on the login screen.
 *
 * The two are independent on purpose: the demo we are giving reads and writes
 * the *live* project, so `isDemoMode()` is false throughout while this is true.
 */
export function demoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

/**
 * The identity to sign in with, taken from the same environment the sign-in
 * check reads.
 *
 * Derived rather than hard-coded, so the panel cannot drift from what actually
 * works — a printed credential that has gone stale is worse than no panel at
 * all, because it fails in front of an audience with an error that reads like
 * the product is broken.
 */
export function demoCredentials(): { email: string; passphrase: string } | null {
  const email = (process.env.CONSOLE_ALLOWLIST ?? '').split(',')[0]?.trim();
  const passphrase = process.env.CONSOLE_PASSPHRASE ?? '';
  if (!email || !passphrase) return null;
  return { email, passphrase };
}
