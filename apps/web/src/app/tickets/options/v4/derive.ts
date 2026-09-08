import type { Tier } from '@/lib/tickets';

/**
 * Everything the collapsed cards claim, computed from the catalogue.
 *
 * The point of this variant is that a shut card still tells you something true
 * and *different from its neighbours*. That only holds if the summary lines are
 * derived rather than written: hand-written summaries drift the moment an
 * organizer edits a bullet, and a summary that drifted is worse than no summary
 * at all, because the buyer believed it.
 *
 * So nothing here is a lookup table keyed on `all-access`. Every function takes
 * whatever tiers exist and returns nothing at all when the data will not
 * support the claim — a fifth tier, or a rewritten bullet, degrades the card to
 * fewer lines instead of making it lie.
 */

const DAY_NAMES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const COUNT_WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

/**
 * Words dropped before comparing two bullets. Deliberately short: "every" looks
 * like a stopword and is not, because "Every conference session, Wednesday to
 * Friday" and "Every conference session, in person" are the same promise and
 * only stay the same promise while "every", "conference" and "session" all
 * count towards the overlap.
 */
const STOPWORDS = new Set([
  'and',
  'the',
  'of',
  'in',
  'a',
  'an',
  'to',
  'for',
  'with',
  'on',
  'at',
  'or',
  'your',
  'from',
  'it',
  'is',
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter((word) => word.length > 0 && !STOPWORDS.has(word)),
  );
}

/**
 * True when everything `line` promises is already promised by `other`, allowing
 * for the two panels wording it differently.
 *
 * Directional on purpose. The denominator is `line`'s own significant words, so
 * a short generic bullet cannot swallow a longer specific one: "Community happy
 * hour" covers three of the six words in "VIP community happy hour with the
 * programme committee", which is 0.5 and not a match, and the VIP hour stays
 * counted as the extra it is. Measuring against the *shorter* of the two would
 * score that pair 1.0 and quietly delete a real difference between two tickets.
 *
 * The threshold is 0.6, the lowest value that still merges "Every conference
 * session, Wednesday to Friday" with "Every conference session, in person" —
 * the same promise, worded for two different panels. Erring towards "already
 * covered" is the safe direction: it understates what the dearer ticket adds
 * rather than inventing something.
 */
function saysTheSameThing(line: string, other: string): boolean {
  const a = tokens(line);
  const b = tokens(other);
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / a.size >= 0.6;
}

/**
 * The tier's contents as a flat list of *things*, in reading order.
 *
 * A group heading with bullets under it is a category, not a thing, so it is
 * not counted. A group heading with no bullets — "KGC Video Library
 * Subscription (3 months)" — is the thing itself, so it is. Tiers with no
 * groups fall back to `includes`, which is the same list ungrouped.
 */
export function contents(tier: Tier): string[] {
  if (tier.groups?.length) {
    return tier.groups.flatMap((group) =>
      group.items?.length ? group.items : [group.heading],
    );
  }
  return tier.includes;
}

/** `3` → `three`, up to twelve, then digits. Reads better in a sentence. */
export function spell(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

export interface DayCover {
  /** Indices into `DAY_SHORT`, ascending. */
  indices: number[];
  /** `Mon–Fri`, or `Mon, Wed` when the days are not contiguous. */
  label: string;
}

/**
 * Which days of the week a tier's own copy claims, read out of that copy.
 *
 * Ranges are expanded, so "Wednesday to Friday" contributes Thursday even
 * though the word never appears. Bare mentions are added as they stand, which
 * is what makes "Monday and Tuesday" two days rather than a range.
 */
export function daysCovered(tier: Tier): DayCover | null {
  const prose = [tier.tagline, ...tier.includes, ...contents(tier)].join(' \n ').toLowerCase();
  const found = new Set<number>();

  const range = new RegExp(
    `\\b(${DAY_NAMES.join('|')})\\b[^.\\n]{0,12}?\\b(?:to|through|thru|until|till)\\b[^.\\n]{0,12}?\\b(${DAY_NAMES.join('|')})\\b`,
    'g',
  );
  for (const match of prose.matchAll(range)) {
    const from = DAY_NAMES.indexOf(match[1] as (typeof DAY_NAMES)[number]);
    const to = DAY_NAMES.indexOf(match[2] as (typeof DAY_NAMES)[number]);
    if (from < 0 || to < 0 || to < from) continue;
    for (let i = from; i <= to; i += 1) found.add(i);
  }
  DAY_NAMES.forEach((day, i) => {
    if (new RegExp(`\\b${day}\\b`).test(prose)) found.add(i);
  });

  if (found.size === 0) return null;
  const indices = [...found].sort((a, b) => a - b);
  const contiguous = indices[indices.length - 1] - indices[0] + 1 === indices.length;
  const label =
    indices.length === 1
      ? DAY_SHORT[indices[0]]
      : contiguous
        ? `${DAY_SHORT[indices[0]]}–${DAY_SHORT[indices[indices.length - 1]]}`
        : indices.map((i) => DAY_SHORT[i]).join(', ');
  return { indices, label };
}

/** The things in `tier` that no tier in `others` also promises. */
export function notIn(tier: Tier, others: Tier[]): string[] {
  const pool = others.flatMap(contents);
  return contents(tier).filter((line) => !pool.some((other) => saysTheSameThing(line, other)));
}

/** The most expensive tier strictly cheaper than this one. */
export function nextCheapest(tier: Tier, all: Tier[]): Tier | null {
  const cheaper = all
    .filter((t) => t.priceCents < tier.priceCents)
    .sort((a, b) => b.priceCents - a.priceCents);
  return cheaper[0] ?? null;
}

export interface Bundle {
  parts: [Tier, Tier];
  sumCents: number;
  savingCents: number;
  /** Things the single ticket has that neither half does. */
  extras: string[];
}

/**
 * Two other tickets that between them cover exactly the same days as `tier`,
 * and what buying them separately would cost.
 *
 * This is the honest version of "best value": not a badge, an addition. It only
 * returns a pair whose day coverage is disjoint and adds up to the whole of
 * `tier`'s week — Workshops and Main Conference — so there is no arithmetic
 * comparing a ticket against days it does not sell. If the catalogue changes
 * such that no pair does that, the card simply loses the paragraph.
 */
export function bundleMaths(tier: Tier, all: Tier[]): Bundle | null {
  const whole = daysCovered(tier);
  if (!whole) return null;
  const target = whole.indices.join(',');
  const candidates = all.filter((t) => t.id !== tier.id && t.inPerson === tier.inPerson);

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = daysCovered(candidates[i]);
      const b = daysCovered(candidates[j]);
      if (!a || !b) continue;
      if (a.indices.some((day) => b.indices.includes(day))) continue;
      const union = [...new Set([...a.indices, ...b.indices])].sort((x, y) => x - y);
      if (union.join(',') !== target) continue;

      const parts: [Tier, Tier] = [candidates[i], candidates[j]].sort(
        (x, y) => x.priceCents - y.priceCents,
      ) as [Tier, Tier];
      const sumCents = parts[0].priceCents + parts[1].priceCents;
      if (sumCents <= tier.priceCents) continue;
      return {
        parts,
        sumCents,
        savingCents: sumCents - tier.priceCents,
        extras: notIn(tier, parts),
      };
    }
  }
  return null;
}
