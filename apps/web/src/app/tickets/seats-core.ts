/**
 * Seats on one purchase: reading them off a form, checking them, and grouping
 * them into the line items Stripe is asked to charge for.
 *
 * ── Why this file is pure ───────────────────────────────────────────────────
 *
 * No `server-only`, no Firestore, no Stripe. `startCheckout` and
 * `requestInvoice` are both server actions and neither can be loaded by Vitest,
 * so before this existed the only way to pin "two seats on one address is one
 * badge" was to re-implement the rule beside the real one in the test — the
 * same trap `refund-core.ts` was split out to escape, where the copy in the
 * test agrees with itself for ever while the real one drifts.
 *
 * ── The one fact that shapes everything below ───────────────────────────────
 *
 * **Each seat is its own ticket.** Since 2026-09-26 seats may share an
 * address: every paid seat becomes a separate registration with its own badge
 * (`purchaseRegistrationId`), and the dashboard flags an address holding more
 * than one. Before that a shared address was refused, because it merged into
 * one badge while charging for several.
 *
 * ── Seats and line items are different shapes, deliberately ─────────────────
 *
 * A **seat** is a person: one name, one address, one tier. The order document
 * records one `OrderLine` per seat with `quantity: 1`, because `OrderLine`
 * carries a single `attendeeEmail` and a line of three seats could name only
 * one of the three people. That is exactly how the invoice path already writes
 * them, and it is why `decideRefund` gives three seats back rather than one.
 *
 * A **Stripe line item** is money: one price, charged N times. Three seats on
 * the same tier are one line item with `quantity: 3`, so the buyer sees
 * "Main Conference × 3" on the Stripe page and on their receipt instead of
 * three identical rows, and so the amount is Stripe's arithmetic rather than
 * ours.
 */

/**
 * Whova's own group form caps at 100. Ten is the cap here and on the invoice
 * form, for the same reason: past ten seats a company is having a conversation
 * with the organizers, not filling in a web form, and the failure mode of a
 * long form is a half-typed seat list abandoned at seat seven.
 */
export const MAX_SEATS = 10;

/**
 * Deliberately the same expression as the one `startCheckout` and
 * `requestInvoice` each used to keep privately. It is not a validator — no
 * regex is — it is a typo catch, and the address is proved by the ticket email
 * arriving at it.
 */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The longest name and address a seat may carry.
 *
 * A name goes into Stripe metadata, which refuses any value over 500
 * characters; a 600-character name used to reach Stripe and come back as "We
 * could not reach the payment processor", which was the wrong reason (T135,
 * S6/TK-031). 120 is far beyond any real name. 254 is the longest address
 * SMTP allows. The inputs carry the same `maxLength`.
 */
export const MAX_NAME = 120;
export const MAX_EMAIL = 254;

/**
 * A name as typed, made safe to print anywhere: control characters (a pasted
 * line break above all) become spaces, runs of spaces collapse, and the ends
 * are trimmed. "  Ada" greeted its owner as "Hi ," (T135B, TK-228), and a line
 * break in a name or company reached an email subject and Stripe (TK-227).
 */
export function cleanText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** One person on one purchase. */
export interface SeatInput {
  name: string;
  email: string;
  /** A `ticketTypes` document id. Never a price — the server looks that up. */
  tierId: string;
}

/**
 * What is wrong with a seat list, as data rather than as a sentence.
 *
 * The two callers word the same problem differently and both are right:
 * `/tickets/invoice` says "Attendee 3: enter a full name" because every row is
 * a colleague, while `/tickets` says "Enter the attendee's full name" for seat
 * one, which is the buyer's own name field and is not numbered on screen.
 * Returning the fault rather than the prose lets each say its own version
 * without a second copy of the rule.
 */
export interface SeatProblem {
  /** Zero-based. Seat 0 is the buyer on the Checkout form. */
  index: number;
  kind: 'empty' | 'too-many' | 'name' | 'name-long' | 'email';
  /** The offending address, where there is one. */
  email?: string;
}

/**
 * Drop blank rows, keep the rest in order.
 *
 * Rows where every field is empty are dropped rather than rejected: both forms
 * render spare rows, and making somebody delete an untouched one before they
 * can pay is hostile at the exact moment they are least inclined to tolerate
 * it. A row with *anything* in it is kept, so a half-filled row is a validation
 * error rather than a silently discarded colleague — which is the failure that
 * matters, because the buyer would have been charged for a seat nobody sees.
 */
export function collectSeats(rows: SeatInput[]): SeatInput[] {
  return rows
    .map((r) => ({ name: cleanText(r.name), email: r.email.trim(), tierId: r.tierId.trim() }))
    .filter((r) => r.name || r.email);
}

/**
 * The shape checks, in the order a person would find them.
 *
 * Returns the first problem or `null`. Tier existence, availability and price
 * are *not* checked here — those need Firestore and belong to the caller, which
 * is also the only place allowed to turn a tier id into money.
 */
export function validateSeats(seats: SeatInput[]): SeatProblem | null {
  if (seats.length === 0) return { index: 0, kind: 'empty' };
  if (seats.length > MAX_SEATS) return { index: MAX_SEATS, kind: 'too-many' };

  for (const [i, seat] of seats.entries()) {
    if (seat.name.length < 2) return { index: i, kind: 'name' };
    if (seat.name.length > MAX_NAME) return { index: i, kind: 'name-long' };
    if (seat.email.length > MAX_EMAIL || !EMAIL.test(seat.email)) return { index: i, kind: 'email' };
  }

  // A repeated address is allowed since 2026-09-26: each seat becomes its own
  // ticket (see `purchaseRegistrationId`), and the dashboard flags the address.
  return null;
}

/** One Stripe line item: a tier, the seats on it, and how many that is. */
export interface SeatLine {
  tierId: string;
  quantity: number;
  seats: SeatInput[];
}

/**
 * Group seats into line items by tier, first appearance first.
 *
 * The ordering is not cosmetic. Seat one is the buyer, so the tier they chose
 * leads the Stripe page and their receipt; a `Map` keyed by tier id preserves
 * insertion order, which is why this is not a sort.
 *
 * This is where "quantity" finally becomes a real number. The Checkout session
 * used to hard-code `quantity: 1` on a single line item, which is why buying
 * three seats meant paying three times and why a tier per combination was the
 * only way to sell an extra alongside a ticket.
 */
export function groupSeatsIntoLines(seats: SeatInput[]): SeatLine[] {
  const byTier = new Map<string, SeatLine>();
  for (const seat of seats) {
    const line = byTier.get(seat.tierId);
    if (line) {
      line.quantity += 1;
      line.seats.push(seat);
    } else {
      byTier.set(seat.tierId, { tierId: seat.tierId, quantity: 1, seats: [seat] });
    }
  }
  return [...byTier.values()];
}

/**
 * How many seats each tier is being asked for, so the caller can compare that
 * with what is left rather than only with "is it on sale".
 *
 * The distinction the capacity check needs: `onSale` answers "is there at least
 * one seat", which is the only question a single-seat purchase could ask. A
 * three-seat purchase against a tier with one seat left passes that check and
 * oversells by two, and the person who finds out is standing at the door.
 */
export function seatsPerTier(seats: SeatInput[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const seat of seats) counts.set(seat.tierId, (counts.get(seat.tierId) ?? 0) + 1);
  return counts;
}

/**
 * Split a total across seats: even shares, with the remainder on the first.
 *
 * Used to tell each attendee what their seat cost on their own confirmation
 * email, from one figure Stripe reports for the whole payment.
 *
 * Plain division loses cents. $1,000 across three seats is 33333 each and one
 * cent short of what was actually charged; the person reconciling it notices,
 * and "our records are a cent off yours" is a slow conversation to have with a
 * finance department. Giving the remainder to the first seat keeps the sum
 * exact, which is the only property that matters — nobody is owed a fairer
 * distribution of one cent.
 *
 * ⚠️ Split from the **total**, not from the tier prices, and the difference is
 * the point: tax and any promotion code are Stripe's arithmetic and appear only
 * on the total. Summing `unitPriceCents` would email four people a set of
 * figures that do not add up to their receipt.
 */
export function splitAcrossSeats(totalCents: number, seats: number): number[] {
  if (seats <= 0) return [];
  const per = Math.floor(totalCents / seats);
  const remainder = totalCents - per * seats;
  return Array.from({ length: seats }, (_, i) => per + (i === 0 ? remainder : 0));
}

/**
 * Split a total in proportion to what each seat was charged, with the
 * rounding remainder on the first seat so the shares add up exactly.
 *
 * Even shares were fine while every seat on a purchase cost the same. A group
 * rate, a Virtual seat beside four in-person ones, or a bundle with add-ons
 * makes them differ, and each attendee's confirmation should name what their
 * own seat cost, with any promotion code spread the same way. Falls back to
 * even shares when there are no weights to go on.
 */
export function splitByWeight(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return splitAcrossSeats(totalCents, weights.length);
  const shares = weights.map((w) => Math.floor((totalCents * Math.max(0, w)) / sum));
  shares[0] += totalCents - shares.reduce((a, b) => a + b, 0);
  return shares;
}

// ---------------------------------------------------------------------------
// The group rate
// ---------------------------------------------------------------------------

/**
 * Five or more in-person tickets in one checkout take 10% off each of them
 * (owner, 2026-10-04). The two numbers live here and nowhere else.
 */
export const GROUP_RATE_MIN_SEATS = 5;
export const GROUP_RATE_PERCENT = 10;

/** What the group rate reads from a tier. */
export type GroupRateTier = { inPerson?: boolean; audience?: string; kind?: string };

/**
 * Whether a seat's ticket counts towards the group rate and gets it: an
 * attendee ticket for the room, so All Access, Main Conference and the Main
 * Conference bundle with CEUs. Virtual does not, and nor do exhibitor and
 * sponsor packages, which are priced by contract. Nor does an extra such as
 * Workshops (owner, 2026-10-06): five Workshops do not earn 10%, and a
 * Workshops seat beside four Main Conference seats does not make five.
 *
 * Read from the catalogue's own `inPerson`, `audience` and `kind`, never from
 * the form, so a tampered post cannot buy itself the rate.
 */
export function countsForGroupRate(tier: GroupRateTier | undefined): boolean {
  return Boolean(tier?.inPerson) && (tier?.audience ?? 'attendee') === 'attendee' && tier?.kind !== 'extra';
}

/** Whether a set of seats earns the group rate. */
export function groupRateApplies(tiers: (GroupRateTier | undefined)[]): boolean {
  return tiers.filter(countsForGroupRate).length >= GROUP_RATE_MIN_SEATS;
}

/**
 * One seat's price at the group rate: the discount is worked out on the seat's
 * own price, add-ons included, and rounded to the cent. Every seat on the same
 * ticket therefore costs the same, which is what lets a Stripe line keep one
 * unit price.
 */
export function groupRatePrice(priceCents: number): { priceCents: number; discountCents: number } {
  const discountCents = Math.round((priceCents * GROUP_RATE_PERCENT) / 100);
  return { priceCents: priceCents - discountCents, discountCents };
}

/**
 * What each seat costs, list price and charged price, with the rate applied
 * where it is due. One function for the form's total, the Stripe lines and the
 * order record, so the three cannot disagree.
 */
export function priceSeats<T extends GroupRateTier & { priceCents: number }>(
  seatTiers: T[],
): { applies: boolean; seats: { listCents: number; discountCents: number; chargedCents: number }[]; discountCents: number } {
  const applies = groupRateApplies(seatTiers);
  const seats = seatTiers.map((t) => {
    const rated = applies && countsForGroupRate(t) ? groupRatePrice(t.priceCents) : { priceCents: t.priceCents, discountCents: 0 };
    return { listCents: t.priceCents, discountCents: rated.discountCents, chargedCents: rated.priceCents };
  });
  return { applies, seats, discountCents: seats.reduce((n, s) => n + s.discountCents, 0) };
}

/**
 * How many seats each tier actually sold, given what fulfilment did with them.
 *
 * ⚠️ **This is the arithmetic that made `quantitySold` wrong for a group.** The
 * webhook used to increment by one per Checkout session, which was right while
 * a session was one ticket; a three-seat purchase then took one seat off a
 * capped tier instead of three, and a tier with fifty seats could sell a
 * hundred and fifty. The person who discovers that is standing at the door on
 * the morning of day one.
 *
 * `created` is the replay guard and it is per seat, not per event.
 * `ensureRegistration` reports whether *this* delivery created the
 * registration, so a redelivery three days later — Stripe retries for that long
 * — contributes nothing and the counter does not move twice.
 *
 * ⚠️ A seat belonging to somebody who **already** holds a registration is
 * therefore not counted: an attendee imported from the Whova export, or a
 * repeat buyer. That is the pre-existing behaviour of the single-seat path
 * rather than something new, and it errs towards undercounting sales, which is
 * the safe direction for a check whose failure is overselling a room.
 */
export function seatsToCount(
  results: { created: boolean; ticketTypeId?: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of results) {
    if (!r.created || !r.ticketTypeId) continue;
    counts.set(r.ticketTypeId, (counts.get(r.ticketTypeId) ?? 0) + 1);
  }
  return counts;
}
