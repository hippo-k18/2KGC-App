'use server';

import { revalidatePath } from 'next/cache';
import { COLLECTIONS } from '@kgc/shared';
import { ensureRegistration } from '@kgc/scripts/src/lib/fulfilment';
import { requireOrganizer } from '@/lib/auth';
import { appendAudit } from '@/lib/audit';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { ROUTES } from '@/lib/nav';

/**
 * Add one attendee by hand.
 *
 * The button for this was `disabled title="Not built — see below"`, with a
 * comment arguing that adding an attendee means writing a document the attendee
 * also owns. That argument is about `users` — the profile somebody creates when
 * they sign in — and it is still right about `users`. It is not right about
 * this: a registration is the ticket record, it is written by the Stripe
 * webhook, by the invoice path and by the CSV importer, and none of those needs
 * a rule about who wins because no attendee may write one. Adding a row is the
 * same operation the importer already performs, on a file with one line.
 *
 * ── Which is exactly how it is implemented ──────────────────────────────────
 *
 * `ensureRegistration` from `@kgc/scripts`, the same function the webhook and
 * the importer call. A second implementation would be a fourth opinion about
 * when to mint `qrSecret` and `claimCode`, and the day the copies disagreed is
 * the day a badge stops scanning while somebody holds it at the desk.
 *
 * ⚠️ Note the transaction inside it uses a native `Date` rather than a
 * `FieldValue` sentinel, because `@kgc/scripts` resolves its own copy of
 * `firebase-admin` and a sentinel built there fails `instanceof` against a store
 * created here. Nothing in this file constructs one either.
 *
 * ── An added attendee has no order, deliberately ────────────────────────────
 *
 * Same reasoning as the importer: this person did not pay through us. Writing
 * an order would put money in the revenue figures that nobody received. They
 * get a registration, appear on the attendee list, can be checked in, and
 * Attendee Orders correctly shows nothing for them.
 */

export interface AddAttendeeState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Deliberately loose. This is the address a claim code and a badge go to, so a
 * rejection here costs an organizer a retype and a false accept costs somebody
 * their ticket — but a regex strict enough to be worth arguing about also
 * rejects real addresses, and `ensureRegistration` normalises before hashing.
 */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function addAttendeeAction(
  _prev: AddAttendeeState,
  formData: FormData,
): Promise<AddAttendeeState> {
  const actor = await requireOrganizer();

  const email = String(formData.get('email') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const ticketType = String(formData.get('ticketType') ?? '').trim();

  if (!email || !LOOKS_LIKE_EMAIL.test(email)) {
    return { error: 'That does not look like an email address.' };
  }
  if (!name) return { error: 'A name — it is what goes on the badge.' };

  try {
    const result = await ensureRegistration(db(), {
      email,
      name,
      // Same placeholder the importer uses. Visibly a placeholder beats a blank
      // line on a printed badge.
      ticketType: ticketType || 'Added by organizer',
    });

    await appendAudit({
      actor,
      action: 'attendee.add',
      targetPath: `${COLLECTIONS.registrations}/${result.registrationId}`,
      targetId: result.registrationId,
      before: {},
      after: { email, name, ticketType: ticketType || 'Added by organizer' },
    });

    revalidatePath(ROUTES.attendees);
    revalidatePath(ROUTES.checkIn);
    revalidatePath(ROUTES.analyticsExports);

    return {
      ok: true,
      message: result.created
        ? `Added ${name}. They can be checked in at the door now; their claim code reaches them when you send it.`
        : `${email} was already on the list — the name and ticket type were updated rather than duplicated.`,
    };
  } catch (err) {
    recordError('attendee.add', err);
    return { error: err instanceof Error ? err.message : 'Could not add that attendee.' };
  }
}
