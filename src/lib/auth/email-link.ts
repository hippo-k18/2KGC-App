import {
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/client";

/**
 * Email-link ("magic link") sign-in — no passwords, matching the plan's
 * email-only requirement. Access is still gated: a user only reaches the app
 * if their address exists in the imported `registrations` collection.
 */

const EMAIL_KEY = "kgc:pendingEmail";

export async function sendLoginLink(email: string) {
  await sendSignInLinkToEmail(getFirebaseAuth(), email, {
    url: `${window.location.origin}/login`,
    handleCodeInApp: true,
  });
  // The link may open in a different tab; remember who asked for it.
  window.localStorage.setItem(EMAIL_KEY, email);
}

export function isLoginLink(href: string) {
  return isSignInWithEmailLink(getFirebaseAuth(), href);
}

/**
 * Completes sign-in from the emailed link, then exchanges the ID token for an
 * httpOnly session cookie so the server (and proxy.ts) can see the session too.
 */
export async function completeLogin(href: string, fallbackEmail?: string) {
  const email = window.localStorage.getItem(EMAIL_KEY) ?? fallbackEmail;
  if (!email) {
    throw new Error("Enter the email address the sign-in link was sent to.");
  }

  const auth = getFirebaseAuth();
  const credential = await signInWithEmailLink(auth, email, href);
  window.localStorage.removeItem(EMAIL_KEY);

  const idToken = await credential.user.getIdToken();
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    await auth.signOut();
    throw new Error((await res.json().catch(() => null))?.error ?? "Sign-in failed.");
  }

  return credential.user;
}

export async function logout() {
  await fetch("/api/auth/session", { method: "DELETE" });
  await getFirebaseAuth().signOut();
}
