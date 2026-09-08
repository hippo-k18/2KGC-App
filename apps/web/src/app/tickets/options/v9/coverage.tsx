import type { Tier } from '@/lib/tickets';

/**
 * Which half of the week a day belongs to. Constant, because the shape of the
 * week is a fact about the event (workshops Monday–Tuesday, conference
 * Wednesday–Friday) rather than something a tier can change.
 */
export type Half = 'workshops' | 'conference';

export const DAYS: readonly { label: string; long: string; half: Half }[] = [
  { label: 'Mon', long: 'Monday', half: 'workshops' },
  { label: 'Tue', long: 'Tuesday', half: 'workshops' },
  { label: 'Wed', long: 'Wednesday', half: 'conference' },
  { label: 'Thu', long: 'Thursday', half: 'conference' },
  { label: 'Fri', long: 'Friday', half: 'conference' },
];

/** Everything a tier says about itself, lowercased, minus its name. */
export function tierText(tier: Tier): string {
  return [
    tier.tagline,
    ...tier.includes,
    ...(tier.groups ?? []).flatMap((g) => [g.heading, ...(g.items ?? [])]),
  ]
    .join(' \n ')
    .toLowerCase();
}

/**
 * Which halves of the week a tier covers, read out of its own copy rather than
 * hard-coded against four ids — the organizer can add a fifth ticket, and a
 * page that only understands four would silently mis-draw it.
 */
export function covers(tier: Tier): Record<Half, boolean> {
  const text = tierText(tier);
  return {
    workshops: /\bworkshop/.test(text),
    conference: /\bconference\b/.test(text),
  };
}

export function coversWholeWeek(tier: Tier): boolean {
  const c = covers(tier);
  return c.workshops && c.conference;
}

/** How a single day of a single tier should be drawn. */
export type DayState = 'in' | 'stream' | 'off';

export function dayState(tier: Tier, half: Half): DayState {
  if (!covers(tier)[half]) return 'off';
  return tier.inPerson ? 'in' : 'stream';
}

/**
 * The situation a ticket that is not the week ticket is *for*.
 *
 * Derived from coverage, so it stays true for a tier that did not exist when
 * this was written, and falls back to the tier's own tagline when the shape is
 * one this page has no sentence for.
 */
export function situation(tier: Tier): string {
  const c = covers(tier);
  if (!tier.inPerson) return 'If you cannot get to New York that week';
  if (c.workshops && !c.conference) return 'If the hands-on days are the part you need';
  if (c.conference && !c.workshops) return 'If Monday and Tuesday are not yours to spend';
  return tier.tagline;
}
