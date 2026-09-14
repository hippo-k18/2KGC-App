import { signInWithCustomToken } from 'firebase/auth';

import { getFirebaseAuth } from '@/lib/firebase/client';

/**
 * The client half of the six-digit sign-in code.
 *
 * The server half is `functions/src/callable/request-otp.ts` and
 * `verify-otp.ts`; everything below exists to match their contract exactly,
 * including which error codes they throw and — more importantly — which
 * distinctions they refuse to make. This module is deliberately the only place
 * in the app that knows those codes, so the screen cannot invent a fifth
 * outcome the server never returns.
 *
 * ── ⚠️ The property this file must not break ────────────────────────────────
 *
 * `requestOtp` answers `{ ok: true }` for **every syntactically valid address**
 * — ticket holder or stranger, real mailbox or typo, delivered or bounced. That
 * is an anti-enumeration property with a test pinning it
 * (`tests/functions/requestOtp.test.ts`, "does not reveal who holds a ticket"),
 * and it is worth what it costs: an endpoint whose answer varies with whether an
 * address is on the guest list turns "send me a code" into a query against a
 * $1,199-a-seat delegate list.
 *
 * A UI can undo that without touching the server. Three ways, all of them
 * closed here and none of them to be reopened:
 *
 *   1. Different copy for a "known" and an "unknown" address. There is no such
 *      distinction to render — this module cannot tell them apart and must not
 *      appear to.
 *   2. A different destination. The screen after "send me a code" is the code
 *      screen, always, for every address that passed `EMAIL_SHAPE`.
 *   3. A different *shape* of failure. `invalid-argument` from `requestOtp`
 *      means the address is malformed, never that it is unknown — so the one
 *      thing a caller can learn is whether they typed an `@`, which they can
 *      see for themselves.
 *
 * Ticket status is checked exactly once, in `verifyOtp`, *after* the caller has
 * proved they read the mailbox. That is why `permission-denied` below is
 * allowed to be specific where nothing above it is: by then the answer is about
 * an address its owner controls, so telling them plainly that it holds no ticket
 * costs no enumeration and saves a support conversation.
 *
 * ── ★ This no longer calls a Cloud Function ─────────────────────────────────
 *
 * It did, and for months that meant it did not work at all: deploying a
 * function on this project needs `iam.serviceAccounts.ActAs` on the App Engine
 * default service account, only `roles/owner` can grant it, and the owner has
 * not (OWNER-ACTIONS.md §3). Every call 404'd.
 *
 * The endpoints now also live on the marketing site — `apps/web`, at
 * `/api/auth/request-code` and `/api/auth/verify-code` — which deploys with no
 * grant required and already holds the Admin SDK credential and the Resend key.
 * `@kgc/scripts/src/lib/otp-core.ts` is the single implementation both hosts
 * call, so the rules, the rate limits and the error tags are unchanged; only
 * the transport below is different. `functions/src/callable/` is kept for the
 * day the grant lands.
 *
 * ⚠️ The site must be reachable from wherever the app is running, which is a
 * new failure this file did not previously have. `EXPO_PUBLIC_SITE_ORIGIN`
 * points at it; the default is the deployed site.
 */

/**
 * Byte-for-byte the server's own `EMAIL_SHAPE`, in both callables.
 *
 * Duplicated rather than shared because it cannot go in `@kgc/shared` — that
 * package is bundled into this app *and* into the functions, so a copy here is
 * cheap, and the only failure mode of drift is a request the server rejects
 * with the same message this file would have shown. It is a keyboard check, not
 * a validity claim: no regex knows whether a mailbox exists, and this one is
 * deliberately loose enough not to refuse an address a person actually holds.
 */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `verifyOtp`'s `CODE_SHAPE` — exactly six digits, nothing else. */
export const CODE_SHAPE = /^\d{6}$/;
export const CODE_LENGTH = 6;

/** `request-otp.ts`'s `CODE_TTL_MINUTES`. Printed on the screen, so it must match. */
export const CODE_TTL_MINUTES = 10;

export type OtpResult = { ok: true } | { ok: false; message: string };

/**
 * Where the two sign-in endpoints live.
 *
 * ── They are not Cloud Functions any more ──────────────────────────────────
 *
 * They were, and `functions/src/callable/` still holds them — but deploying a
 * function on this project needs `iam.serviceAccounts.ActAs`, only
 * `roles/owner` can grant it, and nobody has (OWNER-ACTIONS.md §3). So the
 * callable 404s and always has. The same logic now also runs as two route
 * handlers on the marketing site, which does deploy, and this file calls those.
 *
 * Both hosts share one implementation in `@kgc/scripts/src/lib/otp-core.ts`,
 * so the error tags below are the same ones the callable returned. Nothing
 * about the contract changed except the URL.
 *
 * The default is the deployed site, because a build with no `.env.local` is far
 * more likely to be a phone in a conference hall than a laptop running Next on
 * :3200 — and the failure of getting that backwards is silent in exactly the
 * situation where nobody can fix it.
 */
/*
 * ⚠️ Corrected from `kgc-2027-website.netlify.app` on 2026-09-14. That is an
 * abandoned deploy on a different Netlify account, and because this is the
 * fallback for a build with no `.env.local` — the phone-in-a-hall case the
 * comment above is about — the wrong value would have sent every sign-in
 * request to a site that has no current code, silently, at the one moment
 * nobody can fix it.
 */
const SITE_ORIGIN = (
  process.env.EXPO_PUBLIC_SITE_ORIGIN ?? 'https://kgc27-website.netlify.app'
).replace(/\/+$/, '');

/**
 * One POST, and a discriminated answer.
 *
 * Returns the server's `error` tag on a non-2xx, `'ok'` with the parsed body on
 * success, and `'unreachable'` for anything that never became an HTTP response
 * — DNS, a dropped connection, a body that is not JSON. That last case must
 * stay distinct from a server verdict: "we could not ask" and "the server said
 * no" need different words on screen, and collapsing them is how a screen ends
 * up claiming a code was sent when the request never landed.
 */
async function post<T>(
  path: string,
  body: Record<string, string>,
): Promise<{ ok: true; data: T } | { ok: false; tag: string }> {
  let res: Response;
  try {
    res = await fetch(`${SITE_ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, tag: 'unreachable' };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, tag: 'unreachable' };
  }

  if (!res.ok) {
    const tag = (parsed as { error?: unknown })?.error;
    return { ok: false, tag: typeof tag === 'string' ? tag : 'unreachable' };
  }
  return { ok: true, data: parsed as T };
}

/**
 * The one message for every way the callable failed to answer.
 *
 * `internal` is what the SDK throws for a failed fetch as well as for a real
 * server-side crash, and `not-found` is what a 404 on an undeployed function
 * looks like — so these cannot be told apart from here, and pretending
 * otherwise would produce advice that is wrong half the time. What *is* true in
 * all of them, and is the only part an attendee needs, is that nothing was sent
 * and nobody was signed in. Saying that is the whole point: a screen that
 * reports "we've emailed you a code" when the request never landed is the
 * failure this repo has documented fourteen instances of.
 */
const UNREACHABLE = 'Could not reach the sign-in service, so no code was sent. Try again in a moment.';

export async function requestSignInCode(email: string): Promise<OtpResult> {
  const address = email.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(address)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }

  const res = await post<{ ok: boolean }>('/api/auth/request-code', { email: address });
  // The success body is discarded on purpose. It is `{ ok: true }` and cannot
  // be anything else — reading it would suggest there is a second answer to
  // branch on, and the absence of one is the guarantee.
  if (res.ok) return { ok: true };

  switch (res.tag) {
    case 'invalid-argument':
      // The server's only other verdict, and it is about syntax, not identity.
      return { ok: false, message: 'Enter a valid email address.' };
    case 'resource-exhausted':
      // Two limits share this branch deliberately: the server returns one tag
      // for the per-address cap and the per-IP cap, because telling a caller
      // which one they hit tells them how to shape the next attempt. Do not
      // try to distinguish them here.
      return { ok: false, message: 'Too many code requests. Wait a few minutes and try again.' };
    default:
      return { ok: false, message: UNREACHABLE };
  }
}

/**
 * Redeem a code and sign in.
 *
 * `verifyOtp` mints the Auth account on first success and returns a custom
 * token; `signInWithCustomToken` is what turns that into a session. The
 * `registered` and `roles` claims are already on the user record by then, so
 * the ID token this produces carries them and `firestore.rules` admits the
 * attendee on the first read — no refresh, no second round trip.
 */
export async function signInWithCode(email: string, code: string): Promise<OtpResult> {
  const address = email.trim().toLowerCase();
  const digits = code.trim();
  if (!EMAIL_SHAPE.test(address) || !CODE_SHAPE.test(digits)) {
    return { ok: false, message: `Enter the ${CODE_LENGTH}-digit code from the email.` };
  }

  const res = await post<{ token?: string }>('/api/auth/verify-code', {
    email: address,
    code: digits,
  });

  if (res.ok) {
    if (!res.data?.token) return { ok: false, message: UNREACHABLE };
    await signInWithCustomToken(getFirebaseAuth(), res.data.token);
    // No navigation here — `AuthProvider` flips and the login screen redirects.
    return { ok: true };
  }

  switch (res.tag) {
    case 'wrong-code':
    case 'invalid-argument':
      // Wrong code, or a malformed one. The server does not say how many
      // guesses are left and neither does this: five is the cap, and counting
      // down out loud is a hint about a six-digit secret.
      return { ok: false, message: 'That code is not right. Check the digits and try again.' };
    case 'no-code':
    case 'expired':
      // Both have the same fix, so they get the same sentence.
      return {
        ok: false,
        message: 'That code has expired or has already been used. Send a new one.',
      };
    case 'exhausted':
    case 'resource-exhausted':
      // Attempts exhausted, or the per-IP cap. One message, same reason as above.
      return { ok: false, message: 'Too many attempts. Send a new code and try again shortly.' };
    case 'no-registration':
      // The only place ticket status is ever disclosed, and it is safe here:
      // the caller has just proved they read this mailbox. See the header.
      return {
        ok: false,
        message:
          'That address has no active ticket for this event. If you bought one under a ' +
          'different address, try that one.',
      };
    default:
      return { ok: false, message: 'Could not reach the sign-in service. You are not signed in.' };
  }
}
