import 'server-only';

import { cartVerdictForExtra, type ExtraRefusal, type ExtraTierShape } from '@kgc/shared';
import { extraTierById, extraVerdictFor } from '@kgc/scripts/src/lib/fulfilment';
import { db } from './firestore';
import type { Tier } from './tickets';

/**
 * Whether every extra seat on a purchase can be sold, asked before any money
 * moves (card checkout and invoice request alike).
 *
 * Workshops is sold on its own since 2026-10-07 (owner): it joins the
 * person's conference badge when they have one, held already or bought in the
 * same order, and is a Workshops-only badge when they do not. Two cases are
 * still refused: All Access already includes the workshops, so its holders
 * are not charged twice, and nobody buys Workshops a second time. The rules
 * themselves are `cartVerdictForExtra` and `chooseExtraBase` in
 * `@kgc/shared`, which the webhook's fulfilment applies again.
 */

export function extraShape(tier: Tier): ExtraTierShape {
  return {
    id: tier.id,
    name: tier.name,
    kind: tier.kind,
    bundleOf: tier.baseTierId ? [tier.baseTierId] : undefined,
    includesWorkshops: tier.includesWorkshops,
    inPerson: tier.inPerson,
  };
}

/** The sentence a buyer reads when an extra cannot be sold to them. */
export function extraRefusalMessage(
  tier: Pick<Tier, 'name'>,
  email: string,
  reason: ExtraRefusal,
  heldName?: string,
): string {
  switch (reason) {
    case 'included':
      return `${email} holds ${heldName ?? 'a ticket'}, which already includes ${tier.name}. Nothing was charged.`;
    case 'already':
      return `${email} already has ${tier.name}. Nothing was charged.`;
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
