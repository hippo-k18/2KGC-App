import { formatPrice, type Tier, type TicketId } from '@/lib/tickets';

/**
 * Option 5's arithmetic, kept out of the components.
 *
 * The whole idea of this variant is a summary panel that can say what changing
 * the choice would *do* — "All Access adds both workshop days and the VIP
 * community happy hour, for +$400". Every one of those words and figures is
 * derived here from the catalogue, at render time. Nothing in this file, and
 * nothing in `page.tsx`, contains a price, a date, a deadline or a bullet.
 *
 * ── Why the "what it adds" list is a text diff ──────────────────────────────
 *
 * The display `Tier` carries prices and bullet strings and nothing else: the
 * seed's `includesWorkshops` / `includesVideoLibrary` booleans do not survive
 * `toTier()`, so there is no structured way to ask "does this ticket cover the
 * workshops?". The honest alternative to inventing that structure — or to
 * hand-writing four upgrade blurbs that would silently rot the day an organizer
 * edits a bullet — is to compare the two tiers' own words.
 *
 * So: a line of the better ticket counts as *added* when it uses at least one
 * meaningful word that appears nowhere in everything the cheaper ticket says
 * about itself (its name, tagline, bullets and group headings). That is
 * deliberately conservative in the right direction. "Every conference session,
 * Wednesday to Friday" is not an addition over Main Conference, whose own
 * tagline is "Wednesday to Friday at Cornell Tech"; "Both workshop days,
 * Monday and Tuesday" is, because Main Conference never says "workshop". Every
 * line that survives is a line the cheaper ticket genuinely does not print.
 */

/**
 * Words that carry no distinguishing information between two ticket
 * descriptions. Kept short on purpose: over-filtering makes two different
 * bullets look identical, which is the failure that would put a false claim on
 * the page.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'both',
  'by',
  'each',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'its',
  'more',
  'of',
  'on',
  'or',
  'our',
  'own',
  'plus',
  'that',
  'the',
  'this',
  'to',
  'up',
  'we',
  'with',
  'you',
  'your',
  'every',
  'all',
]);

/**
 * A crude, symmetrical stem. It only has to map the catalogue's own plurals and
 * participles onto each other — "streams"/"streamed", "sessions"/"session",
 * "recordings"/"recording" — and it is applied identically to both sides of
 * every comparison, so an over-eager trim costs nothing as long as it is
 * consistent.
 */
function stem(raw: string): string {
  let w = raw;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  return w;
}

function meaningfulWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .map(stem);
}

/**
 * A tier's bullets, flattened. The grouped shape is the same content as
 * `includes` arranged the way the live site arranges it; a heading with no
 * items ("KGC Video Library Subscription (3 months)") *is* the bullet, so it
 * becomes one.
 */
export function tierLines(tier: Tier): string[] {
  if (tier.groups?.length) {
    return tier.groups.flatMap((g) => (g.items?.length ? g.items : [g.heading]));
  }
  return tier.includes;
}

/** Everything a tier says about itself, as a bag of stems. */
function vocabulary(tier: Tier): Set<string> {
  const parts = [tier.name, tier.tagline, ...tier.includes, ...tierLines(tier)];
  for (const g of tier.groups ?? []) parts.push(g.heading);
  return new Set(parts.flatMap(meaningfulWords));
}

/** The lines `better` prints that `cheaper` does not. */
function additions(cheaper: Tier, better: Tier): string[] {
  const known = vocabulary(cheaper);
  return tierLines(better).filter((line) => meaningfulWords(line).some((w) => !known.has(w)));
}

export interface Upgrade {
  toId: TicketId;
  toName: string;
  /** `+$400`, computed. */
  delta: string;
  adds: string[];
}

export interface Row {
  id: TicketId;
  name: string;
  tagline: string;
  price: string;
  lines: string[];
  onSale: boolean;
  unavailableReason?: string;
  featured: boolean;
  /** The most expensive in-person ticket — the one the page is arguing for. */
  isTop: boolean;
  href: string;
  /** What moving from this row to the top ticket would do. Null on the top row. */
  upgrade: Upgrade | null;
}

/**
 * The one arithmetic fact that needs no upgrade framing: buying the in-person
 * tickets separately costs more than the ticket that contains them.
 */
export interface Bundle {
  /** "Main Conference and Workshops". */
  names: string;
  /** The ids the sum is over, so the panel knows when the comparison applies. */
  ids: TicketId[];
  separately: string;
  together: string;
  difference: string;
}

export interface ChooserModel {
  rows: Row[];
  selectedId: TicketId;
  topId: TicketId | null;
  bundle: Bundle | null;
}

function joinNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function buildModel(
  tiers: Tier[],
  selectedId: TicketId,
  basePath: string,
): ChooserModel {
  // The ticket being argued for is not hard-coded: it is whichever in-person
  // ticket costs the most. Add a fifth, dearer one and the page argues for that.
  const top = tiers
    .filter((t) => t.inPerson)
    .reduce<Tier | null>((best, t) => (best && best.priceCents >= t.priceCents ? best : t), null);

  const rows: Row[] = tiers.map((tier) => {
    const isTop = top?.id === tier.id;
    const upgrade: Upgrade | null =
      top && !isTop && top.onSale && top.priceCents > tier.priceCents
        ? {
            toId: top.id,
            toName: top.name,
            delta: `+${formatPrice(top.priceCents - tier.priceCents, top.currency)}`,
            adds: additions(tier, top),
          }
        : null;
    return {
      id: tier.id,
      name: tier.name,
      tagline: tier.tagline,
      price: formatPrice(tier.priceCents, tier.currency),
      lines: tierLines(tier),
      onSale: tier.onSale,
      unavailableReason: tier.unavailableReason,
      featured: Boolean(tier.featured),
      isTop,
      href: `${basePath}?tier=${encodeURIComponent(tier.id)}#buy`,
      upgrade,
    };
  });

  const parts = top ? tiers.filter((t) => t.inPerson && t.id !== top.id) : [];
  const separatelyCents = parts.reduce((sum, t) => sum + t.priceCents, 0);
  const bundle: Bundle | null =
    top && parts.length >= 2 && separatelyCents > top.priceCents
      ? {
          names: joinNames(parts.map((t) => t.name)),
          ids: parts.map((t) => t.id),
          separately: formatPrice(separatelyCents, top.currency),
          together: formatPrice(top.priceCents, top.currency),
          difference: formatPrice(separatelyCents - top.priceCents, top.currency),
        }
      : null;

  return { rows, selectedId, topId: top?.id ?? null, bundle };
}
