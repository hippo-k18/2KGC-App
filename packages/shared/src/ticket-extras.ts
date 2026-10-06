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
 * Whether an admission ticket is the one an extra needs: the required tier
 * itself, or a bundle built on it ("Main Conference + Continuing education
 * units" is still Main Conference).
 */
export function admissionSatisfies(extra: ExtraTierShape, admission: ExtraTierShape | undefined): boolean {
  if (!admission || !extra.addOnFor) return false;
  return admission.id === extra.addOnFor || admission.bundleOf?.[0] === extra.addOnFor;
}

/** Whether an admission ticket already gives what the extra sells (All Access includes the workshops). */
export function admissionIncludes(extra: ExtraTierShape, admission: ExtraTierShape | undefined): boolean {
  return Boolean(admission && extra.includesWorkshops && admission.includesWorkshops);
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
  /** Holds no ticket of the kind the extra needs. */
  | "no-base"
  /** Holds only a ticket that cannot take the extra, such as Virtual. */
  | "wrong-ticket"
  /** Holds a ticket that already includes it, such as All Access. */
  | "included"
  /** Already has this extra on their badge. */
  | "already";

export type ExtraVerdict =
  | { ok: true; registrationId: string }
  | { ok: false; reason: ExtraRefusal; heldName?: string; registrationId?: string };

/**
 * Which of a person's badges an extra goes on, or why it cannot go on any.
 *
 * Only active registrations count. Among those that hold the required
 * admission ticket, the newest is chosen, so somebody holding two Main
 * Conference tickets on one address gets Workshops on the one bought last.
 * A person whose tickets include the extra already (All Access) is refused
 * before anything else, so they are not charged for something they have.
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
  const fitting = active
    .filter((c) => admissionSatisfies(extra, c.ticketType ? tierByName(c.ticketType) : undefined))
    .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  const fresh = fitting.find((c) => !(c.extras ?? []).some((e) => e.tierId === extra.id));
  if (fresh) return { ok: true, registrationId: fresh.registrationId };
  if (fitting.length > 0) return { ok: false, reason: "already", registrationId: fitting[0]!.registrationId };
  const other = active.find((c) => c.ticketType);
  if (other) return { ok: false, reason: "wrong-ticket", heldName: other.ticketType ?? undefined };
  return { ok: false, reason: "no-base" };
}

/** A seat on one purchase, as far as the cart rule needs it. */
export interface CartSeatShape {
  email: string;
  tierId: string;
}

/**
 * What the rest of a cart does for one extra seat: covered by an admission seat
 * for the same person in the same cart, refused by one, or no help at all (then
 * the person's existing tickets decide).
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
  if (admissions.some((t) => admissionSatisfies(extra, t))) return { covered: true };
  const other = admissions[0];
  if (other) return { covered: false, refusal: "wrong-ticket", heldName: other.name };
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
