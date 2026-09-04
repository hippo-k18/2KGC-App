import { randomInt } from 'node:crypto';

/**
 * The one-time password a ticket purchase issues, one per buyer.
 *
 * ── What changed on 2026-09-04, and why it matters ──────────────────────────
 *
 * This module used to hand out a single shared password — the same string for
 * every attendee, printed on a public page and mailed in every receipt. It is
 * now six random digits per account, generated once at provisioning and never
 * reused. That removes the property that made the previous version hard to
 * defend: there is no longer a value which, learned once, signs in as anybody.
 *
 * The forced rotation stays. `mustChangePassword` is stamped on the profile and
 * the app refuses to render any route until the attendee has replaced this, so
 * a temporary password is what gets somebody in the first time and never the
 * credential they keep.
 *
 * ── Why six digits, which is genuinely weak ─────────────────────────────────
 *
 * It was asked for, and the number is not accidental either way: Firebase Auth
 * rejects anything under six characters with `auth/invalid-password`, so six is
 * simultaneously the floor and the request. One million combinations is not a
 * password anybody should keep, and this design agrees — it is closer to the
 * six-digit OTP code beside it than to a credential, and it is treated that way:
 * single account, single use, replaced before the app will do anything.
 *
 * ⚠️ What it relies on: Firebase Auth's own throttling of repeated failed
 * sign-ins (`auth/too-many-requests`). Nothing in this repo rate-limits a
 * password attempt, so if that protection is ever configured away, six digits
 * against a known address is guessable. Say so out loud rather than discover it.
 *
 * ── Random, not derived ─────────────────────────────────────────────────────
 *
 * `randomInt` from `node:crypto`, not `Math.random`. It is rejection-sampled
 * and unbiased, which matters less here than the fact that it is not
 * predictable from anything an attacker can see — a `Math.random` sequence is
 * reconstructible from a couple of observed outputs, and buyers see their own
 * value by design.
 *
 * The consequence is that the value cannot be recomputed later, so the
 * confirmation page reads it back from `registrations/{rid}.tempPassword`
 * rather than deriving it. `app-account-core.ts` carries the argument for
 * storing it and for clearing it again.
 *
 * ── Turning it off ──────────────────────────────────────────────────────────
 *
 * `ISSUE_TEMPORARY_PASSWORDS=0` provisions accounts with no password at all,
 * prints nothing on the confirmation page and mails no credential — the
 * pre-2026-09-02 behaviour, reachable without a code change. Any other value,
 * or an unset variable, leaves it on.
 */

/** Firebase's own floor, and the length that was asked for. They coincide. */
export const TEMPORARY_PASSWORD_LENGTH = 6;

/**
 * Six cryptographically random digits, leading zeros kept.
 *
 * `padStart` rather than a 100000–999999 range: excluding values below 100000
 * would quietly drop a tenth of the keyspace and make every password start with
 * a non-zero digit, which is a pattern worth not having for the sake of a
 * cosmetic preference about leading zeros.
 */
export function generateTemporaryPassword(): string {
  return String(randomInt(0, 10 ** TEMPORARY_PASSWORD_LENGTH)).padStart(
    TEMPORARY_PASSWORD_LENGTH,
    '0',
  );
}

/**
 * Whether a purchase should issue a password at all.
 *
 * Only the exact string `'0'` switches it off, and `'false'` alongside it
 * because somebody will write that. Anything else — including an unset
 * variable, an empty one, or a typo — leaves the feature on, which is the safe
 * direction for a switch whose off position means "buyers cannot sign in
 * without the OTP callables", and those are not deployed.
 */
export function temporaryPasswordsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ISSUE_TEMPORARY_PASSWORDS?.trim().toLowerCase();
  return raw !== '0' && raw !== 'false';
}
