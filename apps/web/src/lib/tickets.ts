/**
 * The ticket catalogue.
 *
 * Prices are in **minor units**, never floats — same rule as
 * `TicketTypeDoc.priceCents` in `@kgc/shared`. `119900` is unambiguous;
 * `1199.00` is a rounding bug waiting for a currency conversion.
 *
 * This file is plain data with no server imports, so the client checkout form
 * can render the catalogue without dragging the Admin SDK into a browser
 * chunk. It is intentionally *not* read from the `ticketTypes` collection:
 * a public price list that renders from a database is a price list that shows
 * "$0" when the database is unreachable, and the four tiers change once a year.
 */

export type TicketId = 'all-access' | 'main-conference' | 'workshops' | 'virtual';

export interface Tier {
  id: TicketId;
  /** Stored on `RegistrationDoc.ticketType` and printed on the badge. */
  name: string;
  priceCents: number;
  currency: 'usd';
  tagline: string;
  includes: string[];
  /** Rendered with a little more emphasis on the tickets page. */
  featured?: boolean;
  inPerson: boolean;
}

export const TIERS: readonly Tier[] = [
  {
    id: 'all-access',
    name: 'All Access (VIP)',
    priceCents: 119_900,
    currency: 'usd',
    tagline: 'The whole week, in the room and on demand.',
    featured: true,
    inPerson: true,
    includes: [
      'Every in-person session, Monday to Friday',
      'Both workshop days and all masterclasses',
      'VIP community happy hour with the programme committee',
      'All evening networking events, including the Friday watch party',
      'Live streams and recordings of every virtual session',
      'Three months of the KGC Video Library',
    ],
  },
  {
    id: 'main-conference',
    name: 'Main Conference',
    priceCents: 79_900,
    currency: 'usd',
    tagline: 'Wednesday to Friday at Cornell Tech.',
    inPerson: true,
    includes: [
      'Every main conference session, Wednesday to Friday',
      'Community happy hour',
      'All evening networking events, including the Friday watch party',
      'Virtual conference sessions on demand',
      'Three months of the KGC Video Library',
    ],
  },
  {
    id: 'workshops',
    name: 'Workshops',
    priceCents: 69_900,
    currency: 'usd',
    tagline: 'Two days of hands-on practice.',
    inPerson: true,
    includes: [
      'Every in-person workshop and masterclass, Monday and Tuesday',
      'Instructor-led labs at beginner, intermediate and advanced level',
      'Workshop materials and datasets to take home',
      'Community happy hour',
    ],
  },
  {
    id: 'virtual',
    name: 'Virtual',
    priceCents: 34_900,
    currency: 'usd',
    tagline: 'Every session, from wherever you are.',
    inPerson: false,
    includes: [
      'Live streams of every conference and workshop session',
      'Watch Monday through Friday in your own time zone',
      'On-demand replays for at least a month afterwards',
      'Virtual hallway track and Q&A in the KGC app',
    ],
  },
] as const;

export function tierById(id: string): Tier | undefined {
  return TIERS.find((t) => t.id === id);
}

/** `119900` → `$1,199`. Whole dollars, because every tier is a whole number. */
export function formatPrice(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
