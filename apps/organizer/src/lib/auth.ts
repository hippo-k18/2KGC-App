import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Console auth, v0.
 *
 * DECISIONS.md #5 is Google SSO with **enforced MFA**, an email allowlist and
 * 8h sessions. This file implements the allowlist and the 8h session; SSO is
 * not wired yet. The shape is chosen so that swapping it in is a change to one
 * function: `signIn()` is the only place that decides *whether* an email is
 * authentic. Today it takes the organizer's word for it (localhost only);
 * tomorrow it verifies a Google ID token and an `amr` claim containing `mfa`,
 * and everything downstream — the cookie, `requireOrganizer()`, the audit
 * actor — is unchanged.
 *
 * ⚠️ MFA IS REQUIRED BEFORE THIS IS EXPOSED ANYWHERE BEYOND LOCALHOST.
 * As written, knowing an allowlisted email address is sufficient to obtain full
 * Admin-SDK-backed write access to the event. That is acceptable for a tool
 * bound to 127.0.0.1 on one laptop during Phase 0 and is not acceptable for
 * anything reachable over a network. Do not deploy this file. The project is on
 * the Spark plan and this runs under `next dev`; if that ever changes, SSO +
 * MFA lands first.
 */

const COOKIE = 'kgc_console_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // DECISIONS.md #5: 8h sessions.

export interface ConsoleSession {
  email: string;
  expiresAt: number;
}

/**
 * `CONSOLE_ALLOWLIST` — comma-separated identities. Ten users; an env var is
 * the right size.
 *
 * Entries are normally email addresses, but a bare username like `demo` is
 * allowed so a demonstration does not require inventing a mailbox. Nothing
 * downstream parses this value — it is only compared and then recorded as the
 * audit actor — so the two forms cost nothing to support.
 */
export function allowlist(): string[] {
  return (process.env.CONSOLE_ALLOWLIST ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string): boolean {
  return allowlist().includes(email.trim().toLowerCase());
}

function secret(): string {
  const s = process.env.CONSOLE_SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'CONSOLE_SESSION_SECRET is missing or too short. Set at least 16 characters in ' +
        'apps/console/.env.local — it signs the session cookie, and an unsigned cookie ' +
        'is a text field that says "I am an organizer".',
    );
  }
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function encode(session: ConsoleSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function decode(token: string | undefined): ConsoleSession | null {
  if (!token) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;

  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as ConsoleSession;
    if (!session.email || session.expiresAt < Date.now()) return null;
    // Re-check the allowlist on every request, not just at sign-in: removing
    // someone from the env var must lock them out of a live session too.
    if (!isAllowed(session.email)) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * The single point at which an email becomes an authenticated identity.
 * Replace the body with Google ID-token verification + an MFA assertion check
 * and nothing else in the console needs to change.
 */
/**
 * A shared passphrase, required whenever one is configured.
 *
 * The allowlist alone is not a credential: an email address is public
 * information, so on a localhost-only tool it is a convenience and on a
 * reachable URL it is nothing at all. `CONSOLE_PASSPHRASE` closes that, and
 * `requirePassphrase()` makes it mandatory in production so that deploying
 * without one is a startup failure rather than a silent open door.
 *
 * This is not the shipping design — DECISIONS.md #5 is Google SSO with enforced
 * MFA, and a shared secret has no per-person revocation and no audit identity
 * beyond the email typed alongside it. It is the difference between "anyone who
 * knows an address" and "anyone who knows an address and a secret", which is
 * the difference that matters before this is reachable over a network.
 */
function passphrase(): string | undefined {
  const p = process.env.CONSOLE_PASSPHRASE;
  return p && p.length > 0 ? p : undefined;
}

/** True when a passphrase must be supplied — always, once off localhost. */
export function requirePassphrase(): boolean {
  return Boolean(passphrase()) || process.env.NODE_ENV === 'production';
}

/**
 * A short passphrase is fine for a demo and unacceptable against live data.
 *
 * `123` is a perfectly reasonable secret when the dashboard is showing invented
 * attendees — the whole point of that deployment is that strangers get in and
 * click around. It is not a reasonable secret in front of the Admin SDK on the
 * real project, where the same form guards the actual ticket list and bypasses
 * every security rule.
 *
 * So the test is not "is this the emulator" but **"can this process reach real
 * data"**, which is exactly the presence of a service-account credential. A
 * dashboard with no credential can read nothing whatever the passphrase is, so
 * a weak one costs nothing; the moment somebody sets FIREBASE_SERVICE_ACCOUNT
 * the same weak passphrase starts refusing every sign-in, without anyone having
 * to remember to tighten it. The dangerous configuration becomes unreachable by
 * accident rather than merely discouraged.
 */
const MIN_LIVE_PASSPHRASE = 12;

/** True when this process holds a credential that can read the real project. */
export function hasLiveCredentials(): boolean {
  if (process.env.FIRESTORE_EMULATOR_HOST) return false;
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT,
  );
}

function weakSecretAgainstLiveData(): boolean {
  if (!hasLiveCredentials()) return false;
  const p = passphrase();
  return Boolean(p) && p!.length < MIN_LIVE_PASSPHRASE;
}

/** Constant-time compare, so the form is not a timing oracle for the secret. */
function passphraseMatches(supplied: string): boolean {
  const expected = passphrase();
  if (!expected) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function signIn(
  email: string,
  supplied = '',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return { ok: false, error: 'Enter an email address.' };

  if (requirePassphrase()) {
    if (!passphrase()) {
      // Deploying to a public host without a secret is a configuration error,
      // and it must fail loudly at the door rather than let everybody in.
      return {
        ok: false,
        error: 'CONSOLE_PASSPHRASE is not set on the server. Sign-in is disabled.',
      };
    }
    if (weakSecretAgainstLiveData()) {
      return {
        ok: false,
        error:
          `CONSOLE_PASSPHRASE is shorter than ${MIN_LIVE_PASSPHRASE} characters and this ` +
          'dashboard holds live credentials. Short secrets may only guard demo data.',
      };
    }
    if (!passphraseMatches(supplied)) {
      return { ok: false, error: 'That email and password do not match.' };
    }
  }

  if (!isAllowed(normalised)) {
    // Deliberately the same message either way — a sign-in form should not be
    // an oracle for who the organizers are.
    return { ok: false, error: 'That email and password do not match.' };
  }

  const session: ConsoleSession = { email: normalised, expiresAt: Date.now() + SESSION_TTL_MS };
  const jar = await cookies();
  jar.set(COOKIE, encode(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function currentSession(): Promise<ConsoleSession | null> {
  const jar = await cookies();
  return decode(jar.get(COOKIE)?.value);
}

/** Every page and every server action starts here. Returns the audit actor. */
export async function requireOrganizer(): Promise<string> {
  const session = await currentSession();
  if (!session) redirect('/login');
  return session.email;
}
