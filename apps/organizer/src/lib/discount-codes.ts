import 'server-only';

import { stripe } from './stripe';

/**
 * Discount codes, which live in Stripe rather than in Firestore.
 *
 * ── Why there is no coupon table here ───────────────────────────────────────
 *
 * Checkout is created with `allow_promotion_codes: true`, which means **Stripe
 * validates and applies the code itself**, at the moment of payment, against its
 * own redemption counters and expiry rules. A mirror of those codes in Firestore
 * would be a second source of truth that Stripe never consults — so the only
 * thing it could ever do is disagree, and the way it would disagree is a code
 * this dashboard says is exhausted still working, or vice versa.
 *
 * This module therefore reads Stripe live. It is the one screen in the console
 * that does, and that is the correct trade for the one piece of data Stripe
 * genuinely owns.
 *
 * ── Coupon versus promotion code ────────────────────────────────────────────
 *
 * Stripe splits what an organizer thinks of as one thing into two: a **coupon**
 * is the discount (25% off, or $200 off) and a **promotion code** is the string
 * somebody types (`SPEAKER25`). One coupon can carry several codes. Creating a
 * discount therefore means creating both, which `createDiscountCode` does in one
 * call so the split never leaks into the UI.
 *
 * ⚠️ **On API version `2025-10-29.clover` the coupon sits under `promotion`**,
 * not at the top level: `promotionCode.promotion.coupon`, and on create it is
 * `{ promotion: { type: 'coupon', coupon: id } }`. Older Stripe examples and
 * most of the internet still show the flat `coupon` field, which typechecks as
 * an error here rather than failing at runtime — which is the good outcome, and
 * the reason the API version is pinned rather than left to float.
 */

export interface DiscountCodeRow {
  id: string;
  /** What the buyer types. Stripe upper-cases it. */
  code: string;
  active: boolean;
  /** "25% off" or "$200 off". */
  discount: string;
  /** Redemptions so far, and the cap if there is one. */
  timesRedeemed: number;
  maxRedemptions?: number;
  expiresAt?: string;
  /** Stripe restricts some codes to first-time customers or a minimum spend. */
  restrictions: string[];
  createdAt: string;
}

function describeCoupon(coupon: {
  percent_off?: number | null;
  amount_off?: number | null;
  currency?: string | null;
}): string {
  if (coupon.percent_off) return `${coupon.percent_off}% off`;
  if (coupon.amount_off) {
    return `${new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (coupon.currency ?? 'usd').toUpperCase(),
    }).format(coupon.amount_off / 100)} off`;
  }
  return 'no discount';
}

/**
 * Every promotion code on the account, newest first.
 *
 * ⚠️ **This lists codes for the whole Stripe account, not just this event.**
 * There is nothing on a Stripe promotion code that scopes it to KGC 2027 unless
 * somebody sets metadata, and codes created in Stripe's own dashboard will not
 * have it. Showing everything and saying so beats filtering on a field that is
 * usually absent and silently hiding half the codes.
 */
export async function listDiscountCodes(): Promise<DiscountCodeRow[]> {
  const res = await stripe().promotionCodes.list({
    limit: 100,
    expand: ['data.promotion.coupon'],
  });

  return res.data
    .map((p) => {
      // Expanded above, so this is a `Coupon` rather than an id string — but a
      // narrow rather than a cast, because an unexpanded response is a bug that
      // should degrade to "unknown discount" instead of throwing on the page.
      const raw = p.promotion?.coupon;
      const coupon = typeof raw === 'string' || !raw ? null : raw;
      const restrictions: string[] = [];
      if (p.restrictions?.first_time_transaction) restrictions.push('first purchase only');
      if (p.restrictions?.minimum_amount) {
        restrictions.push(
          `min ${new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: (p.restrictions.minimum_amount_currency ?? 'usd').toUpperCase(),
          }).format(p.restrictions.minimum_amount / 100)}`,
        );
      }
      if (coupon?.duration && coupon.duration !== 'once') restrictions.push(coupon.duration);

      return {
        id: p.id,
        code: p.code,
        // A code is usable only if both it and its coupon are active — an
        // expired coupon leaves an "active" code that fails at checkout.
        active: p.active && (coupon?.valid ?? false),
        discount: coupon ? describeCoupon(coupon) : 'unknown',
        timesRedeemed: p.times_redeemed ?? 0,
        maxRedemptions: p.max_redemptions ?? undefined,
        expiresAt: p.expires_at ? new Date(p.expires_at * 1000).toISOString() : undefined,
        restrictions,
        createdAt: new Date(p.created * 1000).toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface CreateDiscountInput {
  code: string;
  /** Exactly one of these two. */
  percentOff?: number;
  amountOffCents?: number;
  currency: string;
  maxRedemptions?: number;
  expiresAt?: Date;
}

/**
 * Create a coupon and its promotion code together.
 *
 * `duration: 'once'` on the coupon is deliberate and not configurable here: a
 * conference ticket is a one-off payment, and `repeating` / `forever` are
 * subscription concepts that would do nothing except confuse the screen.
 */
export async function createDiscountCode(input: CreateDiscountInput): Promise<string> {
  const s = stripe();

  const coupon = await s.coupons.create({
    duration: 'once',
    name: input.code,
    ...(input.percentOff
      ? { percent_off: input.percentOff }
      : { amount_off: input.amountOffCents, currency: input.currency }),
  });

  const promo = await s.promotionCodes.create({
    promotion: { type: 'coupon', coupon: coupon.id },
    // Stripe upper-cases this itself; doing it here keeps what we store and
    // what an organizer is told to hand out identical.
    code: input.code.toUpperCase(),
    max_redemptions: input.maxRedemptions,
    expires_at: input.expiresAt ? Math.floor(input.expiresAt.getTime() / 1000) : undefined,
    metadata: { kgcEvent: 'kgc-2027' },
  });

  return promo.code;
}

/**
 * Turn a code off.
 *
 * Deactivated rather than deleted, because Stripe keeps a promotion code
 * attached to every payment that used it — and an order whose discount code no
 * longer exists is an order nobody can explain a year later.
 */
export async function setDiscountCodeActive(id: string, active: boolean): Promise<void> {
  await stripe().promotionCodes.update(id, { active });
}
