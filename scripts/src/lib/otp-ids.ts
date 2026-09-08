import { createHash } from 'node:crypto';

/**
 * Id and address helpers for the six-digit sign-in code.
 *
 * ── Why these live here and not in `functions/` ─────────────────────────────
 *
 * They used to live in `functions/src/lib/otp.ts`, which was the right place
 * while the Cloud Functions were the only caller. They are not any more: the
 * two OTP endpoints are now *also* served from `apps/web` as route handlers,
 * because `firebase deploy` for functions is blocked on an IAM grant only the
 * project owner can give (OWNER-ACTIONS.md §3) and sign-in cannot wait on it.
 *
 * `@kgc/scripts/src/lib/` is where AGENTS.md puts server-side domain logic that
 * more than one surface needs, for the reason that applies exactly here: a
 * second copy of `otpDocId` would be a copy that can disagree, and the day it
 * disagreed is the day `requestOtp` writes a code to one document and
 * `verifyOtp` reads a different one — an attendee holding a correct code that
 * nothing will accept, with no error message that points at the cause.
 *
 * `functions/src/lib/otp.ts` now re-exports this file rather than duplicating
 * it, so the deployed-functions path and the website path are the same code.
 */

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/**
 * Deterministic across `requestOtp` and `verifyOtp` (functions/SPEC.md
 * #9-#10) — both must land on the same `otpCodes/{id}`, and this doubles as
 * the id for `rateLimits/{id}` since the two collections are separate
 * namespaces. Expects an already-normalised email.
 */
export function otpDocId(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 24);
}
