import { createHash } from 'node:crypto';

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
