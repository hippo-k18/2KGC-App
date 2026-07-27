import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { AUTH_ROUTES, PUBLIC_ROUTES } from "@/config/event";

/**
 * Next 16 renamed Middleware to Proxy; the behaviour is unchanged.
 *
 * This is an *optimistic* check — it only looks for the presence of a session
 * cookie, because verifying it needs the Admin SDK. Real verification happens in
 * `getCurrentUser()` and in firestore.rules. Do not treat this as the security
 * boundary.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  const isPublic = (PUBLIC_ROUTES as readonly string[]).includes(pathname);
  const isAuthRoute = (AUTH_ROUTES as readonly string[]).includes(pathname);

  if (!hasSession && !isPublic) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (hasSession && isAuthRoute) {
    return NextResponse.redirect(new URL("/agenda", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets, the auth API, and the push service worker.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|firebase-messaging-sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
