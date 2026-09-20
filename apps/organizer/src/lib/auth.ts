import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { TeamRole } from '@kgc/shared';
import { checkMemberPassphrase, findMember, stampSignIn } from './team';
import { canExport, canOpen, canRunAction, homeFor } from './team-core';

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
 * ── Team members, added 2026-09-20 ──────────────────────────────────────────
 *
 * The allowlist above is unchanged and its addresses are owners. Beside it sits
 * `teamMembers` in Firestore (`lib/team.ts`): people an owner invited from
 * Attendees › Admin Settings, each with roles that limit what they can open and
 * a passphrase of their own, stored as a scrypt hash and chosen through a
 * one-time link. For them the three costs above change: the audit actor is an
 * address only that person can sign in as, and revocation is a deleted
 * document, felt on their next request with no redeploy.
 *
 * **Roles are enforced in one place, `requireOrganizer()`**, from the path the
 * request was made to — see `team-core.ts` for why the path, and for the map.
 * No page or action carries a role check of its own and none should grow one.
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
  /** Team members only: `TeamMemberDoc.sessionEpoch` as it stood at sign-in. */
  epoch?: string;
}

/** Who is asking, and what they hold. An allowlisted address is an owner. */
export interface ConsoleAccess {
  email: string;
  roles: TeamRole[];
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
        'apps/organizer/.env.local. It signs the session cookie, and an unsigned cookie ' +
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
    return session;
  } catch {
    return null;
  }
}

/**
 * What a signed cookie is worth right now.
 *
 * Re-checked on every request, not just at sign-in: removing someone from the
 * env var, or from the team, must lock them out of a live session too. For a
 * member that is one document read by id, and `cache()` keeps it to one per
 * request however many times the layout, the page and an action ask.
 */
const accessFor = cache(async (token: string | undefined): Promise<ConsoleAccess | null> => {
  const session = decode(token);
  if (!session) return null;
  if (isAllowed(session.email)) return { email: session.email, roles: ['owner'] };

  const member = await findMember(session.email);
  if (!member || member.status !== 'active' || member.roles.length === 0) return null;
  // A new set-passphrase link rotates the epoch, which ends every older session.
  if (!session.epoch || session.epoch !== member.sessionEpoch) return null;
  return { email: member.email, roles: member.roles };
});

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
 *
 * ⚠️ **Lowered from 12 to 7 on 2026-08-31 at the owner's request**, so that
 * `kgc2027` is accepted against the live project. The guard still exists — it
 * still refuses `123` — but at seven characters it no longer stands in for MFA
 * in the way the paragraph above describes. What now carries the boundary is
 * the allowlist being one address and the dashboard URL being unadvertised.
 * Raise this again, and rotate the secret, before the event runs on real
 * attendees. `DEPLOY-NETLIFY.md` records the same warning next to the deploy.
 */
const MIN_LIVE_PASSPHRASE = 7;

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

async function startSession(session: ConsoleSession): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, encode(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

const NO_MATCH = 'That email and password do not match.';

export async function signIn(
  email: string,
  supplied = '',
): Promise<{ ok: true; home: string } | { ok: false; error: string }> {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return { ok: false, error: 'Enter an email address.' };

  // An invited member, on their own passphrase. The allowlist is asked first
  // and wins, so an address in both places is an owner on the shared secret and
  // a stale team document can never narrow or widen what an owner holds.
  if (!isAllowed(normalised)) {
    const member = await checkMemberPassphrase(normalised, supplied);
    if (!member || member.roles.length === 0) return { ok: false, error: NO_MATCH };
    await startSession({
      email: member.email,
      expiresAt: Date.now() + SESSION_TTL_MS,
      epoch: member.sessionEpoch,
    });
    await stampSignIn(member.id);
    return { ok: true, home: homeFor(member.roles) };
  }

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
    // Deliberately the same message as an unknown address — a sign-in form
    // should not be an oracle for who the organizers are.
    if (!passphraseMatches(supplied)) return { ok: false, error: NO_MATCH };
  }

  await startSession({ email: normalised, expiresAt: Date.now() + SESSION_TTL_MS });
  return { ok: true, home: homeFor(['owner']) };
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Who is signed in and what they hold, or null. Never redirects. */
export async function currentAccess(): Promise<ConsoleAccess | null> {
  const jar = await cookies();
  return accessFor(jar.get(COOKIE)?.value);
}

export async function currentSession(): Promise<ConsoleSession | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  return (await accessFor(token)) ? decode(token) : null;
}

/** Set by `src/middleware.ts` on every request. The same literals live there. */
const PATH_HEADER = 'x-kgc-path';
const ACTION_HEADER = 'x-kgc-action';

/**
 * The page bundles that import a server action, from Next's own manifest.
 *
 * ⚠️ This reads a Next internal: the manifest singleton `app-render` keeps on
 * `globalThis`, checked against next@15.5. There is no public way to ask which
 * screens an action belongs to, and the alternative was a role argument typed
 * into two hundred actions. If an upgrade moves it, this returns nothing, every
 * action is refused to every role but owner, and the desk says so at once —
 * loud and closed, never quiet and open.
 */
function bundlesImporting(actionId: string): string[] {
  const singleton = (globalThis as Record<symbol, unknown>)[
    Symbol.for('next.server.action-manifests')
  ] as
    | { serverActionsManifest?: { node?: Record<string, { workers?: Record<string, unknown> }> } }
    | undefined;
  return Object.keys(singleton?.serverActionsManifest?.node?.[actionId]?.workers ?? {});
}

/**
 * Every page and every server action starts here, and **this is the role
 * guard**. Returns who is asking and what they hold.
 *
 * Three questions, in order: is there a live session; may its roles open the
 * path this request was made to; and, when the request carries a server
 * action, may they open a screen that action belongs to. The third is not
 * implied by the second. Next runs an action id wherever it is posted —
 * verified on 2026-09-20 by posting this file's neighbours at the check-in
 * screen — so without it a check-in account reaches the refund action by
 * posting its id at a URL it is allowed to open.
 *
 * ⚠️ With no path to judge — the middleware did not run — every role but owner
 * is refused with an error rather than a redirect. Home would be refused for
 * the same reason, and a redirect to it would loop.
 */
export async function requireAccess(): Promise<ConsoleAccess> {
  const access = await currentAccess();
  if (!access) redirect('/login');
  if (access.roles.includes('owner')) return access;

  const h = await headers();
  const path = h.get(PATH_HEADER);
  if (path === null) {
    throw new Error('This request did not say which screen it was for, so it was refused.');
  }
  if (!canOpen(access.roles, path)) redirect(homeFor(access.roles));

  const action = h.get(ACTION_HEADER);
  if (action !== null) {
    // `form` is a POST that did not name its action in a header. The id is in a
    // body this function cannot read, so it cannot be checked, so it is refused.
    const known = action === 'form' ? [] : bundlesImporting(action);
    if (!canRunAction(access.roles, known)) redirect(homeFor(access.roles));
  }
  return access;
}

/** `requireAccess()` for the two hundred callers that want only the audit actor. */
export async function requireOrganizer(): Promise<string> {
  return (await requireAccess()).email;
}

/**
 * For the screen that decides who else gets in. The path rule already keeps
 * Admin Settings to owners; this says so a second time, by role, so that moving
 * the screen in `nav.ts` could not quietly hand the team list to somebody else.
 */
export async function requireOwner(): Promise<string> {
  const access = await requireAccess();
  if (!access.roles.includes('owner')) redirect(homeFor(access.roles));
  return access.email;
}

/**
 * The same guard for `/export/{kind}`, which answers with a status rather than
 * a redirect because the caller asked for a file.
 */
export async function exportAccess(kind: string): Promise<'ok' | 'signed-out' | 'forbidden'> {
  const access = await currentAccess();
  if (!access) return 'signed-out';
  return canExport(access.roles, kind) ? 'ok' : 'forbidden';
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
export async function reauthenticate(supplied: string): Promise<boolean> {
  const access = await currentAccess();
  if (!access) return false;
  // A team member proves it with their own passphrase, never the shared one:
  // they were not given it, and the point of the step is that it is still them.
  if (!isAllowed(access.email)) {
    return Boolean(await checkMemberPassphrase(access.email, supplied));
  }
  if (!requirePassphrase()) return true;
  return passphraseMatches(supplied);
}
