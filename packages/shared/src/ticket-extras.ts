/**
 * Extra tickets: a ticket sold on its own that is added to the holder's
 * existing badge instead of issuing a second one.
 *
 * Workshops is the first (2026-10-06). Somebody who bought Main Conference in
 * October and Workshops in December is one person with one badge, one QR code
 * and one row on the dashboard, labelled "Main Conference + Workshops". The
 * registration keeps `ticketType` as the admission ticket and lists the extras
 * beside it (`RegistrationDoc.extras` / `extraNames`).
 *
 * Since 2026-10-07 Workshops is also sold without any conference ticket. Such a
 * person has a Workshops-only badge (`ticketType: "Workshops"`, no extras), and
 * a conference ticket bought later joins that badge, with Workshops moving into
 * `extras` beside it. Whichever ticket comes second joins the first.
 *
 * Pure, so the website's checkout, the webhook's fulfilment, the dashboard's
 * manual orders and the tests all ask the same question the same way.
 */

/** Whatever a caller knows about the tickets one person holds. */
export type TicketsHeld = string | readonly string[] | null | undefined;

/** The names in a `TicketsHeld`, blanks dropped. */
export function ticketNames(held: TicketsHeld): string[] {
  if (typeof held === "string") return held ? [held] : [];
  return (held ?? []).filter((n): n is string => typeof n === "string" && n.length > 0);
}

/** The registration fields that say what a person holds. */
export interface HeldTickets {
  ticketType?: string | null;
  extraNames?: string[] | null;
}

/** Every ticket name a registration holds: the admission ticket first, then its extras. */
export function heldTicketNames(reg: HeldTickets | null | undefined): string[] {
  if (!reg) return [];
  const names = [reg.ticketType ?? "", ...(Array.isArray(reg.extraNames) ? reg.extraNames : [])];
  return [...new Set(names.filter((n) => typeof n === "string" && n.length > 0))];
}

/**
 * How a person's tickets read on a badge, an attendee row or the check-in
 * screen: "Main Conference + Workshops". Just the ticket name when there are no
 * extras, and `fallback` when there is nothing at all.
 */
export function ticketLabel(reg: HeldTickets | null | undefined, fallback = ""): string {
  const names = heldTicketNames(reg);
  return names.length > 0 ? names.join(" + ") : fallback;
}

/** The catalogue fields this file reasons about. */
export interface ExtraTierShape {
  id: string;
  name: string;
  kind?: "admission" | "extra";
  addOnFor?: string;
  bundleOf?: string[];
  includesWorkshops?: boolean;
  inPerson?: boolean;
}

export function isExtraTier(tier: { kind?: string } | null | undefined): boolean {
  return tier?.kind === "extra";
}

/**
 * Whether a badge's ticket is itself an extra: a Workshops-only badge, whose
 * `ticketType` is "Workshops" because the holder has no admission ticket.
 */
function isExtraName(name: string | null | undefined, tierByName: (name: string) => ExtraTierShape | undefined): boolean {
  return Boolean(name && isExtraTier(tierByName(name)));
}

/** Whether an admission ticket already gives what the extra sells (All Access includes the workshops). */
export function admissionIncludes(extra: ExtraTierShape, admission: ExtraTierShape | undefined): boolean {
  return Boolean(admission && !isExtraTier(admission) && extra.includesWorkshops && admission.includesWorkshops);
}

/** One of a person's existing registrations, as far as this decision needs it. */
export interface ExtraCandidate {
  registrationId: string;
  status: string;
  ticketType?: string | null;
  extras?: { tierId: string }[] | null;
  /** Milliseconds. The newest qualifying badge wins. */
  createdAtMs?: number;
}

export type ExtraRefusal =
  /** Holds a ticket that already includes it, such as All Access. */
  | "included"
  /** Already has this extra, on a badge with another ticket or as a badge of its own. */
  | "already";

export type ExtraVerdict =
  /**
   * `registrationId` is the badge the extra goes on. Absent when the person
   * holds no other ticket: the extra is then a badge of its own (a
   * Workshops-only badge, since 2026-10-07).
   */
  | { ok: true; registrationId?: string }
  | { ok: false; reason: ExtraRefusal; heldName?: string; registrationId?: string };

/**
 * Where an extra goes, or why it cannot be sold to this person.
 *
 * Workshops and the conference tickets are independent since 2026-10-07
 * (owner): anybody can buy Workshops, with or without Main Conference. One
 * person still has one badge, so Workshops joins the newest active badge
 * holding an admission ticket (Main Conference, Virtual, or any other ticket
 * that does not already include it). With none, it is a badge of its own.
 *
 * Refused, before any money moves:
 *  - a person whose ticket includes it already (All Access), so they are not
 *    charged for something they have;
 *  - a person who already has it, on a badge or as a Workshops-only badge.
 */
export function chooseExtraBase(
  extra: ExtraTierShape,
  candidates: ExtraCandidate[],
  tierByName: (name: string) => ExtraTierShape | undefined,
): ExtraVerdict {
  const active = candidates.filter((c) => c.status === "active");
  for (const c of active) {
    const admission = c.ticketType ? tierByName(c.ticketType) : undefined;
    if (admissionIncludes(extra, admission)) {
      return { ok: false, reason: "included", heldName: admission!.name };
    }
  }
  const newest = [...active].sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  const holding = newest.find(
    (c) => c.ticketType === extra.name || (c.extras ?? []).some((e) => e.tierId === extra.id),
  );
  if (holding) return { ok: false, reason: "already", registrationId: holding.registrationId };
  const fitting = newest.find((c) => c.ticketType && !isExtraName(c.ticketType, tierByName));
  return fitting ? { ok: true, registrationId: fitting.registrationId } : { ok: true };
}

/**
 * The badge an admission ticket joins instead of issuing a second one: the
 * newest active badge that holds only an extra (Workshops bought first, Main
 * Conference later). Null when there is none, and the admission ticket is
 * issued as it always was. The symmetric half of `chooseExtraBase`.
 */
export function chooseExtraOnlyBadge(
  candidates: ExtraCandidate[],
  tierByName: (name: string) => ExtraTierShape | undefined,
): string | null {
  const badge = candidates
    .filter((c) => c.status === "active" && isExtraName(c.ticketType, tierByName))
    .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))[0];
  return badge?.registrationId ?? null;
}

/**
 * Whether a badge admits only to what an extra sells: a Workshops-only badge.
 * The door scanner shows such a badge a "Workshops only" notice.
 */
export function isExtraOnlyBadge(
  reg: HeldTickets | null | undefined,
  extraNames: ReadonlySet<string> | readonly string[],
): boolean {
  const names = extraNames instanceof Set ? extraNames : new Set(extraNames as readonly string[]);
  return Boolean(reg?.ticketType && names.has(reg.ticketType));
}

/** A seat on one purchase, as far as the cart rule needs it. */
export interface CartSeatShape {
  email: string;
  tierId: string;
}

/**
 * What the rest of a cart does for one extra seat: refused by a second copy
 * of the same extra or by an admission seat that includes it, otherwise fine
 * (it joins that person's admission seat when there is one, and is a badge of
 * its own when not). The person's existing tickets are asked separately.
 */
export function cartVerdictForExtra(
  extra: ExtraTierShape,
  seatIndex: number,
  seats: CartSeatShape[],
  tierById: (id: string) => ExtraTierShape | undefined,
): { covered: true } | { covered: false; refusal?: ExtraRefusal; heldName?: string } {
  const email = seats[seatIndex]!.email.trim().toLowerCase();
  const same = seats.filter((s, i) => i !== seatIndex && s.email.trim().toLowerCase() === email);
  const sameExtra = seats.findIndex((s) => s.email.trim().toLowerCase() === email && s.tierId === extra.id);
  if (sameExtra !== seatIndex) return { covered: false, refusal: "already" };
  const admissions = same.map((s) => tierById(s.tierId)).filter((t) => t && !isExtraTier(t));
  const including = admissions.find((t) => admissionIncludes(extra, t));
  if (including) return { covered: false, refusal: "included", heldName: including.name };
  if (admissions.length > 0) return { covered: true };
  return { covered: false };
}

/**
 * Seats put in the order fulfilment needs: for each person, admission tickets
 * before extras, so the badge exists by the time its extra is added. Seat one
 * stays the buyer: if the buyer's own seat is an extra and the cart also buys
 * them an admission ticket, the two seats swap tickets, which changes neither
 * the person nor the price.
 */
export function orderSeatsForExtras<T extends { email: string; tierId: string }>(
  seats: T[],
  isExtra: (tierId: string) => boolean,
): T[] {
  if (seats.length < 2) return seats;
  const out = seats.map((s) => ({ ...s }));
  const buyer = out[0]!;
  if (isExtra(buyer.tierId)) {
    const email = buyer.email.trim().toLowerCase();
    const j = out.findIndex((s, i) => i > 0 && s.email.trim().toLowerCase() === email && !isExtra(s.tierId));
    if (j > 0) {
      const tier = buyer.tierId;
      buyer.tierId = out[j]!.tierId;
      out[j]!.tierId = tier;
    }
  }
  const rest = out.slice(1);
  return [buyer, ...rest.filter((s) => !isExtra(s.tierId)), ...rest.filter((s) => isExtra(s.tierId))];
}
