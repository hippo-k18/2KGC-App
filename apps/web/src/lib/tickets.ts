/**
 * The shape of a ticket tier, and how to print a price. No data, no imports.
 *
 * ── Why this file no longer holds the catalogue ──────────────────────────────
 *
 * It used to export a frozen `TIERS` array, on the argument that a public price
 * list rendering from a database is a price list that shows "$0" when the
 * database is unreachable. That was right while nothing could edit the prices.
 * It stopped being right when the organizer dashboard grew a Create Tickets
 * screen: two places that both believe they own the price will eventually
 * disagree, and the failure mode of *that* is charging the wrong amount —
 * worse than an outage, because it is silent.
 *
 * The catalogue now lives in Firestore (`ticketTypes`) and is read by
 * `catalogue.ts`, which is `server-only`. This file stays pure precisely so the
 * client checkout form can import `Tier` and `formatPrice` without dragging the
 * Admin SDK into a browser chunk — the tiers themselves arrive as props.
 */

/**
 * A tier id is the Firestore document id, which is a human-readable slug
 * (`all-access`, `main-conference`). It was a closed union of four literals;
 * it is a string now because the dashboard can create a fifth, and a union
 * that has to be edited to add a ticket is a union that will be wrong.
 */
export type TicketId = string;

export interface Tier {
  id: TicketId;
  /** Stored on `RegistrationDoc.ticketType` and printed on the badge. */
  name: string;
  /** Minor units. Never a float — `1199.00` is a rounding bug waiting to happen. */
  priceCents: number;
  currency: string;
  tagline: string;
  includes: string[];
  /**
   * The same contents as `includes`, but grouped the way the live site's two
   * headline ticket panels group them: an underlined heading, then bullets.
   * Only the in-person headline tiers have it.
   */
  groups?: { heading: string; items?: string[] }[];
  /** Rendered with a little more emphasis on the tickets page. */
  featured?: boolean;
  inPerson: boolean;
  /**
   * False when capacity is reached or the sales window has closed. The tier
   * still renders — a sold-out ticket that vanishes reads as a bug — but it
   * cannot be selected and the server refuses it too.
   */
  onSale: boolean;
  /** Why it is not on sale, for the one line under a disabled option. */
  unavailableReason?: string;
  /**
   * Stripe's tax code for this tier. Carried on the display shape rather than
   * fetched separately because `startCheckout` already holds the tier and a
   * second read to learn one string is a second way to be wrong. It is public
   * information — `txcd_20030000` is in Stripe's own published table.
   */
  taxCode: string;
}

/** `119900` → `$1,199`. Whole dollars, because every tier is a whole number. */
export function formatPrice(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
