import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, cookieOptions, decodeSession, encodeSession, refreshSession } from './lib/session-core';

/** The same literals are read in `lib/auth.ts`. Change both or neither. */
const PATH_HEADER = 'x-kgc-path';
const ACTION_HEADER = 'x-kgc-action';

/**
 * Tells the role guard which screen a request is for.
 *
 * `requireOrganizer()` in `lib/auth.ts` decides access from the path, and a
 * server component has no other way to learn it.
 *
 * It also says what kind of POST this is. A server action pressed in a browser
 * names itself in the `next-action` header, and the guard checks that id. One
 * posted as a plain form names itself only inside the body, which the guard
 * cannot read, so that case is marked `form` and refused to every role but
 * owner rather than waved through unchecked.
 *
 * `set` rather than `append`, so a value the browser sent under the same name
 * is overwritten rather than trusted. This decides nothing itself: the only
 * cookie it reads is the session, to renew it (`renew()` below). Without it the guard refuses every role but
 * owner, which is the safe way for it to be missing.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, request.nextUrl.pathname);
  if (request.method === 'POST') headers.set(ACTION_HEADER, request.headers.get('next-action') ?? 'form');
  else headers.delete(ACTION_HEADER);
  const response = NextResponse.next({ request: { headers } });
  renew(request, response);
  return response;
}

/**
 * Keeps a "Keep me signed in" session rolling (T312): a visit at least a day
 * after the last renewal re-issues the cookie for another 30 days.
 *
 * This only checks the signature. Whether the person may still get in is
 * decided per request in `lib/auth.ts`, so renewing the cookie of somebody who
 * has just been removed hands them nothing: the epoch check still refuses it.
 * Done here because a page render cannot set a cookie.
 */
function renew(request: NextRequest, response: NextResponse) {
  const secret = process.env.CONSOLE_SESSION_SECRET;
  if (!secret || secret.length < 16) return;
  const now = Date.now();
  const session = decodeSession(secret, request.cookies.get(SESSION_COOKIE)?.value, now);
  const renewed = session && refreshSession(session, now);
  if (renewed) response.cookies.set(SESSION_COOKIE, encodeSession(secret, renewed), cookieOptions(renewed, now));
}

export const config = {
  // Node rather than Edge, so the cookie is signed by the same `node:crypto`
  // code as at sign-in.
  runtime: 'nodejs',
  matcher: ['/((?!_next/|kgc/|favicon.ico).*)'],
};
