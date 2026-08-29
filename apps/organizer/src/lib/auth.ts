import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Console auth: an email allowlist plus a shared passphrase.
 *
 * **This is the design, not a staging post.** Earlier revisions of this file
 * described itself as "v0" and promised Google SSO with enforced MFA. That was
 * decided against on 2026-08-28: KGC runs one event with a handful of
 * organizers, and an SSO integration adds an identity provider, a consent
 * screen and a second failure mode to a tool that four people sign into.
 *
 * What that costs, stated plainly rather than left implied:
 *
 *  - **No MFA.** The passphrase is the only factor. Length is enforced against
 *    live data (`MIN_LIVE_PASSPHRASE`), which is what stands in for it.
 *  - **No per-person audit identity.** The recorded actor is the address typed
 *    beside the shared secret, so the audit log tells you which organizer
 *    *claimed* to act, not which one did.
 *  - **Revocation runs through the environment.** Removing an address from
 *    `CONSOLE_ALLOWLIST` does end that person's live session — `decode()`
 *    re-checks the list on every request rather than trusting the cookie — but
 *    the change only takes effect once the process picks up the new value,
 *    which on Netlify means a redeploy.
 *
 * The shape is still worth keeping: `signIn()` is the only place that decides
 * *whether* an email is authentic, so if that decision is ever revisited it is
 * one function, not a rewrite.
 *
 * ⚠️ The Admin SDK behind this bypasses `firestore.rules` entirely. The
 * passphrase is the whole boundary, so it must be long, it must not be shared
 * outside the organizer team, and the dashboard URL should be treated as a
 * second secret. `requirePassphrase()` makes a missing one a startup failure in
 * production, so the dangerous configuration fails closed rather than silently
 * opening the door.
 */

const COOKIE = 'kgc_console_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // One working day at a registration desk.

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
        'apps/organizer/.env.local — it signs the session cookie, and an unsigned cookie ' +
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
 * Everything downstream — the cookie, `requireOrganizer()`, the audit actor —
 * reads the result and not the method, so a different method stays a change to
 * this one function.
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
 * It is the difference between "anyone who knows an address" and "anyone who
 * knows an address and a secret", which is the difference that matters once
 * this is reachable over a network. What it does not give you is an audit
 * identity stronger than the address typed alongside it — see the file header.
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

/**
 * Prove it is still you, for an action that cannot be undone.
 *
 * A session cookie lasts eight hours, which is right for editing an agenda and
 * wrong for sending money back. An unattended laptop at a registration desk is
 * the normal state of a conference, not an edge case, and "refund" sitting one
 * click away behind an eight-hour session is an accident waiting for a passer-by.
 *
 * So the refund action asks for the passphrase again. This is genuinely weak —
 * it is a shared secret, and anyone who can sign in at all knows it — but it
 * raises the bar from *a stray click* to *a deliberate act*, which is the
 * specific failure being defended against here. If the sign-in method is ever
 * revisited this becomes a step-up assertion and the call sites do not change.
 *
 * Returns true when no passphrase is configured at all, which is only possible
 * on localhost: `requirePassphrase()` makes one mandatory in production, so a
 * deployment cannot reach this and get a free pass.
 */
export function reauthenticate(supplied: string): boolean {
  if (!requirePassphrase()) return true;
  return passphraseMatches(supplied);
}
