'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@kgc/shared';
import { ensureRegistration } from '@kgc/scripts/src/lib/fulfilment';
import { registrationId } from '@kgc/scripts/src/lib/ids';
import { emailNote, sendAttendeeConfirmation } from '@/lib/attendee-admin';
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
 * created here. The one sentinel in this file is built here and written here.
 *
 * ── An added attendee has no order, deliberately ────────────────────────────
 *
 * Same reasoning as the importer: this person did not pay through us. Writing
 * an order would put money in the revenue figures that nobody received. They
 * get a registration, appear on the attendee list, can be checked in, and
 * Attendee Orders correctly shows nothing for them.
 *
 * ── They are told, with the email a buyer gets ──────────────────────────────
 *
 * The claim code is how a ticket holder reaches the app, and nobody added here
 * had been sent one. A new registration now gets the purchase confirmation at
 * zero, the way a complimentary pass does. Re-adding an address that is already
 * on the list does not mail it again; that is what Send confirmation again on
 * the edit panel is for.
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
  if (!name) return { error: 'Enter a name. It goes on the badge.' };

  try {
    // `ensureRegistration` revives whatever it finds, which is right for a
    // buyer who was refunded and bought again and wrong here: it would undo an
    // organizer's cancellation without giving the seat or the app access back.
    const existing = await db().collection(COLLECTIONS.registrations).doc(registrationId(email)).get();
    // A `transferred` one is different: that person gave a ticket away and is
    // being given a new one, which is exactly what reviving it means.
    const status = existing.data()?.status;
    if (status === 'cancelled') {
      return { error: `${email} is on the list with a cancelled ticket. Open it from the list to reinstate it.` };
    }

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

    if (status === 'transferred') {
      await existing.ref.update({ transferredTo: FieldValue.delete() });
    }

    if (result.created || status === 'transferred') {
      await sendAttendeeConfirmation({
        registrationId: result.registrationId,
        email: result.email,
        name,
        ticketType: ticketType || 'Added by organizer',
        claimCode: result.claimCode,
      });
    }

    revalidatePath(ROUTES.attendees);
    revalidatePath(ROUTES.checkIn);
    revalidatePath(ROUTES.analyticsExports);

    return {
      ok: true,
      message: result.created || status === 'transferred'
        ? `Added ${name}. They can be checked in at the door now.` +
          (emailNote() || ` Their confirmation and claim code went to ${result.email}.`)
        : `${email} was already on the list. The name and ticket type were updated rather than duplicated.`,
    };
  } catch (err) {
    recordError('attendee.add', err);
    return { error: err instanceof Error ? err.message : 'Could not add that attendee.' };
  }
}
