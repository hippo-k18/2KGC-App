/**
 * Price phases: Super Early Bird, Early Bird, Standard, Extended.
 *
 * ── Why the price moves by itself ───────────────────────────────────────────
 *
 * Every ticket used to carry one flat `priceCents`, so moving from Early Bird
 * to Standard meant an organizer editing three prices by hand on the morning of
 * 1 December, and a price nobody remembered to edit is a ticket sold at last
 * season's rate. A ticket type now carries its whole ladder, each rung with the
 * day it starts, and the price charged is worked out from the clock on the
 * server at the moment of checkout.
 *
 * ── Days, not instants ──────────────────────────────────────────────────────
 *
 * A phase starts on a calendar day in the ticket's sales time zone (New York),
 * and the comparison is between two `YYYY-MM-DD` strings. That is deliberate:
 * "Standard starts 1 December" means midnight Eastern, and comparing day
 * strings in the event's zone is the one formulation that cannot slip by the
 * host's UTC offset. `ticketTypes.salesOpenAt` learned that lesson the hard way.
 *
 * ── Pure, and shared ────────────────────────────────────────────────────────
 *
 * The website charges from this and the dashboard displays from it, and they
 * are separate installs. One copy here means the dashboard cannot show a price
 * the website does not charge.
 */

/** One rung of a ticket's price ladder. */
export interface PricePhase {
  /** Printed on the tickets page: "Early Bird". */
  name: string;
  /**
   * Minor units. Absent means no price has been agreed for this phase yet, and
   * a phase without a price is never on sale, whatever else it says.
   */
  priceCents?: number;
  /**
   * First day of the phase, `YYYY-MM-DD`, in the ticket's sales time zone. The
   * phase runs until the next dated phase starts. A phase with no date can only
   * be a closed one (`soldOut`).
   */
  startsOn?: string;
  /** Closed early. Shown with its price struck through and "Sold Out". */
  soldOut?: boolean;
  /**
   * Not sold during this phase, even though the phase is current. This is how
   * an add-on whose Early Bird price is unconfirmed stays off the checkout
   * until somebody sets one.
   */
  offSale?: boolean;
}

/** What a ticket costs right now, and what the tickets page says around it. */
export interface PriceNow {
  /** What checkout charges. Only meaningful while `onSale`. */
  priceCents: number;
  /** The current phase's name, when the ticket has phases. */
  phase?: string;
  onSale: boolean;
  unavailableReason?: string;
  /** Phases before the current one that had a price, for the struck-through line. */
  earlier: { name: string; priceCents: number; soldOut: boolean }[];
  /** The day the next phase starts, when it is dearer or not yet priced. */
  risesOn?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a `YYYY-MM-DD` names a day that exists. `Date.parse` rolls
 * 2027-02-30 over to 2 March rather than refusing it, so the date is rebuilt
 * and compared instead.
 */
function realDay(day: string): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/** `2026-11-30`, as the calendar reads in `timeZone` at `now`. */
export function dayInZone(now: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which is the only reason it is used here.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The price a ticket sells at on `now`.
 *
 * A ticket with no phases sells at its flat `priceCents`, which is every
 * ticket written before phases existed, and every exhibitor and sponsor
 * package. With phases, the current one is the last phase in the list that has
 * started and is not sold out.
 */
export function priceNow(
  t: { priceCents: number; pricePhases?: PricePhase[] },
  now: Date,
  timeZone: string,
): PriceNow {
  const phases = t.pricePhases ?? [];
  if (phases.length === 0) return { priceCents: t.priceCents, onSale: true, earlier: [] };

  const today = dayInZone(now, timeZone);
  const started = (p: PricePhase) => p.startsOn !== undefined && p.startsOn <= today;

  let current = -1;
  phases.forEach((p, i) => {
    if (started(p) && !p.soldOut) current = i;
  });

  const earlierOf = (upTo: number) =>
    phases
      .slice(0, upTo)
      .filter((p) => typeof p.priceCents === "number")
      .map((p) => ({ name: p.name, priceCents: p.priceCents!, soldOut: p.soldOut === true }));

  if (current === -1) {
    /*
     * Nothing current: either nothing has started, or everything that has is
     * sold out. Either way nothing is sold, and the figure carried is the
     * first priced phase still to come, for display only.
     */
    const ahead = phases.find((p) => !started(p) && !p.soldOut && typeof p.priceCents === "number");
    const closed = phases.filter((p) => started(p) || p.soldOut).length;
    return {
      priceCents: ahead?.priceCents ?? t.priceCents,
      onSale: false,
      unavailableReason: closed > 0 && !ahead ? "Sold out" : "Not on sale yet",
      earlier: earlierOf(closed),
    };
  }

  const phase = phases[current];
  const next = phases.slice(current + 1).find((p) => p.startsOn !== undefined && p.startsOn > today);
  const rises =
    next && (next.priceCents === undefined || phase.priceCents === undefined || next.priceCents > phase.priceCents);
  const priced = typeof phase.priceCents === "number";
  return {
    priceCents: priced ? phase.priceCents! : t.priceCents,
    phase: phase.name,
    onSale: priced && !phase.offSale,
    ...(priced && !phase.offSale ? {} : { unavailableReason: "Not on sale yet" }),
    earlier: earlierOf(current),
    ...(rises ? { risesOn: next!.startsOn } : {}),
  };
}

/** "December", from `2026-12-01`. Read at noon UTC so no zone can move the month. */
export function monthName(day: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

// ---------------------------------------------------------------------------
// The dashboard's text box
// ---------------------------------------------------------------------------

/**
 * The phases as the dashboard's text box shows them, one per line:
 *
 *   Super Early Bird: 599, sold out
 *   Early Bird: 699, from 2026-09-15
 *   Standard: 899, from 2026-12-01
 *
 * Whole dollars in, cents stored, the same rule as the Price box beside it.
 */
export function pricePhasesToText(phases: PricePhase[] | undefined): string {
  return (phases ?? [])
    .map((p) => {
      const parts: string[] = [];
      if (typeof p.priceCents === "number") parts.push(wholeUnits(p.priceCents));
      if (p.startsOn) parts.push(`from ${p.startsOn}`);
      if (p.soldOut) parts.push("sold out");
      if (p.offSale) parts.push("off sale");
      return `${p.name}: ${parts.join(", ")}`;
    })
    .join("\n");
}

function wholeUnits(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * Read the text box back, or say which line is wrong.
 *
 * Strict on purpose. This decides what a card is charged, so a line that could
 * mean two things is refused rather than guessed at.
 */
export function parsePricePhases(
  text: string,
): { ok: true; phases: PricePhase[] } | { ok: false; error: string } {
  const phases: PricePhase[] = [];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const [i, line] of lines.entries()) {
    const n = i + 1;
    const colon = line.indexOf(":");
    if (colon < 1) return { ok: false, error: `Line ${n} needs a name, then a colon: "Early Bird: 699, from 2026-09-15".` };
    const phase: PricePhase = { name: line.slice(0, colon).trim() };

    // "1,099" is a thousands separator, not two fields.
    const body = line.slice(colon + 1).replace(/(\d),(\d{3})\b/g, "$1$2");
    for (const raw of body.split(",")) {
      const part = raw.trim().toLowerCase();
      if (!part) continue;
      if (part === "sold out") phase.soldOut = true;
      else if (part === "off sale") phase.offSale = true;
      else if (part.startsWith("from ")) {
        const day = part.slice(5).trim();
        if (!DAY.test(day)) {
          return { ok: false, error: `Line ${n}: write the start date as YYYY-MM-DD.` };
        }
        if (!realDay(day)) {
          return { ok: false, error: `Line ${n}: ${day} is not a real date.` };
        }
        phase.startsOn = day;
      } else {
        const cleaned = part.replace(/[$,\s]/g, "");
        if (!/^\d+(\.\d{1,2})?$/.test(cleaned) || phase.priceCents !== undefined) {
          return { ok: false, error: `Line ${n}: "${raw.trim()}" is not a price, "from YYYY-MM-DD", "sold out" or "off sale".` };
        }
        phase.priceCents = Math.round(Number(cleaned) * 100);
      }
    }

    if (!phase.startsOn && !phase.soldOut) {
      return { ok: false, error: `Line ${n}: give ${phase.name} a start date, or mark it sold out.` };
    }
    if (phase.priceCents === undefined && !phase.offSale) {
      return { ok: false, error: `Line ${n}: give ${phase.name} a price, or mark it off sale.` };
    }
    phases.push(phase);
  }

  const dated = phases.filter((p) => p.startsOn);
  for (let i = 1; i < dated.length; i++) {
    if (dated[i].startsOn! <= dated[i - 1].startsOn!) {
      return { ok: false, error: `${dated[i].name} must start after ${dated[i - 1].name}.` };
    }
  }
  return { ok: true, phases };
}

// ---------------------------------------------------------------------------
// The buyer fee
// ---------------------------------------------------------------------------

/**
 * The fee the team proposed adding on top of the ticket price. Not confirmed,
 * so `settings/branding.chargeBuyerFee` is off by default and nothing charges it
 * until an organizer switches it on.
 */
export const BUYER_FEE_PERCENT = 6.24;

/** The fee on a subtotal, in minor units, rounded to the nearest cent. */
export function buyerFeeCents(subtotalCents: number, percent = BUYER_FEE_PERCENT): number {
  return Math.round((subtotalCents * percent) / 100);
}
