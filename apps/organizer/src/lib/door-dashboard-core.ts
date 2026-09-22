/**
 * The two breakdowns behind the live door dashboard: who came in, and when.
 *
 * Pure, and beside `checkin.ts` rather than inside it, for the reason AGENTS.md
 * gives: `checkin.ts` imports `server-only` and Vitest cannot load it, and the
 * arithmetic that turns a list of check-ins into the bars an organizer reads at
 * 08:55 is the part that can be wrong in a way nobody notices.
 *
 * ── Both charts answer a question the progress bar cannot ──────────────────
 *
 * The bar at the top of the check-in screen says how far through the queue the
 * desk is. It cannot say whether the queue is *moving*, and it cannot say that
 * every VIP has arrived while half the workshop tickets have not — which is the
 * difference between "we are behind" and "we are fine, the workshop starts at
 * eleven".
 */

export interface DoorCheckIn {
  /** The ticket on the registration, as the desk list shows it. */
  ticketType?: string;
  /** ISO instant, or null for a check-in written without one. */
  checkedInAt: string | null;
}

export interface DoorBar {
  label: string;
  count: number;
  /** Width as a share of the busiest bar in the same chart, 0–100. */
  pct: number;
}

export interface DoorDashboard {
  total: number;
  /**
   * Check-ins with no timestamp on them.
   *
   * They count toward the ticket-type chart and cannot appear on the hourly
   * one, so the page has to be able to say so. Silently dropping them would
   * make two charts of the same people disagree by a number nobody could
   * account for.
   */
  undated: number;
  /** Busiest ticket first. The chart is read top down for "who is here". */
  byTicket: DoorBar[];
  /** Chronological, including the quiet hours. */
  byHour: DoorBar[];
  /**
   * Stretches of empty hours too long to draw, left out of `byHour`.
   *
   * Greater than zero means the chart is not one continuous axis, and the page
   * has to say so rather than let two bars side by side imply two adjacent
   * hours.
   */
  skippedGaps: number;
  busiestHour: DoorBar | null;
  firstAt: string | null;
  lastAt: string | null;
}

/** Shown for a registration with no ticket recorded, which is not the same as none. */
export const NO_TICKET_LABEL = 'No ticket type';

/**
 * How many empty hours may be drawn between two check-ins.
 *
 * Zero-height bars for the quiet hours are the point of an hourly chart — a
 * chart that lists only the hours somebody arrived draws a flat, busy morning
 * out of two arrivals nine hours apart. But every empty hour is also a row in
 * the table beside the chart, and the page has to be scrolled past at the door.
 *
 * Thirty-six was a day and a half, which kept a whole night of nothing between
 * two mornings: 33 of 38 rows read zero, and the five that meant something were
 * spread over three screens. Half a day holds the case the rule exists for — a
 * quiet afternoon between a busy morning and a busy evening — and drops the
 * overnight, which nobody reads as continuous anyway. Past it the empty hours
 * go and the page says they went.
 */
export const MAX_EMPTY_HOURS = 12;

/**
 * The hour a moment falls in, in the venue's zone, as `YYYY-MM-DD HH`.
 *
 * The zone is passed in rather than read from the machine on purpose. An
 * organizer watching the door from a hotel in another timezone is looking at
 * the hours the venue is running, and the same chart rendered on a server in a
 * third zone must not be a third answer.
 */
function hourKey(iso: string, timeZone: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    timeZone,
  }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}`;
}

/** `2027-05-03 09` → `09:00`, or `Mon 09:00` when the chart spans more than one day. */
function hourLabel(key: string, withDay: boolean): string {
  const [day, hour] = key.split(' ');
  if (!withDay) return `${hour}:00`;
  const d = new Date(`${day}T12:00:00Z`);
  const name = Number.isNaN(d.getTime())
    ? day
    : new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(d);
  return `${name} ${hour}:00`;
}

/** The next hour after `YYYY-MM-DD HH`, in plain calendar terms. */
function nextHour(key: string): string {
  const [day, hour] = key.split(' ');
  const h = Number(hour);
  if (h < 23) return `${day} ${String(h + 1).padStart(2, '0')}`;
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)} 00`;
}

function bars(counts: Map<string, number>, order: string[]): DoorBar[] {
  const peak = Math.max(1, ...[...counts.values()]);
  return order.map((label) => {
    const count = counts.get(label) ?? 0;
    return { label, count, pct: Math.round((count / peak) * 100) };
  });
}

export function doorDashboard(checkIns: DoorCheckIn[], timeZone: string): DoorDashboard {
  const stamps = checkIns
    .map((c) => c.checkedInAt)
    .filter((at): at is string => Boolean(at))
    .sort();

  const ticketCounts = new Map<string, number>();
  for (const c of checkIns) {
    const label = c.ticketType?.trim() || NO_TICKET_LABEL;
    ticketCounts.set(label, (ticketCounts.get(label) ?? 0) + 1);
  }
  /*
   * Busiest first, then alphabetically. The tie-break is not decoration: two
   * ticket types on the same count swapping places between two page loads is
   * how a chart that is telling the truth manages to look broken.
   */
  const ticketOrder = [...ticketCounts.keys()].sort(
    (a, b) => (ticketCounts.get(b) ?? 0) - (ticketCounts.get(a) ?? 0) || a.localeCompare(b),
  );

  const hourCounts = new Map<string, number>();
  for (const at of stamps) {
    const key = hourKey(at, timeZone);
    if (!key) continue;
    hourCounts.set(key, (hourCounts.get(key) ?? 0) + 1);
  }

  const present = [...hourCounts.keys()].sort();
  const hourOrder: string[] = [];
  let skippedGaps = 0;
  for (let i = 0; i < present.length; i++) {
    hourOrder.push(present[i]);
    const nextPresent = present[i + 1];
    if (!nextPresent) break;

    /*
     * Fill the gap, or refuse it whole. Filling the first thirty-six hours of
     * an eight-month gap and then jumping to the next arrival would draw a
     * chart whose axis lies about the distance between two bars, which is
     * worse than a chart that says it has left a gap out.
     */
    const empties: string[] = [];
    for (let k = nextHour(present[i]); k !== nextPresent; k = nextHour(k)) {
      empties.push(k);
      if (empties.length > MAX_EMPTY_HOURS) break;
    }
    if (empties.length > MAX_EMPTY_HOURS) skippedGaps++;
    else hourOrder.push(...empties);
  }

  const spansDays = new Set(present.map((k) => k.slice(0, 10))).size > 1;
  const hourBars = bars(
    new Map(hourOrder.map((k) => [hourLabel(k, spansDays), hourCounts.get(k) ?? 0])),
    hourOrder.map((k) => hourLabel(k, spansDays)),
  );

  const busiest = hourBars.reduce<DoorBar | null>(
    (best, b) => (best === null || b.count > best.count ? b : best),
    null,
  );

  return {
    total: checkIns.length,
    undated: checkIns.length - stamps.length,
    byTicket: bars(ticketCounts, ticketOrder),
    byHour: hourBars,
    skippedGaps,
    busiestHour: busiest && busiest.count > 0 ? busiest : null,
    firstAt: stamps[0] ?? null,
    lastAt: stamps[stamps.length - 1] ?? null,
  };
}
