import { SITE } from '@/lib/site';
import type { Tier } from '@/lib/tickets';

/**
 * Turning the ticket catalogue into a calendar.
 *
 * The whole idea of this option is that a ticket is a *span of days* rather
 * than a status level, so everything the page draws — the bars, the two halves
 * of the week, the arithmetic under All Access — has to be derived from the
 * tier data rather than typed out. A hard-coded "All Access = Mon–Fri" would be
 * wrong the first time an organizer adds a fifth ticket, which is precisely the
 * case the brief says to survive.
 *
 * So: the week comes from `SITE`, the day coverage comes from reading the words
 * the organizer wrote in each tier, and the saving comes from adding prices up.
 */

export interface WeekDay {
  /** `monday`, used as a React key and for matching prose. */
  key: string;
  /** `Mon`, for the column head. */
  short: string;
  /** `Monday`, for prose and for screen readers. */
  long: string;
  /** Day of the month, 3–7 for KGC 2027. */
  date: number;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function buildDays(year: number, monthIndex: number, first: number, last: number): WeekDay[] {
  const days: WeekDay[] = [];
  for (let date = first; date <= last; date += 1) {
    /* UTC throughout: this is a wall-calendar, not an instant, and building it
       in the server's local zone would slide the weekday by one for anybody
       west of Greenwich. */
    const at = new Date(Date.UTC(year, monthIndex, date));
    const long = at.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    days.push({
      key: long.toLowerCase(),
      short: at.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      long,
      date,
    });
  }
  return days;
}

/**
 * The five days of the conference, read off `SITE.datesLong` ("3–7 May 2027").
 *
 * Parsed rather than typed so that moving the conference is still the one-line
 * edit `site.ts` promises it is. If the string ever stops looking like a date
 * range the fallback is the same week, spelled out — a page that renders the
 * wrong week is worse than one that renders a stale one, and both beat a crash.
 */
export function conferenceWeek(): WeekDay[] {
  const m = /(\d{1,2})\s*[–—-]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(SITE.datesLong);
  if (m) {
    const first = Number(m[1]);
    const last = Number(m[2]);
    const monthIndex = MONTHS.indexOf(m[3].toLowerCase());
    const year = Number(m[4]);
    const length = last - first + 1;
    if (monthIndex >= 0 && length >= 2 && length <= 10) {
      return buildDays(year, monthIndex, first, last);
    }
  }
  return buildDays(2027, 4, 3, 7);
}

export interface Half {
  label: string;
  from: number;
  to: number;
}

/** The first weekday named in a string, and the last, as column indices. */
function spanOf(text: string, week: WeekDay[]): { from: number; to: number } | null {
  const lower = text.toLowerCase();
  const hits = week.map((d, i) => (lower.includes(d.key) ? i : -1)).filter((i) => i >= 0);
  if (hits.length === 0) return null;
  return { from: Math.min(...hits), to: Math.max(...hits) };
}

/**
 * The two halves of the week, from `SITE.workshopDays` / `SITE.conferenceDays`.
 *
 * These are the labels that sit over the day columns, and they are the reason
 * the page can ask "which days are you coming?" instead of "how important are
 * you?" — the week already has a shape, and every ticket is a piece of it.
 */
export function weekHalves(week: WeekDay[]): Half[] {
  const halves: Half[] = [];
  const workshops = spanOf(SITE.workshopDays, week);
  const conference = spanOf(SITE.conferenceDays, week);
  if (workshops) halves.push({ label: 'Workshops', ...workshops });
  if (conference) halves.push({ label: 'Conference', ...conference });
  return halves;
}

/** Every string an organizer wrote about a tier, as one lower-case haystack. */
function tierText(tier: Tier): string {
  const groupText = (tier.groups ?? []).flatMap((g) => [g.heading, ...(g.items ?? [])]);
  return [tier.name, tier.tagline, ...tier.includes, ...groupText].join(' · ').toLowerCase();
}

/**
 * Which days a ticket gets you, read out of its own copy.
 *
 * Ranges first ("Wednesday to Friday" has to fill Thursday, which no bare
 * mention of a day name would), then every day named on its own. `null` means
 * the tier never mentions a day — a new ticket whose copy talks about something
 * other than the calendar — and the page draws that across the whole week
 * without claiming days it cannot prove.
 */
export function tierDays(tier: Tier, week: WeekDay[]): boolean[] | null {
  const text = tierText(tier);
  const names = week.map((d) => d.key);
  const covered = week.map(() => false);
  let found = false;

  const range = new RegExp(
    `(${names.join('|')})\\s*(?:to|through|until|–|—|-)\\s*(${names.join('|')})`,
    'g',
  );
  for (const hit of text.matchAll(range)) {
    const from = names.indexOf(hit[1]);
    const to = names.indexOf(hit[2]);
    if (from < 0 || to < 0) continue;
    for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) {
      covered[i] = true;
      found = true;
    }
  }

  names.forEach((name, i) => {
    if (text.includes(name)) {
      covered[i] = true;
      found = true;
    }
  });

  return found ? covered : null;
}

export interface Run {
  from: number;
  to: number;
}

/** Contiguous blocks of days, so a ticket with a gap in it still draws right. */
export function runsOf(covered: boolean[]): Run[] {
  const runs: Run[] = [];
  let start = -1;
  covered.forEach((on, i) => {
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      runs.push({ from: start, to: i - 1 });
      start = -1;
    }
  });
  if (start >= 0) runs.push({ from: start, to: covered.length - 1 });
  return runs;
}

/** "Mon–Tue", "Wed–Fri", "Mon" — the label that sits inside a bar. */
export function runLabel(runs: Run[], week: WeekDay[]): string {
  return runs
    .map(({ from, to }) =>
      from === to ? week[from].short : `${week[from].short}–${week[to].short}`,
    )
    .join(' + ');
}

/** The same thing said out loud, for anyone not looking at the bars. */
export function runSentence(runs: Run[], week: WeekDay[]): string {
  return runs
    .map(({ from, to }) => {
      if (from === to) return week[from].long;
      /* Two days are "Monday and Tuesday"; three or more are a range. Said the
         other way round, a two-day range reads like a typo. */
      const join = to === from + 1 ? ' and ' : ' to ';
      return `${week[from].long}${join}${week[to].long}`;
    })
    .join(', and ');
}

export interface Separately {
  /** The cheapest set of other tickets that covers the same days. */
  parts: Tier[];
  totalCents: number;
  savingCents: number;
}

const bit = (covered: boolean[]) =>
  covered.reduce((acc, on, i) => (on ? acc | (1 << i) : acc), 0);

/**
 * What the same days would cost bought as separate tickets.
 *
 * This is the honest version of "most popular": no badge, no countdown, just
 * the arithmetic the catalogue already contains. It looks for the cheapest set
 * of *other* tickets of the same kind whose days do not overlap and which
 * together cover exactly this ticket's days — Workshops plus Main Conference,
 * for All Access — and reports the difference. If no such set exists, or the
 * bundle is not actually cheaper, nothing is claimed.
 */
export function boughtSeparately(
  tier: Tier,
  all: Tier[],
  week: WeekDay[],
): Separately | null {
  const mine = tierDays(tier, week);
  if (!mine) return null;
  const target = bit(mine);
  if (target === 0) return null;

  const candidates = all
    .filter(
      (t) =>
        t.id !== tier.id &&
        t.inPerson === tier.inPerson &&
        t.audience === tier.audience &&
        t.currency === tier.currency,
    )
    .map((t) => {
      const days = tierDays(t, week);
      return days ? { tier: t, mask: bit(days) } : null;
    })
    .filter((c): c is { tier: Tier; mask: number } => c !== null)
    /* A part has to fit inside what we are pricing: a ticket covering a day
       this one does not is a different purchase, not a component of it. */
    .filter((c) => c.mask !== 0 && (c.mask & ~target) === 0)
    .slice(0, 12);

  let best: { parts: Tier[]; total: number } | null = null;
  const walk = (i: number, mask: number, total: number, parts: Tier[]) => {
    if (mask === target && parts.length >= 2) {
      if (!best || total < best.total) best = { parts: [...parts], total };
      return;
    }
    if (i >= candidates.length) return;
    walk(i + 1, mask, total, parts);
    const c = candidates[i];
    /* Disjoint only. Two overlapping tickets would double-count a day, and
       "buy both and waste Wednesday" is not a comparison anyone would make. */
    if ((mask & c.mask) === 0) {
      parts.push(c.tier);
      walk(i + 1, mask | c.mask, total + c.tier.priceCents, parts);
      parts.pop();
    }
  };
  walk(0, 0, 0, []);

  if (!best) return null;
  const found = best as { parts: Tier[]; total: number };
  if (found.total <= tier.priceCents) return null;
  return {
    parts: found.parts,
    totalCents: found.total,
    savingCents: found.total - tier.priceCents,
  };
}

/** Whether a ticket reaches into both halves of the week. */
export function coversBothHalves(covered: boolean[], halves: Half[]): boolean {
  if (halves.length < 2) return false;
  return halves.every((h) => covered.slice(h.from, h.to + 1).some(Boolean));
}

/**
 * Is this the only in-person ticket that spans both halves?
 *
 * Asked of the data rather than asserted, because Virtual spans both halves
 * too — from a sofa. The claim the page prints is about being *in the room*,
 * and it is only printed when it is the answer this function gives.
 */
export function onlyInPersonAcrossTheWeek(
  tier: Tier,
  all: Tier[],
  week: WeekDay[],
  halves: Half[],
): boolean {
  const spanning = all.filter((t) => {
    if (!t.inPerson || t.audience !== tier.audience) return false;
    const days = tierDays(t, week);
    return days ? coversBothHalves(days, halves) : false;
  });
  return spanning.length === 1 && spanning[0].id === tier.id;
}

const STOP = new Set([
  'the','a','an','of','and','or','with','for','in','on','at','to','from','every','all','both',
  'your','you','own','is','it','its','more','plus','into','by','as','least','than','that','this',
  'their','our','we','us','any','each','also','other','including','include','includes','up','out',
]);

function tokens(line: string): Set<string> {
  return new Set(
    line
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      /* Crude plural folding: "sessions" and "session" are the same promise. */
      .map((w) => (w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)),
  );
}

/** Every promise made by a tier, as separate lines. */
function tierLines(tier: Tier): string[] {
  const grouped = (tier.groups ?? []).flatMap((g) => [g.heading, ...(g.items ?? [])]);
  return grouped.length > 0 ? grouped : tier.includes;
}

/**
 * The lines this ticket makes that no other ticket makes.
 *
 * Two tests, and a line has to pass both, because a false "only here" is the
 * one kind of dishonesty this page cannot afford. First: it must contain a word
 * that appears nowhere in any other tier's copy — "VIP" does, "recordings"
 * does. Second: no more than half of its meaningful words may already be
 * covered by some single line elsewhere, which is what disqualifies
 * "Recordings of every session" against Main Conference's "streamed on demand".
 * Between them, only the genuinely exclusive line survives.
 */
export function exclusiveLines(tier: Tier, all: Tier[], limit = 2): string[] {
  const others = all.filter((t) => t.id !== tier.id && t.audience === tier.audience);
  if (others.length === 0) return [];

  const elsewhereWords = new Set<string>();
  const elsewhereLines: Set<string>[] = [];
  for (const other of others) {
    for (const word of tokens(tierText(other))) elsewhereWords.add(word);
    for (const line of tierLines(other)) elsewhereLines.push(tokens(line));
  }

  const kept: string[] = [];
  for (const line of tierLines(tier)) {
    const words = [...tokens(line)];
    if (words.length < 3) continue;
    if (words.every((w) => elsewhereWords.has(w))) continue;
    const strongestMatch = elsewhereLines.reduce((best, other) => {
      const shared = words.filter((w) => other.has(w)).length;
      return Math.max(best, shared / words.length);
    }, 0);
    if (strongestMatch > 0.5) continue;
    kept.push(line);
    if (kept.length === limit) break;
  }
  return kept;
}
