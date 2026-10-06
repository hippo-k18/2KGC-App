import 'server-only';

import { cartVerdictForExtra, type ExtraRefusal, type ExtraTierShape } from '@kgc/shared';
import { extraTierById, extraVerdictFor } from '@kgc/scripts/src/lib/fulfilment';
import { db } from './firestore';
import { SITE } from './site';
import type { Tier } from './tickets';

/**
 * Whether every extra seat on a purchase can go on a badge, asked before any
 * money moves (card checkout and invoice request alike).
 *
 * Workshops needs Main Conference: already held on that address (or as one of
 * its alternate addresses), or bought for the same person in the same order.
 * All Access already includes the workshops, so its holders are refused rather
 * than charged twice; Virtual cannot take them. The rules themselves are
 * `cartVerdictForExtra` and `chooseExtraBase` in `@kgc/shared`, which the
 * webhook's fulfilment applies again.
 */

export function extraShape(tier: Tier): ExtraTierShape {
  return {
    id: tier.id,
    name: tier.name,
    kind: tier.kind,
    addOnFor: tier.requiresTierId,
    bundleOf: tier.baseTierId ? [tier.baseTierId] : undefined,
    includesWorkshops: tier.includesWorkshops,
    inPerson: tier.inPerson,
  };
}

/** The sentence a buyer reads when an extra cannot go on a badge. */
export function extraRefusalMessage(
  tier: Pick<Tier, 'name' | 'requiresTierName'>,
  email: string,
  reason: ExtraRefusal,
  heldName?: string,
): string {
  const needs = tier.requiresTierName ?? 'Main Conference';
  switch (reason) {
    case 'included':
      return `${email} holds ${heldName ?? 'a ticket'}, which already includes ${tier.name}. Nothing was charged.`;
    case 'already':
      return `${email} already has ${tier.name} on their ticket. Nothing was charged.`;
    case 'wrong-ticket':
      return (
        `${tier.name} is added to a ${needs} ticket, and ${email} holds ${heldName ?? 'a different ticket'}. ` +
        `Add ${needs} for this attendee to this order. Nothing was charged.`
      );
    case 'no-base':
      return (
        `${tier.name} is added to a ${needs} ticket, and we could not find one for ${email}. ` +
        `Add ${needs} for this attendee to this order, or use the address the ${needs} ticket was bought with. ` +
        `If that does not work, email ${SITE.contactEmail}. Nothing was charged.`
      );
  }
}

/**
 * The first problem with the extras on a purchase, as a sentence, or null.
 * `seats` must be in the order they will be fulfilled.
 */
export async function checkExtraSeats(
  seats: { email: string; tierId: string }[],
  tiers: Map<string, Tier | undefined>,
): Promise<string | null> {
  const shapeOf = (id: string) => {
    const t = tiers.get(id);
    return t ? extraShape(t) : undefined;
  };
  for (const [i, seat] of seats.entries()) {
    const tier = tiers.get(seat.tierId);
    if (!tier || tier.kind !== 'extra') continue;
    const extra = extraShape(tier);
    const inCart = cartVerdictForExtra(extra, i, seats, shapeOf);
    if (inCart.covered) continue;
    if (inCart.refusal) return extraRefusalMessage(tier, seat.email, inCart.refusal, inCart.heldName);

    const ctx = await extraTierById(db(), tier.id);
    if (!ctx) continue;
    const held = await extraVerdictFor(db(), seat.email, ctx);
    if (!held.ok) return extraRefusalMessage(tier, seat.email, held.reason, held.heldName);
  }
  return null;
}
