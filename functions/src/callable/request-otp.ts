import { requestSignInCode } from '@kgc/scripts/src/lib/otp-core';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { callerIp } from '../lib/rate-limit.js';
import { OTP_REQUEST_CALLABLE } from '../runtime-options.js';

/**
 * HTTPS callable, no Firestore trigger — see functions/SPEC.md #9.
 *
 * ── This file is now a transport, and nothing else ─────────────────────────
 *
 * Every rule that used to be argued out here — the two rate limits and why the
 * per-IP cap is generous, where the send sits relative to the transaction, why
 * a failed send does not refund the tick, and above all the anti-enumeration
 * property — moved to `@kgc/scripts/src/lib/otp-core.ts`. Read that file; it is
 * the one that decides anything.
 *
 * The move was forced. `firebase deploy` for functions is refused on this
 * project with a missing `iam.serviceAccounts.ActAs` grant that only
 * `roles/owner` can give (OWNER-ACTIONS.md §3), so this callable has never run
 * in production and cannot until the owner acts. Sign-in could not wait on
 * that, so `apps/web` serves the same logic as a route handler at
 * `/api/auth/request-code`. Both call the same core.
 *
 * ⚠️ **Keep this file even though it is unreachable today.** The day the grant
 * lands, this is the deployment that gets an attendee's sign-in off the
 * website's request path and onto one with `maxInstances` on it. Deleting it
 * would mean rewriting it.
 *
 * ⚠️ PUBLIC AND UNAUTHENTICATED. APP CHECK IS NOT ENFORCED, AND THAT IS A
 * DECISION, NOT AN OVERSIGHT. App Check would be the right guard — it is the
 * one mechanism that proves a call came from a real build of the real app — but
 * the attendee app runs in Expo Go, and Expo Go cannot attest: App Attest and
 * Play Integrity need native modules only a development build carries, and the
 * JS SDK's reCAPTCHA providers need a browser DOM that React Native does not
 * have. Turning enforcement on today would return 401 to every real attendee
 * while costing an attacker nothing. The moment the development build lands —
 * which push and image upload both need anyway — register
 * `@react-native-firebase/app-check` and flip this to true on both callables.
 */
export const requestOtp = onCall<{ email?: unknown }>(OTP_REQUEST_CALLABLE, async (request) => {
  const result = await requestSignInCode(
    getFirestore(),
    String(request.data?.email ?? ''),
    callerIp(request.rawRequest),
  );

  if (result.ok) return { ok: true };

  // The two reachable failures, mapped to the codes `app/src/lib/auth/otp.ts`
  // already knows. Neither reveals anything about who holds a ticket:
  // `invalid-argument` means the address is malformed, which the caller can see
  // for themselves, and `resource-exhausted` is keyed on the caller.
  if (result.reason === 'invalid-argument') {
    throw new HttpsError('invalid-argument', 'A valid email address is required.');
  }
  throw new HttpsError(
    'resource-exhausted',
    'Too many code requests for this address. Try again later.',
  );
});
