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
 * **A registration is keyed by email address.** `registrationId(email)` is a
 * hash of the address, so N seats sharing one address are one registration and
 * one badge no matter what was charged. That is why multi-quantity checkout
 * cannot be a number on its own: three seats need three addresses, or the buyer
 * pays three times for one ticket and finds out at the door.
 *
 * It is also why a duplicate address is refused rather than merged. Merging
 * quietly takes money for a seat that will never exist, and the person who
 * discovers it is a colleague standing at registration without a badge.
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
  kind: 'empty' | 'too-many' | 'name' | 'email' | 'duplicate';
  /** The offending address, for the duplicate message. */
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
    .map((r) => ({ name: r.name.trim(), email: r.email.trim(), tierId: r.tierId.trim() }))
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
    if (!EMAIL.test(seat.email)) return { index: i, kind: 'email' };
  }

  /**
   * Duplicates, folded to lower case because `registrationId` folds too.
   * `Ada@Example.com` and `ada@example.com` are one registration, so a form
   * that accepted both would sell two seats and issue one badge.
   */
  const seen = new Set<string>();
  for (const [i, seat] of seats.entries()) {
    const key = seat.email.toLowerCase();
    if (seen.has(key)) return { index: i, kind: 'duplicate', email: seat.email };
    seen.add(key);
  }

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
