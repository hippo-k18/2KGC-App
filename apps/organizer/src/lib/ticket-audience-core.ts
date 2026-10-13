/**
 * Who actually holds each ticket type, for the screens that gate video by one.
 *
 * ── The question these screens ask, and the number they were answering ──────
 *
 * Attendee Video Access asks "who would get access" and printed
 * `TicketTypeDoc.quantitySold` beside each tier. That is how many seats this
 * system has *sold* — four orders on the seeded event — while the registrations
 * actually holding those tiers number sixty-three, because attendees imported
 * from a previous system, comped speakers and organizer-added guests all hold a
 * ticket nobody bought here. An organizer reading "All Access (VIP): sold 0"
 * concludes nobody has the tier and gates a recording accordingly, locking out
 * the twelve people who do.
 *
 * The gate compares `RegistrationDoc.ticketType` against a list of names, so
 * the honest count is a count of registrations by that exact field. Nothing
 * else is the number the rules will use.
 *
 * ── And the tier no checkbox can offer ──────────────────────────────────────
 *
 * Three registrations on the seeded event carry `Standard` and `Added by
 * organizer`, which are not in the ticket catalogue at all. Every "who can
 * watch" control is built from the catalogue, so those people appear in no
 * list: the moment any restriction is set they are locked out and there is no
 * control that could let them in. They are rows here, marked, rather than
 * absent — an organizer cannot act on a group they cannot see.
 *
 * Plain TypeScript: no Firestore import, no React. Tested beside it.
 */

export interface TicketAudienceRow {
  /** The name as it is stored, which is what a restriction is matched against. */
  name: string;
  /** Active registrations carrying exactly this name. */
  holders: number;
  /** False for a name held by somebody but absent from the ticket catalogue. */
  inCatalogue: boolean;
  /** Whether the tier's own description sells a video library. */
  videoLibrary: boolean;
}

/**
 * Fold a ticket type name for comparison only.
 *
 * ⚠️ The folded form is never stored or displayed. `firestore.rules` compares
 * the stored strings exactly, so a screen that quietly merged "All Access" and
 * "all  access" would be telling an organizer that two groups are one when the
 * gate will treat them as two.
 */
const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export function ticketAudienceRows(
  catalogue: readonly { name: string; videoLibrary: boolean }[],
  held: Readonly<Record<string, number>>,
): TicketAudienceRow[] {
  const counts = new Map<string, { name: string; holders: number }>();
  for (const [rawName, n] of Object.entries(held)) {
    const name = rawName.trim();
    if (!name || !Number.isFinite(n) || n <= 0) continue;
    const k = key(name);
    const seen = counts.get(k);
    counts.set(k, { name: seen?.name ?? name, holders: (seen?.holders ?? 0) + n });
  }

  const rows: TicketAudienceRow[] = catalogue.map((t) => {
    const k = key(t.name);
    const holders = counts.get(k)?.holders ?? 0;
    counts.delete(k);
    return { name: t.name, holders, inCatalogue: true, videoLibrary: t.videoLibrary };
  });

  // Whatever is left is held by somebody and offered by nothing.
  const strays = [...counts.values()]
    .map((c) => ({ name: c.name, holders: c.holders, inCatalogue: false, videoLibrary: false }))
    .sort((a, b) => b.holders - a.holders || a.name.localeCompare(b.name));

  return [...rows, ...strays];
}

/** How many people hold a tier that no restriction control can name. */
export function strandedHolders(rows: readonly TicketAudienceRow[]): number {
  return rows.reduce((n, r) => (r.inCatalogue ? n : n + r.holders), 0);
}
