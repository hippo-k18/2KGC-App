import { verifySignInCode } from '@kgc/scripts/src/lib/otp-core';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { callerIp } from '../lib/rate-limit.js';
import { PUBLIC_CALLABLE } from '../runtime-options.js';

/**
 * HTTPS callable, no Firestore trigger — see functions/SPEC.md #10.
 *
 * ── This file is now a transport, and nothing else ─────────────────────────
 *
 * The brute-force cap and why it is a separate question from expiry, why the
 * transaction can only *read* its own failure, and the whole of the claims
 * policy — all of it moved to `@kgc/scripts/src/lib/otp-core.ts`, so that the
 * `apps/web` route handler at `/api/auth/verify-code` enforces the identical
 * rules. See `request-otp.ts` beside this file for why there are two hosts.
 *
 * ⚠️ PUBLIC AND UNAUTHENTICATED, like `requestOtp`, and the more attractive
 * target of the two: a successful call mints an Auth account and returns a
 * custom token.
 */
export const verifyOtp = onCall<{ email?: unknown; code?: unknown }>(
  PUBLIC_CALLABLE,
  async (request) => {
    const result = await verifySignInCode(
      getFirestore(),
      getAuth(),
      String(request.data?.email ?? ''),
      String(request.data?.code ?? ''),
      callerIp(request.rawRequest),
    );

    if (result.ok) return { token: result.token };

    // One place that turns a core outcome into this transport's vocabulary.
    // The codes are the ones `app/src/lib/auth/otp.ts` already knows, and the
    // route handler maps the same tags to the same strings.
    switch (result.reason) {
      case 'invalid-argument':
        throw new HttpsError('invalid-argument', 'A valid email and 6-digit code are required.');
      case 'wrong-code':
        throw new HttpsError('invalid-argument', 'Incorrect code.');
      case 'no-code':
        throw new HttpsError('failed-precondition', 'No active code for this email. Request a new one.');
      case 'expired':
        throw new HttpsError('failed-precondition', 'This code has expired. Request a new one.');
      case 'exhausted':
        throw new HttpsError('resource-exhausted', 'Too many incorrect attempts. Request a new code.');
      case 'resource-exhausted':
        throw new HttpsError('resource-exhausted', 'Too many attempts. Try again later.');
      case 'no-registration':
        throw new HttpsError('permission-denied', 'No active registration found for this email.');
      default: {
        // Exhaustiveness check: a new reason with no case above fails the build
        // here instead of falling through to a token.
        const unreachable: never = result.reason;
        throw new HttpsError('internal', `Unhandled verify outcome: ${unreachable}`);
      }
    }
  },
);
