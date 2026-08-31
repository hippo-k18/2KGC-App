import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

import { getFirebaseAuth, getFirebaseFunctions } from '@/lib/firebase/client';

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
 * ── ⚠️ These functions are NOT DEPLOYED ─────────────────────────────────────
 *
 * `firebase deploy` is refused on this project with a `serviceusage` 403 and a
 * deploy script cannot work around it for functions (OWNER-ACTIONS.md §3). So
 * against the live project every call here fails with `not-found` — the callable
 * URL 404s — and the screen must say something an attendee can act on rather
 * than the SDK's word for it. This path has been exercised end to end against
 * the **functions emulator**; it is unverified against production.
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

/** The `functions/`-prefixed code on a `FunctionsError`, or `''`. */
function callableCode(e: unknown): string {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code.replace(/^functions\//, '') : '';
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

  try {
    const call = httpsCallable<{ email: string }, { ok: boolean }>(
      getFirebaseFunctions(),
      'requestOtp',
    );
    await call({ email: address });
    // The response is discarded on purpose. It is `{ ok: true }` and cannot be
    // anything else — reading it would suggest there is a second answer to
    // branch on, and the absence of one is the guarantee.
    return { ok: true };
  } catch (e) {
    switch (callableCode(e)) {
      case 'invalid-argument':
        // The server's only other verdict, and it is about syntax, not identity.
        return { ok: false, message: 'Enter a valid email address.' };
      case 'resource-exhausted':
        // Two limits share this branch deliberately: the server returns one
        // code and one message for the per-address cap and the per-IP cap,
        // because telling a caller which one they hit tells them how to shape
        // the next attempt. Do not try to distinguish them here.
        return {
          ok: false,
          message: 'Too many code requests. Wait a few minutes and try again.',
        };
      default:
        return { ok: false, message: UNREACHABLE };
    }
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

  try {
    const call = httpsCallable<{ email: string; code: string }, { token: string }>(
      getFirebaseFunctions(),
      'verifyOtp',
    );
    const { data } = await call({ email: address, code: digits });
    if (!data?.token) return { ok: false, message: UNREACHABLE };
    await signInWithCustomToken(getFirebaseAuth(), data.token);
    // No navigation here — `AuthProvider` flips and the login screen redirects.
    return { ok: true };
  } catch (e) {
    switch (callableCode(e)) {
      case 'invalid-argument':
        // Wrong code, or a malformed one. The server does not say how many
        // guesses are left and neither does this: five is the cap, and counting
        // down out loud is a hint about a six-digit secret.
        return { ok: false, message: 'That code is not right. Check the digits and try again.' };
      case 'failed-precondition':
        // `no-code` and `expired` both land here, and both have the same fix.
        return {
          ok: false,
          message: 'That code has expired or has already been used. Send a new one.',
        };
      case 'resource-exhausted':
        // Attempts exhausted, or the per-IP cap. One message, same reason as above.
        return { ok: false, message: 'Too many attempts. Send a new code and try again shortly.' };
      case 'permission-denied':
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
}
