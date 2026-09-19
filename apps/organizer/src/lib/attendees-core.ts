import type { RegistrationDoc, UserDoc } from '@kgc/shared';

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
  /** `cancelled` after a refund. A cancelled ticket must stay visible. */
  registrationStatus?: RegistrationDoc['status'];
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

  for (const { id, data: r } of registrations) {
    const k = emailKey(r.email);
    const existing = rows.get(k);

    if (existing) {
      // Attach the ticket to the profile that already exists.
      existing.registrationId = id;
      existing.ticketType = r.ticketType;
      existing.registrationStatus = r.status;
      continue;
    }

    /**
     * A ticket holder with no profile yet. Everything a profile would supply is
     * genuinely unknown rather than defaulted to something flattering —
     * `visibleInDirectory: false` because there is no directory projection to
     * be in, not because they opted out.
     */
    rows.set(k || id, {
      name: r.name || '(no name yet)',
      email: r.email ?? '',
      roles: [],
      onboarded: false,
      visibleInDirectory: false,
      messagingEnabled: false,
      interests: [],
      signedIn: false,
      registrationId: id,
      ticketType: r.ticketType,
      registrationStatus: r.status,
    });
  }

  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}
