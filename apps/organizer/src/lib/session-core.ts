import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TeamRole } from '@kgc/shared';
import { sessionTtlMs } from './team-core';

/**
 * How long a dashboard sign-in lasts, and the signed cookie that carries it.
 *
 * Pure, so `session-core.test.ts` can pin the rules. `lib/auth.ts` mints and
 * judges sessions with it, and `src/middleware.ts` uses it to keep a remembered
 * one alive. Nothing here reads Firestore, a cookie jar or the environment.
 *
 * ── Changed 2026-10-21 (T312), at the owner's request ───────────────────────
 *
 * A session lasted eight hours (fourteen on the door), so the team typed an
 * emailed code almost every day. Now the code step has "Keep me signed in on
 * this device", ticked by default:
 *
 *  - **Ticked:** 30 days, rolling. A visit at least a day after the cookie was
 *    last renewed renews it for another 30 days, so only 30 days without a
 *    visit signs somebody out.
 *  - **Unticked:** a browser-session cookie (no `Max-Age`), so it ends when the
 *    browser closes, and the signed payload still expires after
 *    `sessionTtlMs()`: eight hours, or fourteen for the door crew (T259 #13).
 *
 * What a long session does not change: refunds, erasures and mass sends still
 * ask for a fresh emailed code (`reauthenticate()`), and the epoch in the
 * cookie is still checked on every request, so removing a member, bumping an
 * epoch or signing out on all devices ends a 30-day session at once.
 */

/** `lib/auth.ts` sets it, `src/middleware.ts` renews it. */
export const SESSION_COOKIE = 'kgc_console_session';

/** A remembered device stays signed in this long after its last renewal. */
export const KEEP_SIGNED_IN_MS = 30 * 24 * 60 * 60 * 1000;
/** A remembered session is renewed at most once a day, not on every request. */
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export interface ConsoleSession {
  email: string;
  expiresAt: number;
  /**
   * `TeamMemberDoc.sessionEpoch` for a member, or the owner's `ownerSessions`
   * epoch for an owner, as it stood at sign-in.
   */
  epoch?: string;
  /** "Keep me signed in" was ticked. Cookies minted before T312 have neither field. */
  keep?: boolean;
  /** When the session was minted or last renewed. */
  refreshedAt?: number;
}

/** The session a correct code opens. */
export function newSession(input: {
  email: string;
  epoch: string | undefined;
  roles: readonly TeamRole[];
  keep: boolean;
  now: number;
}): ConsoleSession {
  const ttl = input.keep ? KEEP_SIGNED_IN_MS : sessionTtlMs(input.roles);
  return {
    email: input.email,
    expiresAt: input.now + ttl,
    epoch: input.epoch,
    keep: input.keep,
    refreshedAt: input.now,
  };
}

/**
 * The renewed session, or null when this one should be left as it is: not
 * remembered, already expired, or renewed less than a day ago.
 */
export function refreshSession(session: ConsoleSession, now: number): ConsoleSession | null {
  if (!session.keep || session.expiresAt < now) return null;
  if (now - (session.refreshedAt ?? 0) < REFRESH_AFTER_MS) return null;
  return { ...session, expiresAt: now + KEEP_SIGNED_IN_MS, refreshedAt: now };
}

/**
 * The cookie's `Max-Age` in seconds. Undefined for a session that was not
 * remembered, which makes it a browser-session cookie.
 */
export function cookieMaxAge(session: ConsoleSession, now: number): number | undefined {
  if (!session.keep) return undefined;
  return Math.max(0, Math.round((session.expiresAt - now) / 1000));
}

/** The cookie options, the same for sign-in and renewal. */
export function cookieOptions(session: ConsoleSession, now: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: cookieMaxAge(session, now),
  };
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function encodeSession(secret: string, session: ConsoleSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

/** The session in a signed cookie, or null if it is forged, malformed or expired. */
export function decodeSession(secret: string, token: string | undefined, now: number): ConsoleSession | null {
  if (!token) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;

  const a = Buffer.from(mac);
  const b = Buffer.from(sign(secret, payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as ConsoleSession;
    if (!session.email || session.expiresAt < now) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * Who a valid cookie lets in, given what Firestore says right now. However long
 * the cookie has left, a member who is gone, inactive or roleless gets nothing,
 * and neither does anybody whose epoch has moved on since sign-in.
 */
export function judgeSession(
  session: ConsoleSession,
  now:
    | { owner: true; epoch: string | undefined }
    | {
        owner: false;
        member: { email: string; status: string; roles: TeamRole[]; sessionEpoch: string } | null;
      },
): { email: string; roles: TeamRole[] } | null {
  if (now.owner) {
    if (!session.epoch || session.epoch !== now.epoch) return null;
    return { email: session.email, roles: ['owner'] };
  }
  const member = now.member;
  if (!member || member.status !== 'active' || member.roles.length === 0) return null;
  if (!session.epoch || session.epoch !== member.sessionEpoch) return null;
  return { email: member.email, roles: member.roles };
}
