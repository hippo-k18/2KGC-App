import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { checkCode, issueCode } from './access-code';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { TeamRole } from '@kgc/shared';
import { findMember, stampSignIn } from './team';
import { canExport, canOpen, canRunAction, homeFor } from './team-core';

/**
 * Console auth: an address, then a six-digit code emailed to it.
 *
 * ── Who gets in ─────────────────────────────────────────────────────────────
 *
 * Owners are the addresses in `CONSOLE_ALLOWLIST` (since 2026-09-26 the two
 * owner addresses, and nobody else), and they can do everything. Beside them
 * sits `teamMembers` in Firestore (`lib/team.ts`): people an owner added on
 * Attendees › Admin Settings, each with roles that limit what they can open.
 * Anyone else is told "Email not recognised" and no code is sent.
 *
 * Until 2026-09-26 this was an email plus a shared passphrase, with members on
 * passphrases of their own set through a one-time link. The owner replaced it
 * with codes, the same scheme as the blog editor. What that changes:
 *
 *  - **Each person proves they hold their own inbox**, so the audit actor is
 *    somebody who could actually sign in as that address, owners included.
 *  - **Nothing to leak or rotate.** There is no shared secret any more;
 *    `CONSOLE_PASSPHRASE` is ignored.
 *  - **The inbox is now the whole boundary.** Whoever controls an owner's
 *    email controls the dashboard, and the Admin SDK behind it bypasses
 *    `firestore.rules`.
 *
 * Removing an address from the allowlist, or a member from the team, ends that
 * person's live session on their next request: `accessFor()` re-checks both
 * every time rather than trusting the cookie.
 *
 * **Roles are enforced in one place, `requireOrganizer()`**, from the path the
 * request was made to — see `team-core.ts` for why the path, and for the map.
 * No page or action carries a role check of its own and none should grow one.
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
  // A changed epoch ends every session minted before it.
  if (!session.epoch || session.epoch !== member.sessionEpoch) return null;
  return { email: member.email, roles: member.roles };
});

const NOT_RECOGNISED = 'Email not recognised. Ask a KGC organizer to add you.';

/** May this address sign in? An owner in the allowlist, or a team member not removed. */
async function mayEnter(email: string): Promise<boolean> {
  if (isAllowed(email)) return true;
  const member = await findMember(email);
  return Boolean(member && member.roles.length > 0);
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

/**
 * Step one of signing in: mail a six-digit code, or say plainly that the
 * address has no access.
 *
 * ── Changed 2026-09-26, at the owner's request ──────────────────────────────
 *
 * This was an email and a shared passphrase, and a wrong address got the same
 * answer as a wrong passphrase so the form could not be used to learn who the
 * organizers are. The owner chose codes, the same as the blog editor, and a
 * plain "Email not recognised" over that secrecy. What a code gives that the
 * shared secret did not: each person proves they hold their own inbox, so the
 * audit actor is somebody who could actually sign in as that address.
 */
export async function requestSignInCode(raw: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) return { ok: false, error: 'Enter your email address.' };
  if (!(await mayEnter(email))) return { ok: false, error: NOT_RECOGNISED };
  if ((await issueCode(email, 'signin')) === 'failed') {
    return { ok: false, error: 'The email with your code could not be sent. Try again in a minute.' };
  }
  return { ok: true, email };
}

/** Step two: check the code and open a session. Returns the screen to land on. */
export async function signInWithCode(
  raw: string,
  code: string,
): Promise<{ ok: true; home: string } | { ok: false; error: string }> {
  const email = raw.trim().toLowerCase();
  if (!(await checkCode(email, 'signin', code)) || !(await mayEnter(email))) {
    return { ok: false, error: 'That code is not right, or it has expired.' };
  }
  if (isAllowed(email)) {
    await startSession({ email, expiresAt: Date.now() + SESSION_TTL_MS });
    return { ok: true, home: homeFor(['owner']) };
  }
  const member = (await findMember(email))!;
  await startSession({ email: member.email, expiresAt: Date.now() + SESSION_TTL_MS, epoch: member.sessionEpoch });
  await stampSignIn(member.id);
  return { ok: true, home: homeFor(member.roles) };
}

/**
 * Whether the confirm-with-a-code step is shown on the six screens that ask
 * for it. Always, now that every organizer signs in with a code; kept as a
 * function so those screens did not change.
 */
export function requirePassphrase(): boolean {
  return true;
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
 * A session lasts eight hours, which is right for editing an agenda and wrong
 * for sending money back: an unattended laptop at a registration desk is the
 * normal state of a conference. So a refund, an erasure and a mass send each
 * ask for a fresh code from the signed-in person's inbox (`sendConfirmCode`),
 * which a passer-by at the desk does not have.
 *
 * The argument is still named for the passphrase it replaced, and the six
 * forms still post it as `passphrase`, so `tests/parity/step-up-guard.test.ts`
 * keeps pinning the same actions.
 */
export async function reauthenticate(supplied: string): Promise<boolean> {
  const access = await currentAccess();
  if (!access) return false;
  return checkCode(access.email, 'confirm', supplied);
}

/** Mail the signed-in organizer a confirmation code. */
export async function sendConfirmCode(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const access = await currentAccess();
  if (!access) return { ok: false, error: 'You have been signed out. Sign in again.' };
  if ((await issueCode(access.email, 'confirm')) === 'failed') {
    return { ok: false, error: 'The email with your code could not be sent. Try again in a minute.' };
  }
  return { ok: true, email: access.email };
}
