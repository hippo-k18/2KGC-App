import "server-only";

import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import type { UserDoc, WithId } from "@/types/models";

/**
 * Verifies the session cookie in Server Components, Server Actions and Route
 * Handlers. proxy.ts only checks that a cookie exists — this is the real check,
 * so call it anywhere the answer actually matters.
 */
export async function getCurrentUser() {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  try {
    // checkRevoked: a signed-out or disabled account fails immediately.
    return await adminAuth().verifySessionCookie(cookie, true);
  } catch {
    return null;
  }
}

export async function getCurrentProfile(): Promise<WithId<UserDoc> | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const snap = await adminDb().collection(COLLECTIONS.users).doc(user.uid).get();
  if (!snap.exists) return null;

  return { id: snap.id, ...snap.data() } as WithId<UserDoc>;
}

/** Use at the top of a protected Server Component. Throws if signed out. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated.");
  return user;
}
