/**
 * Moved to `@kgc/scripts/src/lib/rate-limit.ts`, and re-exported here so every
 * existing import in `functions/` keeps working. See `otp.ts` beside this file
 * for why the OTP code now has two hosts sharing one limiter.
 *
 * `callerIpFromHeaders` is the Next.js counterpart of `callerIp` and is not
 * re-exported, because nothing in `functions/` has a `Headers` object to give
 * it — importing it here would only invite somebody to use the wrong one.
 */
export { callerIp, ipCounterId, tickWindow, type WindowCounterDoc } from '@kgc/scripts/src/lib/rate-limit';
