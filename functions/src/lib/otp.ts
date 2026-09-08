/**
 * Moved to `@kgc/scripts/src/lib/otp-ids.ts`, and re-exported here so every
 * existing import in `functions/` keeps working.
 *
 * The move happened when the OTP endpoints gained a second host: `apps/web`
 * now serves them as route handlers, because deploying functions is blocked on
 * an IAM grant only the project owner can give (OWNER-ACTIONS.md §3). Two
 * copies of `otpDocId` would be two copies that can disagree, and the day they
 * disagreed is the day `requestOtp` writes a code to one document and
 * `verifyOtp` reads a different one.
 */
export { normaliseEmail, otpDocId } from '@kgc/scripts/src/lib/otp-ids';
