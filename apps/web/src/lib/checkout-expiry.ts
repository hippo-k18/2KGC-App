/**
 * When a Stripe Checkout session should stop accepting payment (T257 #6).
 *
 * A session keeps the price and availability fixed at the moment it was made,
 * and Stripe's default life is 24 hours. So a buyer who opened checkout on the
 * last evening of Early Bird could pay Early Bird the next day, and a tier
 * that sold out or closed kept selling through every session still open.
 *
 * The session now lives an hour, or until the next price phase or sales close
 * if that comes sooner. Stripe refuses an `expires_at` under 30 minutes from
 * now, so a change closer than that gets the shortest session Stripe allows,
 * with a minute's margin for the clocks to disagree. That leaves at most half
 * an hour across a boundary, against a day before.
 *
 * Pure, so it is unit-tested without Stripe or Firestore.
 */

/** The usual life of a session. */
export const CHECKOUT_LIFE_MS = 60 * 60_000;

/** Stripe's shortest allowed session (30 minutes), plus a minute of clock skew. */
export const CHECKOUT_MIN_LIFE_MS = 31 * 60_000;

/** Unix seconds, as Stripe's `expires_at` takes them. */
export function checkoutExpiresAt(now: Date, nextChange?: Date): number {
  const start = now.getTime();
  let end = start + CHECKOUT_LIFE_MS;
  if (nextChange && nextChange.getTime() < end) {
    end = Math.max(nextChange.getTime(), start + CHECKOUT_MIN_LIFE_MS);
  }
  return Math.floor(end / 1000);
}
