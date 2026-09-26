/**
 * The pure half of session seats on the dashboard: reading a cap out of a form
 * and a ticket list out of checkboxes. `session-seats.ts` is `server-only` and
 * cannot be imported by Vitest, so anything worth a test lives here. The seat
 * arithmetic itself is shared with the app, in `@kgc/shared`.
 */

export type ParsedCap = { ok: true; capacity: number | null } | { ok: false; error: string };

const MAX_CAP = 100_000;

/** Blank removes the cap. Anything else has to be a whole number of seats. */
export function parseCap(raw: string): ParsedCap {
  const text = raw.trim();
  if (text === '') return { ok: true, capacity: null };
  if (!/^\d+$/.test(text)) return { ok: false, error: 'Enter a whole number, or leave it blank for no cap.' };
  const capacity = Number(text);
  if (capacity < 1) return { ok: false, error: 'A cap has to be at least 1. Leave it blank for no cap.' };
  if (capacity > MAX_CAP) return { ok: false, error: `A cap cannot be more than ${MAX_CAP}.` };
  return { ok: true, capacity };
}

/**
 * The ticket types a session is restricted to, from what was ticked.
 *
 * Only names that are real ticket types survive, in the catalogue's order and
 * once each: the list is compared verbatim with the ticket type on a
 * registration, so a stray or misspelled name would be a restriction nobody can
 * satisfy. Nothing ticked means open to every ticket.
 */
export function resolveEligibility(ticked: string[], tierNames: string[]): string[] {
  const wanted = new Set(ticked.map((t) => t.trim()).filter(Boolean));
  return [...new Set(tierNames)].filter((name) => wanted.has(name));
}

/** "All Access (VIP), Gold and Workshops". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export type SeatFill = 'open' | 'full' | 'over';

/** How full a capped session is, for the tag beside the count. */
export function seatFill(taken: number, capacity: number): SeatFill {
  if (taken > capacity) return 'over';
  return taken === capacity ? 'full' : 'open';
}
