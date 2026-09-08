import { formatPrice, type Tier } from '@/lib/tickets';

/**
 * The arithmetic this page is built around, derived from the catalogue.
 *
 * Nothing here is typed. The combined ticket is whichever in-person tier on
 * sale costs the most; the "parts" are the other in-person tiers on sale. With
 * the 2027 catalogue that is All Access against Workshops plus Main Conference,
 * and the sum of the parts ($1,498) exceeds the combined price ($1,199) — which
 * is the whole argument. If an organizer adds a fifth ticket, the figures move
 * with it, and the labels name the exact rows being added so the sum is always
 * legible as what it literally is.
 *
 * `null` when the comparison would not be honest: no combined tier, fewer than
 * two parts, or a sum that does not actually beat the combined price.
 */
export interface Reckoning {
  combined: Tier;
  parts: Tier[];
  /** Sum of the parts, in minor units. */
  separateCents: number;
  /** `separateCents - combined.priceCents`, always positive when this exists. */
  differenceCents: number;
  currency: string;
  /**
   * One line per part: what the step up to the combined ticket costs from
   * there, and what the *other* part costs bought alone. Only populated when
   * there are exactly two parts, because "the other one" is only a thing when
   * there is exactly one other one.
   */
  steps: { from: Tier; adds: Tier; extraCents: number }[];
}

export function reckon(tiers: Tier[]): Reckoning | null {
  const inPerson = tiers.filter((t) => t.inPerson && t.onSale);
  if (inPerson.length < 3) return null;

  const combined = inPerson.reduce((a, b) => (b.priceCents > a.priceCents ? b : a));
  const parts = inPerson
    .filter((t) => t.id !== combined.id)
    .sort((a, b) => a.priceCents - b.priceCents);
  if (parts.length < 2) return null;

  const separateCents = parts.reduce((sum, t) => sum + t.priceCents, 0);
  const differenceCents = separateCents - combined.priceCents;
  if (differenceCents <= 0) return null;

  const steps =
    parts.length === 2
      ? parts.map((from, i) => ({
          from,
          adds: parts[1 - i],
          extraCents: combined.priceCents - from.priceCents,
        }))
      : [];

  return {
    combined,
    parts,
    separateCents,
    differenceCents,
    currency: combined.currency,
    steps,
  };
}

/**
 * A price split into its symbol and its digits, so the digits can be set as a
 * right-aligned column of tabular figures with the currency mark hanging to the
 * left of it — the way a printed price list sets a money column.
 *
 * Falls back to putting everything in `figure` for currencies whose symbol
 * trails the number, which still right-aligns correctly.
 */
export function splitPrice(cents: number, currency: string) {
  const printed = formatPrice(cents, currency);
  const match = /^(\D*)(\d[\d,.\s]*)$/.exec(printed);
  return match ? { symbol: match[1], figure: match[2] } : { symbol: '', figure: printed };
}
