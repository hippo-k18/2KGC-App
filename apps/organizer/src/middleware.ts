import { NextResponse, type NextRequest } from 'next/server';

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
 * is overwritten rather than trusted. This decides nothing itself: it holds no
 * secret and reads no cookie. Without it the guard refuses every role but
 * owner, which is the safe way for it to be missing.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, request.nextUrl.pathname);
  if (request.method === 'POST') headers.set(ACTION_HEADER, request.headers.get('next-action') ?? 'form');
  else headers.delete(ACTION_HEADER);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/|kgc/|favicon.ico).*)'],
};
