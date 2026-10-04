import 'server-only';

import { COLLECTIONS } from '@kgc/shared';
import { ipCounterId } from '@kgc/scripts/src/lib/rate-limit';
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
 * ── Slots, not a counter ────────────────────────────────────────────────────
 *
 * The first version kept one counter document per address and moved it in a
 * transaction. Under a burst every request fought for that one document,
 * Firestore aborted most of the transactions, and the limiter, failing open,
 * let them all through: 200 requests at once made 200 sessions (T138B,
 * TK-401), and each abort wrote an auditLog row that pushed real alerts off
 * Tools > Report.
 *
 * Now each window has `CHECKOUT_STARTS_PER_WINDOW` slot documents per address,
 * and a start is allowed only if it creates one of them. `create` is atomic
 * and needs no transaction: it either writes or fails with ALREADY_EXISTS, so
 * however many requests arrive together, exactly that many succeed. The
 * window is fixed (aligned to the clock), which is enough to stop a flood.
 *
 * Still fails open on an unexpected error, because refusing a paying buyer
 * over a broken limiter is the worse outcome, but only to the server log.
 */
export async function checkoutStartAllowed(ip: string | undefined, now = Date.now()): Promise<boolean> {
  if (!ip) return true;
  const window = Math.floor(now / CHECKOUT_WINDOW_MS);
  const base = `${ipCounterId('startCheckout', ip)}_w${window}`;
  const col = db().collection(COLLECTIONS.rateLimits);
  const slots = Array.from({ length: CHECKOUT_STARTS_PER_WINDOW }, (_, i) => col.doc(`${base}_${i}`));

  try {
    // One read to skip the slots already taken, then try the free ones from a
    // random starting point, so a burst does not queue on slot 0.
    const taken = new Set((await db().getAll(...slots)).filter((d) => d.exists).map((d) => d.id));
    const free = slots.filter((s) => !taken.has(s.id));
    const start = Math.floor(Math.random() * Math.max(1, free.length));
    for (let k = 0; k < free.length; k += 1) {
      const slot = free[(start + k) % free.length];
      try {
        await slot.create({
          kind: 'startCheckout-slot',
          windowStart: new Date(window * CHECKOUT_WINDOW_MS),
          // For the TTL policy on `rateLimits`; see `@kgc/scripts` rate-limit.ts.
          expiresAt: new Date((window + 1) * CHECKOUT_WINDOW_MS),
        });
        return true;
      } catch (err) {
        // ALREADY_EXISTS: somebody else in this burst took it. Try the next.
        if ((err as { code?: unknown }).code === 6) continue;
        throw err;
      }
    }
    return false;
  } catch (err) {
    console.error('[checkout] rate limiter failed, letting the request through', err);
    return true;
  }
}
