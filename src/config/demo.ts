/**
 * Demo credentials. This is a stand-in so the app can be shown end-to-end
 * before Firebase Auth is wired up.
 *
 * DELETE THIS FILE, and src/lib/auth/demo-auth.tsx with it, once real sign-in
 * lands. Credentials in the bundle are fine for a demo and unacceptable for
 * anything real — there is no server check here, only a string comparison.
 */
export const DEMO_CREDENTIALS = {
  username: 'demo@kgc.tech',
  password: 'kgc2026',
} as const;
