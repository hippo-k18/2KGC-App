import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/** Firebase caps session cookies at 14 days. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Exchanges a freshly-minted ID token for an httpOnly session cookie.
 *
 * This is also where registration gating happens: an address that is not in the
 * imported ticket list never gets a session, so it can never pass proxy.ts.
 */
export async function POST(request: Request) {
  const { idToken } = (await request.json()) as { idToken?: string };
  if (!idToken) {
    return NextResponse.json({ error: "Missing idToken." }, { status: 400 });
  }

  // Resolved outside the try so a missing-credentials error surfaces as a 500
  // rather than being swallowed and reported as an invalid token.
  const auth = adminAuth();

  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json({ error: "Invalid token." }, { status: 401 });
  }

  const email = decoded.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Token has no email." }, { status: 401 });
  }

  const registration = await adminDb()
    .collection(COLLECTIONS.registrations)
    .doc(email)
    .get();

  if (!registration.exists) {
    // Not a ticket holder — revoke so the client session cannot be reused.
    await auth.revokeRefreshTokens(decoded.uid);
    return NextResponse.json(
      { error: "That address is not on the attendee list." },
      { status: 403 },
    );
  }

  await registration.ref.update({ claimedByUid: decoded.uid });

  // Create the profile on first sign-in; /onboarding fills in the rest.
  const userRef = adminDb().collection(COLLECTIONS.users).doc(decoded.uid);
  if (!(await userRef.get()).exists) {
    await userRef.set({
      email,
      name: registration.data()?.name ?? "",
      interests: [],
      onboarded: false,
      visibleInDirectory: true,
      notificationPrefs: {
        announcements: true,
        messages: true,
        sessionReminders: true,
      },
      role: "attendee",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const sessionCookie = await auth.createSessionCookie(idToken, {
    expiresIn: MAX_AGE_MS,
  });

  (await cookies()).set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_MS / 1000,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
