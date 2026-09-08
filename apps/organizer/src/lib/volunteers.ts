import 'server-only';

import { COLLECTIONS, EVENT_ID, type RegistrationDoc, type VolunteerDoc } from '@kgc/shared';
import { db } from './firestore';
import { recordError } from './errors';

/**
 * The volunteer roster.
 *
 * ── Why this is a collection and not a label on an attendee ──────────────────
 *
 * A volunteer is not a kind of person, it is a person *with a shift*: a time, a
 * place and a job. Expressing that as a role on `users` gives an organizer a
 * list of names and no answer to the only question the roster exists for —
 * "who is on the registration desk at 08:00 tomorrow". So the shift is on the
 * row, and one person working two shifts is two rows joined by their address.
 *
 * ── Cost, and why there is no `orderBy` ─────────────────────────────────────
 *
 * One `where('eventId', '==', …)`, sorted in memory. A second field in the
 * query makes it a composite-index read that this repo does not declare, and
 * the emulator ignores index configuration entirely — so it would pass every
 * local run and fail live with `failed-precondition`. A conference roster is
 * tens of rows; sorting it here costs nothing.
 */

function iso(t: { toDate(): Date } | undefined): string | undefined {
  try {
    return t?.toDate().toISOString();
  } catch {
    return undefined;
  }
}

const emailKey = (e: string | undefined) => (e ?? '').trim().toLowerCase();

export interface VolunteerRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  day: string;
  startsAtLocal: string;
  endsAtLocal: string;
  status: VolunteerDoc['status'];
  notes: string;
  /** Set when the address also appears in `registrations`. Resolved on read. */
  registrationId?: string;
  createdAt?: string;
}

function toRow(id: string, v: VolunteerDoc): VolunteerRow {
  return {
    id,
    name: v.name ?? '',
    email: v.email ?? '',
    phone: v.phone ?? '',
    role: v.role ?? '',
    day: v.day ?? '',
    startsAtLocal: v.startsAtLocal ?? '',
    endsAtLocal: v.endsAtLocal ?? '',
    status: v.status ?? 'invited',
    notes: v.notes ?? '',
    registrationId: v.registrationId,
    createdAt: iso(v.createdAt),
  };
}

/**
 * Every volunteer, earliest shift first, unscheduled rows last.
 *
 * The shift sort is the useful one: a roster read on the morning of day two is
 * read forwards from now, and a list ordered by name means scanning the whole
 * thing to find out who has not turned up yet.
 */
export async function listVolunteers(): Promise<VolunteerRow[]> {
  try {
    const snap = await db()
      .collection(COLLECTIONS.volunteers)
      .where('eventId', '==', EVENT_ID)
      .get();

    return snap.docs
      .map((d) => toRow(d.id, d.data() as VolunteerDoc))
      .sort(
        (a, b) =>
          // Unscheduled rows sort last rather than first: a blank day string
          // would otherwise sort above every real shift and put the rows an
          // organizer has not finished filling in at the top of the roster.
          (a.day ? 0 : 1) - (b.day ? 0 : 1) ||
          a.day.localeCompare(b.day) ||
          a.startsAtLocal.localeCompare(b.startsAtLocal) ||
          a.name.localeCompare(b.name),
      );
  } catch (err) {
    recordError('volunteers.list', err);
    return [];
  }
}

/**
 * Attach the registration id to any volunteer who also holds a ticket.
 *
 * Matched on the address folded to lower case, which is the fallback join every
 * cross-collection read in this dashboard uses because `registrations`, `users`
 * and this collection are keyed three different ways. It is display-only: a
 * volunteer without a ticket is still a volunteer, and nothing here mints one.
 */
export async function withRegistrations(rows: VolunteerRow[]): Promise<VolunteerRow[]> {
  if (rows.length === 0) return rows;

  try {
    const snap = await db()
      .collection(COLLECTIONS.registrations)
      .where('eventId', '==', EVENT_ID)
      .get();

    const byEmail = new Map<string, string>();
    for (const d of snap.docs) {
      const r = d.data() as RegistrationDoc;
      byEmail.set(emailKey(r.email), d.id);
    }

    return rows.map((r) => ({ ...r, registrationId: byEmail.get(emailKey(r.email)) }));
  } catch (err) {
    recordError('volunteers.withRegistrations', err);
    return rows;
  }
}

export interface RosterSummary {
  total: number;
  confirmed: number;
  outstanding: number;
  /** Rows with no day or no start time — a volunteer nobody has told when. */
  unscheduled: number;
  /** Distinct people, since one person working two shifts is two rows. */
  people: number;
  roles: { name: string; count: number }[];
  days: { day: string; count: number; confirmed: number }[];
}

/**
 * The four numbers worth putting above the table, plus the two breakdowns.
 *
 * `outstanding` counts invited-and-not-yet-answered, not "declined": a declined
 * volunteer is a settled fact and needs a replacement, while an unanswered
 * invitation is the row somebody should chase this afternoon. Merging them into
 * one "not confirmed" figure hides which of the two an organizer is looking at.
 */
export function summariseRoster(rows: VolunteerRow[]): RosterSummary {
  const roles = new Map<string, number>();
  const days = new Map<string, { count: number; confirmed: number }>();

  for (const r of rows) {
    if (r.role) roles.set(r.role, (roles.get(r.role) ?? 0) + 1);
    if (r.day) {
      const d = days.get(r.day) ?? { count: 0, confirmed: 0 };
      d.count += 1;
      if (r.status === 'confirmed') d.confirmed += 1;
      days.set(r.day, d);
    }
  }

  return {
    total: rows.length,
    confirmed: rows.filter((r) => r.status === 'confirmed').length,
    outstanding: rows.filter((r) => r.status === 'invited').length,
    unscheduled: rows.filter((r) => !r.day || !r.startsAtLocal).length,
    people: new Set(rows.map((r) => emailKey(r.email)).filter(Boolean)).size,
    roles: [...roles.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    days: [...days.entries()]
      .map(([day, d]) => ({ day, ...d }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}

/**
 * Shifts that overlap for the same person, by address.
 *
 * The one piece of roster arithmetic worth doing on read: a volunteer rostered
 * on two doors at 09:00 is a hole in the plan that nobody notices until 09:00.
 * Comparing `HH:mm` strings works because both are wall clock in the event's
 * own timezone, which is the same reason `SessionDoc` stores `startsAtLocal`.
 */
export function overlappingShifts(rows: VolunteerRow[]): VolunteerRow[][] {
  const byPerson = new Map<string, VolunteerRow[]>();
  for (const r of rows) {
    if (!r.day || !r.startsAtLocal || !r.endsAtLocal) continue;
    const k = emailKey(r.email);
    if (!k) continue;
    byPerson.set(k, [...(byPerson.get(k) ?? []), r]);
  }

  const clashes: VolunteerRow[][] = [];
  for (const shifts of byPerson.values()) {
    const sorted = [...shifts].sort(
      (a, b) => a.day.localeCompare(b.day) || a.startsAtLocal.localeCompare(b.startsAtLocal),
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev.day === cur.day && cur.startsAtLocal < prev.endsAtLocal) clashes.push([prev, cur]);
    }
  }
  return clashes;
}
