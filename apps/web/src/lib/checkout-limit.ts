import 'server-only';

import { COLLECTIONS } from '@kgc/shared';
import { ipCounterId, tickWindow, type WindowCounterDoc } from '@kgc/scripts/src/lib/rate-limit';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * How many checkouts one connection may start in a window.
 *
 * Every submit creates a Stripe session, and a multi-seat one writes a
 * `pending` order before the buyer pays. With no limit a script made 200 of
 * each in three seconds, and the dashboard's started-purchase lists filled
 * with them (T135, S7/TK-401). Ten in ten minutes is far more than a person
 * fixing typos needs, and an office buying on one connection still gets
 * through.
 */
export const CHECKOUT_STARTS_PER_WINDOW = 10;
export const CHECKOUT_WINDOW_MS = 10 * 60_000;

/**
 * The caller's address as the droplet's Apache saw it.
 *
 * Apache appends the connecting address to `X-Forwarded-For`, so the last
 * entry is the one a client cannot forge; anything before it is whatever the
 * client sent. (`callerIpFromHeaders` in `@kgc/scripts` reads the first entry,
 * which suits a host that overwrites the header.)
 */
export function checkoutCallerIp(headers: { get(name: string): string | null }): string | undefined {
  const chain = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return chain[chain.length - 1] || headers.get('x-real-ip')?.trim() || undefined;
}

/**
 * Count one checkout start for `ip`, and say whether it may go ahead.
 *
 * Fails open: with no address to count, or a counter that cannot be written,
 * the buyer is let through and the error is recorded. Refusing a paying
 * customer because the limiter broke is the worse outcome.
 */
export async function checkoutStartAllowed(ip: string | undefined): Promise<boolean> {
  if (!ip) return true;
  try {
    const ref = db().collection(COLLECTIONS.rateLimits).doc(ipCounterId('startCheckout', ip));
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = tickWindow(
        snap.data() as WindowCounterDoc | undefined,
        'startCheckout-ip',
        new Date(),
        CHECKOUT_WINDOW_MS,
        CHECKOUT_STARTS_PER_WINDOW,
      );
      if (!next) return false;
      tx.set(ref, next);
      return true;
    });
  } catch (err) {
    await recordError('checkout.rateLimit', err, { path: 'rateLimits', id: 'startCheckout' });
    return true;
  }
}
