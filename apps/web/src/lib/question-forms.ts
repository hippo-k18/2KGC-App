import 'server-only';

import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  type PendingAnswersDoc,
  type QuestionFieldDef,
  type QuestionFormDoc,
  type TicketAudience,
} from '@kgc/shared';
import { type AnswerValue } from '@kgc/scripts/src/lib/question-forms';
import { db } from './firestore';

/**
 * Registration questions, on the buyer's side.
 *
 * ── Why the answers cannot simply travel with the payment ──────────────────
 *
 * Stripe's hosted Checkout supports at most three custom fields, and only text,
 * numeric and dropdown — enough for a t-shirt size, not for a consent flow or a
 * dietary note. Metadata caps at 500 characters per value. And the buyer leaves
 * our origin entirely, which is the whole point of hosted Checkout and what
 * keeps this project in PCI SAQ A.
 *
 * So the form is rendered on our own page *before* the redirect, the answers go
 * into `pendingAnswers` keyed by a reference the checkout carries, and the
 * webhook copies them onto the registration once the payment is confirmed.
 *
 * ── The answers are written before the money arrives, and that is fine ─────
 *
 * An abandoned checkout leaves a row nobody reads. That is strictly better than
 * the alternative — asking the questions *after* payment, on the confirmation
 * page, where roughly half of buyers close the tab and the caterer never learns
 * about the coeliac.
 */

/** How long a pending row is meaningful. Stripe sessions expire after 24 hours. */
const PENDING_TTL_MS = 36 * 60 * 60 * 1000;

export interface ActiveForm {
  fields: QuestionFieldDef[];
}

/**
 * The questions to ask this audience, or none.
 *
 * Returns an empty field list rather than throwing for every failure mode —
 * no form, form switched off, database unreachable. ⚠️ A question form that
 * cannot load must never block a purchase: the worst outcome of this returning
 * empty is a missing dietary note, and the worst outcome of it throwing is a
 * conference that cannot sell tickets.
 */
export async function activeForm(audience: TicketAudience): Promise<ActiveForm> {
  try {
    const doc = await db().collection(COLLECTIONS.questionForms).doc(audience).get();
    if (!doc.exists) return { fields: [] };

    const data = doc.data() as QuestionFormDoc;
    if (data.eventId !== EVENT_ID || data.active !== true) return { fields: [] };

    return { fields: [...(data.fields ?? [])].sort((a, b) => a.order - b.order) };
  } catch (err) {
    console.error('[question-forms] could not load the form for', audience, err);
    return { fields: [] };
  }
}

/**
 * Stash a buyer's answers and return the reference the checkout will carry.
 *
 * The reference is a fresh UUID rather than anything derived from the buyer.
 * A derived key — the email, say — would let a second purchase overwrite the
 * answers of the first while the first is still mid-checkout, and would make
 * the key itself guessable by anyone who knows an address.
 */
export async function stashAnswers(input: {
  answers: Record<string, AnswerValue>;
  email: string;
  ticketTypeId: string;
}): Promise<string | undefined> {
  if (Object.keys(input.answers).length === 0) return undefined;

  const ref = `pa_${randomUUID()}`;

  try {
    const doc: Omit<PendingAnswersDoc, 'createdAt' | 'updatedAt'> = {
      eventId: EVENT_ID,
      answers: input.answers,
      email: input.email,
      ticketTypeId: input.ticketTypeId,
      expiresAt: Timestamp.fromMillis(Date.now() + PENDING_TTL_MS),
    };

    await db()
      .collection(COLLECTIONS.pendingAnswers)
      .doc(ref)
      .set({ ...doc, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });

    return ref;
  } catch (err) {
    /**
     * ⚠️ Swallowed on purpose. A failure to store a dietary preference must not
     * stop somebody buying a ticket — the purchase is the thing that matters and
     * the answer can be collected again. The alternative is a conference that
     * cannot sell tickets because a secondary collection is unavailable.
     */
    console.error('[question-forms] could not stash answers; continuing without them', err);
    return undefined;
  }
}

/**
 * Retrieve stashed answers at fulfilment, and clear them.
 *
 * Deleted after reading rather than left to expire: they have been copied onto
 * the registration, and this collection holds dietary and accessibility data —
 * the least of it that exists, the better. A webhook replay finds nothing here
 * and leaves the registration's existing answers alone, which is correct.
 */
export async function claimAnswers(
  ref: string | undefined,
): Promise<Record<string, AnswerValue> | undefined> {
  if (!ref || !/^pa_[a-f0-9-]{36}$/.test(ref)) return undefined;

  try {
    const docRef = db().collection(COLLECTIONS.pendingAnswers).doc(ref);
    const snap = await docRef.get();
    if (!snap.exists) return undefined;

    const data = snap.data() as PendingAnswersDoc;
    if (data.eventId !== EVENT_ID) return undefined;

    // Best effort. Losing the delete leaves a stale row, which is untidy;
    // failing the fulfilment over it would lose a ticket.
    docRef
      .delete()
      .catch((err) => console.error('[question-forms] could not clear pending answers', err));

    return data.answers;
  } catch (err) {
    console.error('[question-forms] could not claim answers for', ref, err);
    return undefined;
  }
}
