import type { OrderDoc, RegistrationDoc, UserDoc } from '@kgc/shared';

/**
 * The join behind `listAttendees()`, with no Firestore handle of its own.
 *
 * ── Deliberately NOT `server-only` ──────────────────────────────────────────
 *
 * `data.ts` carries it and is unreachable from a test process. The merge is the
 * part worth pinning, because every attendee screen, both CSVs and the segment
 * counts are this one array read different ways.
 *
 * ⚠️ It takes **whole documents**. `listAttendees()` once projected both
 * queries with `select('email')`, copied from `adoptionCounts()` where only the
 * address is needed. Nothing threw: every row fell back to its email for a
 * name, every ticket read as absent, and the live dashboard showed 52 people
 * with no name, no company and "no ticket" under a masthead saying all 52 held
 * one. `tests/programme/attendees-core.test.ts` pins both halves.
 */

export interface AttendeeRow {
  /** Absent until they sign in — a ticket holder who has not is still an attendee. */
  uid?: string;
  name: string;
  email: string;
  title?: string;
  company?: string;
  roles: string[];
  onboarded: boolean;
  visibleInDirectory: boolean;
  messagingEnabled: boolean;
  interests: string[];

  /** True when a `users` profile exists — i.e. they have opened the app. */
  signedIn: boolean;
  /** Present for anyone holding a ticket. Absent for staff added by hand. */
  registrationId?: string;
  ticketType?: string;
  /** `cancelled` after a refund or by an organizer. A cancelled ticket must stay visible. */
  registrationStatus?: RegistrationDoc['status'];
  /** The organizer's label, from the registration. Somebody with no ticket has none. */
  categoryId?: string;
  category?: string;
}

/**
 * Which of two registrations for one address the list should show.
 *
 * One address can hold two: a registration written before ids were derived
 * from the email sits beside the derived one, and an `altEmails` repair can
 * leave the same. The merge used to let the last one read win, so a cancelled
 * ticket could hide the active one and the list said "cancelled" about somebody
 * whose badge scans. Active beats anything else; between two of the same
 * standing the later `updatedAt` wins, so the answer does not depend on the
 * order Firestore returned them in.
 */
export function preferRegistration<T extends Partial<RegistrationDoc>>(a: T, b: T): T {
  const aActive = a.status === 'active';
  const bActive = b.status === 'active';
  if (aActive !== bActive) return aActive ? a : b;
  return millisOf(b.updatedAt) >= millisOf(a.updatedAt) ? b : a;
}

function millisOf(t: unknown): number {
  const v = t as { toMillis?: () => number } | Date | undefined;
  if (v instanceof Date) return v.getTime();
  return typeof v?.toMillis === 'function' ? v.toMillis() : 0;
}

export const emailKey = (e: string | undefined) => (e ?? '').trim().toLowerCase();

export function mergeAttendees(
  users: { id: string; data: Partial<UserDoc> }[],
  registrations: { id: string; data: Partial<RegistrationDoc> }[],
): AttendeeRow[] {
  const rows = new Map<string, AttendeeRow>();

  // Users first, so their profile fields are the richer starting point.
  for (const { id, data: u } of users) {
    rows.set(emailKey(u.email) || id, {
      uid: id,
      /*
       * `UserDoc.name` is typed as required and the live project holds profiles
       * without one, which threw `Cannot read properties of undefined (reading
       * 'localeCompare')` out of the sort below and took down every screen that
       * lists attendees — Speed Networking, Profile Photo Frames, Gamification
       * and the desk inbox among them. Falling back the way
       * `listCommunityPosts` already does keeps the row addressable rather than
       * dropping a real ticket holder off a list because a field is blank.
       */
      name: u.name || u.email || id,
      email: u.email ?? '',
      title: u.title,
      company: u.company,
      roles: u.roles ?? [],
      onboarded: Boolean(u.onboarded),
      visibleInDirectory: Boolean(u.visibleInDirectory),
      messagingEnabled: Boolean(u.messagingEnabled),
      interests: u.interests ?? [],
      signedIn: true,
    });
  }

  // The registration each row currently shows, so a second one for the same
  // address is compared against it rather than overwriting it.
  const shown = new Map<AttendeeRow, Partial<RegistrationDoc>>();

  for (const { id, data: r } of registrations) {
    const k = emailKey(r.email);
    const existing = rows.get(k);

    if (existing) {
      const current = shown.get(existing);
      if (current && preferRegistration(current, r) === current) continue;

      // Attach the ticket to the profile that already exists. What the
      // attendee wrote about themselves wins over what an organizer typed.
      existing.registrationId = id;
      existing.ticketType = r.ticketType;
      existing.registrationStatus = r.status;
      existing.categoryId = r.categoryId;
      existing.category = r.category;
      if (!existing.signedIn) existing.name = r.name || existing.name;
      existing.title = existing.signedIn ? (existing.title ?? r.title) : r.title;
      existing.company = existing.signedIn ? (existing.company ?? r.company) : r.company;
      shown.set(existing, r);
      continue;
    }

    /**
     * A ticket holder with no profile yet. Everything a profile would supply is
     * genuinely unknown rather than defaulted to something flattering —
     * `visibleInDirectory: false` because there is no directory projection to
     * be in, not because they opted out.
     */
    const row: AttendeeRow = {
      name: r.name || '(no name yet)',
      email: r.email ?? '',
      title: r.title,
      company: r.company,
      roles: [],
      onboarded: false,
      visibleInDirectory: false,
      messagingEnabled: false,
      interests: [],
      signedIn: false,
      registrationId: id,
      ticketType: r.ticketType,
      registrationStatus: r.status,
      categoryId: r.categoryId,
      category: r.category,
    };
    rows.set(k || id, row);
    shown.set(row, r);
  }

  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Editing, cancelling and transferring. The decisions, with no store.
// ---------------------------------------------------------------------------

/**
 * Deliberately loose, and the same shape `add-actions.ts` accepts: strict
 * enough to catch a missing `@`, not strict enough to reject a real address.
 */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AttendeeDetails {
  name: string;
  email: string;
  title: string;
  company: string;
}

export type AttendeeDetailsResult =
  | { ok: true; values: AttendeeDetails }
  | { ok: false; fieldErrors: Record<string, string> };

/** Trims, bounds and checks what the edit and transfer forms post. */
export function validateAttendeeDetails(raw: {
  name?: unknown;
  email?: unknown;
  title?: unknown;
  company?: unknown;
}): AttendeeDetailsResult {
  const text = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
  const values: AttendeeDetails = {
    name: text(raw.name),
    email: text(raw.email).toLowerCase(),
    title: text(raw.title),
    company: text(raw.company),
  };

  const fieldErrors: Record<string, string> = {};
  if (!values.name) fieldErrors.name = 'Enter a name. It goes on the badge.';
  else if (values.name.length > 120) fieldErrors.name = 'Keep the name under 120 characters.';
  if (!LOOKS_LIKE_EMAIL.test(values.email)) {
    fieldErrors.email = 'That does not look like an email address.';
  }
  if (values.title.length > 120) fieldErrors.title = 'Keep the title under 120 characters.';
  if (values.company.length > 120) fieldErrors.company = 'Keep the company under 120 characters.';

  return Object.keys(fieldErrors).length ? { ok: false, fieldErrors } : { ok: true, values };
}

/**
 * Whether cancelling a ticket should also end this account's app access.
 *
 * `registered` is the claim every attendee rule checks, and a ticket is only
 * one of the reasons somebody holds it. A speaker, a sponsor's staff or an
 * organizer who also had a ticket keeps the app when the ticket goes.
 */
export function losesAppAccess(roles: readonly string[] | undefined): boolean {
  return (roles ?? []).every((r) => r === 'attendee');
}

/** The slice of an order the seat lookup reads. */
export type SeatOrder = Pick<OrderDoc, 'status' | 'channel' | 'email' | 'items' | 'registrationIds' | 'releasedSeats'> & {
  id: string;
};

/**
 * The paid seat behind a registration, if there is one to give back.
 *
 * Stock is counted from paid orders, so only a registration a paid order stands
 * behind holds a seat. Somebody added by hand or imported has no order and
 * never took one, and returning a seat for them would put stock on sale that
 * was never sold. `null` means exactly that: nothing to return.
 *
 * The line is matched on the attendee's address first, because a group order
 * names one seat per line; then on the ticket type's name; then the first line
 * that names a tier.
 */
export function seatToRelease(
  registration: { id: string; email: string; ticketType?: string },
  orders: SeatOrder[],
): { orderId: string; ticketTypeId: string } | null {
  const email = emailKey(registration.email);

  for (const o of orders) {
    if (o.channel === 'demo') continue;
    if (o.status !== 'paid' && o.status !== 'partially_refunded') continue;
    if (o.releasedSeats?.[registration.id]) continue;

    const lines = (o.items ?? []).filter((l) => l.ticketTypeId);
    const mine = lines.filter((l) => emailKey(l.attendeeEmail) === email);
    const covers =
      mine.length > 0 ||
      (o.registrationIds ?? []).includes(registration.id) ||
      emailKey(o.email) === email;
    if (!covers) continue;

    // Every seat on this order may already have gone back for somebody else.
    const released = Object.values(o.releasedSeats ?? {});
    const free = (tierId: string) =>
      lines.filter((l) => l.ticketTypeId === tierId).reduce((n, l) => n + (l.quantity || 1), 0) -
      released.filter((t) => t === tierId).length;

    const line =
      mine.find((l) => free(l.ticketTypeId) > 0) ??
      lines.find((l) => l.ticketTypeName === registration.ticketType && free(l.ticketTypeId) > 0) ??
      lines.find((l) => free(l.ticketTypeId) > 0);
    if (line) return { orderId: o.id, ticketTypeId: line.ticketTypeId };
  }

  return null;
}
