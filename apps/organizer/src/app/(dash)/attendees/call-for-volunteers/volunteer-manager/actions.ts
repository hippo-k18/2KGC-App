'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type VolunteerDoc } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { appendAudit } from '@/lib/audit';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';

/**
 * Writing the volunteer roster.
 *
 * Every write here is Admin-SDK and `volunteers` has no `firestore.rules` match
 * block, which is the house posture for a server-owned collection and is not an
 * oversight: a roster row says where a named person will be standing at a given
 * hour, and there is no client in this project with any business reading one.
 *
 * ── Why the id is generated and not derived from the address ────────────────
 *
 * Elsewhere in this repo a derived id is the deduplication mechanism —
 * `registrations` is keyed by a hash of the email precisely so that adding the
 * same person twice updates rather than duplicates. A roster is the opposite
 * case: one person legitimately works Friday morning *and* Saturday afternoon,
 * and those are two shifts. Keying by address would make the second one silently
 * overwrite the first, and the symptom is a volunteer who does not turn up for a
 * shift nobody can see any more.
 */

const PATH = '/attendees/call-for-volunteers/volunteer-manager';
const CONSENT_PATH = '/attendees/call-for-volunteers/release-and-consent-forms';

/** Deliberately loose — the same reasoning as `add-actions.ts` on Attendees. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{2}:\d{2}$/;

const STATUSES: VolunteerDoc['status'][] = ['invited', 'confirmed', 'declined', 'no-show'];

export interface VolunteerState {
  ok?: boolean;
  message?: string;
  error?: string;
}

function readShift(formData: FormData): { day?: string; start?: string; end?: string; error?: string } {
  const day = String(formData.get('day') ?? '').trim();
  const start = String(formData.get('startsAtLocal') ?? '').trim();
  const end = String(formData.get('endsAtLocal') ?? '').trim();

  if (day && !DAY.test(day)) return { error: 'The day has to be a date. YYYY-MM-DD.' };
  if (start && !CLOCK.test(start)) return { error: 'The start time has to be HH:mm.' };
  if (end && !CLOCK.test(end)) return { error: 'The end time has to be HH:mm.' };
  // Comparing wall clocks as strings is safe here for the same reason it is in
  // `lib/checkin.ts`: both are `HH:mm` in the event's own timezone, so the
  // lexical order is the chronological one.
  if (start && end && end <= start) return { error: 'The shift ends before it starts.' };

  return { day: day || undefined, start: start || undefined, end: end || undefined };
}

/**
 * Add a volunteer, or rewrite one.
 *
 * An `id` in the form means an edit. The nested-map caution from AGENTS.md
 * gotcha 9 applies at the top level too, so every optional field is written on
 * every save — `FieldValue.delete()` when it is blank rather than omitted, or an
 * organizer who clears a phone number is told it saved and still has the old
 * number on the roster they hand to the desk.
 */
export async function saveVolunteerAction(
  _prev: VolunteerState,
  formData: FormData,
): Promise<VolunteerState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  const status = String(formData.get('status') ?? 'invited') as VolunteerDoc['status'];

  if (!name) return { error: 'Enter a name.' };
  if (!email || !LOOKS_LIKE_EMAIL.test(email)) {
    return { error: 'An address, so a waiver link and a shift reminder have somewhere to go.' };
  }
  if (!role) return { error: 'What they are doing: "Registration desk", "Room steward".' };
  if (!STATUSES.includes(status)) return { error: 'Unknown status.' };

  const shift = readShift(formData);
  if (shift.error) return { error: shift.error };

  try {
    const now = FieldValue.serverTimestamp();
    const body = {
      eventId: EVENT_ID,
      name,
      email,
      role,
      status,
      phone: phone || FieldValue.delete(),
      notes: notes || FieldValue.delete(),
      day: shift.day ?? FieldValue.delete(),
      startsAtLocal: shift.start ?? FieldValue.delete(),
      endsAtLocal: shift.end ?? FieldValue.delete(),
      updatedAt: now,
    };

    let targetId = id;
    if (id) {
      await db().collection(COLLECTIONS.volunteers).doc(id).set(body, { merge: true });
    } else {
      const ref = await db()
        .collection(COLLECTIONS.volunteers)
        .add({ ...body, createdAt: now });
      targetId = ref.id;
    }

    await appendAudit({
      actor,
      action: id ? 'volunteer.update' : 'volunteer.create',
      targetPath: `${COLLECTIONS.volunteers}/${targetId}`,
      targetId,
      before: {},
      after: { name, email, role, status, day: shift.day ?? null, startsAtLocal: shift.start ?? null },
    });

    revalidatePath(PATH);
    revalidatePath(CONSENT_PATH);

    return {
      ok: true,
      message: id
        ? `Updated ${name}.`
        : `${name} is on the roster${shift.day ? ` for ${shift.day}` : ', with no shift yet'}.`,
    };
  } catch (err) {
    recordError('volunteer.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save that volunteer.' };
  }
}

/**
 * Move one row between invited, confirmed, declined and no-show.
 *
 * A plain server action rather than a `useActionState` form, because the roster
 * table is a Server Component and this is one button: the reply an organizer
 * needs is the row itself changing, not a message above the table.
 */
export async function setVolunteerStatusAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const status = String(formData.get('status') ?? '') as VolunteerDoc['status'];
  if (!id || !STATUSES.includes(status)) return;

  try {
    await db()
      .collection(COLLECTIONS.volunteers)
      .doc(id)
      .set({ status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    await appendAudit({
      actor,
      action: 'volunteer.update',
      targetPath: `${COLLECTIONS.volunteers}/${id}`,
      targetId: id,
      before: {},
      after: { status },
    });
  } catch (err) {
    recordError('volunteer.status', err);
  }

  revalidatePath(PATH);
  revalidatePath(CONSENT_PATH);
}

/**
 * Take a row off the roster.
 *
 * A hard delete, and it is the right one: a roster is a plan for a weekend, not
 * a record of what happened. Any signature that volunteer gave survives in
 * `consentForms/{id}/responses` regardless — those are append-only and nothing
 * in this product can delete one — so removing the row loses the shift and not
 * the consent, which is the correct half to lose.
 */
export async function deleteVolunteerAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return;

  try {
    const ref = db().collection(COLLECTIONS.volunteers).doc(id);
    const snap = await ref.get();
    const before = snap.data() as VolunteerDoc | undefined;
    await ref.delete();

    await appendAudit({
      actor,
      action: 'volunteer.delete',
      targetPath: `${COLLECTIONS.volunteers}/${id}`,
      targetId: id,
      before: before ? { name: before.name, email: before.email, role: before.role } : {},
      after: {},
    });
  } catch (err) {
    recordError('volunteer.delete', err);
  }

  revalidatePath(PATH);
  revalidatePath(CONSENT_PATH);
}
