import 'server-only';

import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  publicSiteOrigin,
  type OrderDoc,
  type RegistrationDoc,
  type TicketTypeDoc,
} from '@kgc/shared';
import { sendPurchaseConfirmation } from '@kgc/scripts/src/lib/email';
import { ensureRegistration } from '@kgc/scripts/src/lib/fulfilment';
import { claimCode, qrSecret, registrationId } from '@kgc/scripts/src/lib/ids';
import { mintOrderToken } from '@kgc/scripts/src/lib/order-token';
import {
  emailKey,
  losesAppAccess,
  seatToRelease,
  type AttendeeDetails,
  type SeatOrder,
} from './attendees-core';
import { applyRuleTo } from './attendee-categories';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * What an organizer can do to one registration after it exists: correct it,
 * cancel it, bring it back, hand it to somebody else, change its ticket type.
 *
 * ── Why none of this is a plain field edit ──────────────────────────────────
 *
 * A registration's id is `reg_` + sha256(email). The OTP sign-in finds a ticket
 * by computing that id, and the importer, the webhook and Add an attendee all
 * converge on it. So an address cannot be edited in place: the document would
 * sit under an id nothing computes, the new address could not sign in, and the
 * next import would mint a second registration beside it. Changing an address,
 * for a typo or for a transfer, is therefore a **move**: `ensureRegistration`
 * creates the document where everything expects it, and the old one is kept as
 * `transferred` so the trail and any order that names it still resolve.
 *
 * The two moves differ in one thing. A corrected address is the same person, so
 * the badge secret, claim code, answers and check-ins go with them and a badge
 * already printed still scans. A transfer is a different person, so they get
 * the fresh secrets `ensureRegistration` minted and the old badge stops.
 *
 * ── Cancelled by an organizer is not refunded ───────────────────────────────
 *
 * Both end at `status: 'cancelled'`, which is what check-in, the badge screen
 * and sign-in read, and that is right: the ticket is equally dead. The money is
 * a separate fact and lives on the order. What this adds is the stock: a paid
 * seat is released through `OrderDoc.releasedSeats` so the tier can sell it
 * again, and the refund path subtracts the same map so refunding the order
 * later cannot return the seat twice.
 *
 * Sentinels are fine here. This module owns its store; it is `@kgc/scripts`
 * that must not build one.
 */

export type AttendeeActionResult =
  | { ok: true; message: string; registrationId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const regRef = (rid: string) => db().collection(COLLECTIONS.registrations).doc(rid);

async function readRegistration(rid: string): Promise<RegistrationDoc | null> {
  if (!rid) return null;
  const snap = await regRef(rid).get();
  const data = snap.data() as RegistrationDoc | undefined;
  return data && data.eventId === EVENT_ID ? data : null;
}

/** The one line shown when mail cannot leave this deployment. */
export function emailNote(): string {
  return process.env.RESEND_API_KEY ? '' : ' Email is not set up yet, so nothing was sent.';
}

// ---------------------------------------------------------------------------
// App access
// ---------------------------------------------------------------------------

/**
 * End, or restore, the app access a ticket gave.
 *
 * Sign-in already refuses an address with no active registration. This is for
 * the person who is signed in already: `registered` is the claim every attendee
 * rule checks, so clearing it and revoking refresh tokens shuts the app at the
 * next token refresh, an hour at most. Anybody holding the claim for another
 * reason keeps it; see `losesAppAccess`.
 *
 * Best effort, like the provisioning it mirrors. A ticket that is cancelled
 * with the claim still standing is a smaller problem than a cancel button that
 * fails because Auth was slow.
 */
async function setAppAccess(email: string, allowed: boolean): Promise<'changed' | 'kept' | 'none'> {
  try {
    const auth = getAuth();
    const user = await auth.getUserByEmail(email).catch(() => null);
    if (!user) return 'none';

    const claims = (user.customClaims ?? {}) as { registered?: boolean; roles?: string[] };

    if (allowed) {
      if (claims.registered) return 'kept';
      await auth.setCustomUserClaims(user.uid, {
        ...claims,
        registered: true,
        roles: claims.roles?.length ? claims.roles : ['attendee'],
        eventId: EVENT_ID,
      });
      return 'changed';
    }

    if (!claims.registered || !losesAppAccess(claims.roles)) return 'kept';
    await auth.setCustomUserClaims(user.uid, { ...claims, registered: false });
    await auth.revokeRefreshTokens(user.uid);
    return 'changed';
  } catch (err) {
    recordError('attendee.appAccess', err);
    return 'none';
  }
}

// ---------------------------------------------------------------------------
// Confirmation email
// ---------------------------------------------------------------------------

/**
 * The same confirmation a buyer gets, at zero, for the same reason a comp pass
 * sends it: the claim code is the only way the holder reaches the app.
 * `sendPurchaseConfirmation` never throws and logs every attempt, including the
 * skipped ones, so Emails shows what happened to it.
 */
export async function sendAttendeeConfirmation(input: {
  registrationId: string;
  email: string;
  name: string;
  ticketType: string;
  claimCode: string;
}): Promise<void> {
  try {
    await sendPurchaseConfirmation(db(), {
      to: input.email,
      name: input.name,
      ticketType: input.ticketType,
      amountCents: 0,
      currency: 'usd',
      orderUrl: `${publicSiteOrigin()}/order/${mintOrderToken({ rid: input.registrationId })}`,
      claimCode: input.claimCode,
      registrationId: input.registrationId,
    });
  } catch (err) {
    // Minting the link throws when the signing secret is missing. The
    // registration is already correct; the email is the courtesy.
    recordError('attendee.confirmation', err);
  }
}

export async function resendConfirmation(rid: string, actor: string): Promise<AttendeeActionResult> {
  const reg = await readRegistration(rid);
  if (!reg) return { ok: false, error: 'That attendee is no longer on the list.' };
  if (reg.status !== 'active') return { ok: false, error: 'This registration is not active.' };

  let code = reg.claimCode;
  if (!code) {
    code = claimCode();
    await regRef(rid).update({ claimCode: code, updatedAt: FieldValue.serverTimestamp() });
  }

  await sendAttendeeConfirmation({
    registrationId: rid,
    email: reg.email,
    name: reg.name ?? '',
    ticketType: reg.ticketType ?? 'Attendee',
    claimCode: code,
  });
  await appendAudit({
    actor,
    action: 'attendee.confirmation',
    targetPath: `${COLLECTIONS.registrations}/${rid}`,
    targetId: rid,
    before: {},
    after: { email: reg.email },
  });

  return {
    ok: true,
    registrationId: rid,
    message: process.env.RESEND_API_KEY
      ? `Confirmation sent to ${reg.email}.`
      : 'Email is not set up yet, so nothing was sent.',
  };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

/**
 * Mirror a corrected name, title and company onto the profile the app shows.
 *
 * Only when a profile exists, and only the three fields. The organizer's edit
 * and the attendee's own are the same kind of write to the same fields, so the
 * later one stands, which is what both of them would expect. `directory/{uid}`
 * is the projection other attendees read; it is updated only where it exists,
 * because its absence is an opt-out and must stay one.
 */
async function mirrorToProfile(email: string, details: AttendeeDetails): Promise<void> {
  // One equality filter, so the automatic single-field index serves it. Adding
  // `eventId` would need a composite index the emulator would never ask for.
  const users = await db().collection(COLLECTIONS.users).where('email', '==', email).get();
  const profile = users.docs.find((d) => d.data().eventId === EVENT_ID);
  if (!profile) return;

  const fields = {
    name: details.name,
    title: details.title || FieldValue.delete(),
    company: details.company || FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await profile.ref.update(fields);

  const listing = db().collection(COLLECTIONS.directory).doc(profile.id);
  if ((await listing.get()).exists) await listing.update(fields);
}

export async function updateAttendee(
  rid: string,
  details: AttendeeDetails,
  actor: string,
): Promise<AttendeeActionResult> {
  const reg = await readRegistration(rid);
  if (!reg) return { ok: false, error: 'That attendee is no longer on the list.' };

  if (emailKey(reg.email) !== details.email) {
    if (reg.status !== 'active') {
      return { ok: false, error: 'Reinstate this registration before changing its email.' };
    }
    return moveRegistration(rid, reg, details, actor, 'correct');
  }

  await regRef(rid).update({
    name: details.name,
    // `FieldValue.delete()`, not `|| undefined`: an emptied box has to clear.
    title: details.title || FieldValue.delete(),
    company: details.company || FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await mirrorToProfile(reg.email, details);

  await appendAudit({
    actor,
    action: 'attendee.update',
    targetPath: `${COLLECTIONS.registrations}/${rid}`,
    targetId: rid,
    before: { name: reg.name ?? null, title: reg.title ?? null, company: reg.company ?? null },
    after: { name: details.name, title: details.title || null, company: details.company || null },
  });

  return { ok: true, registrationId: rid, message: `Saved ${details.name}.` };
}

// ---------------------------------------------------------------------------
// Move: a corrected address, or a transfer
// ---------------------------------------------------------------------------

async function moveRegistration(
  fromId: string,
  from: RegistrationDoc,
  details: AttendeeDetails,
  actor: string,
  kind: 'correct' | 'transfer',
): Promise<AttendeeActionResult> {
  const toId = registrationId(details.email);
  if (toId === fromId) {
    return { ok: false, error: 'That is the address this ticket is already under.' };
  }

  const target = (await regRef(toId).get()).data() as RegistrationDoc | undefined;
  if (target?.status === 'active') {
    return {
      ok: false,
      error: `${details.email} already has a ticket.`,
      fieldErrors: { email: 'This address already has a ticket.' },
    };
  }
  if (target && kind === 'correct') {
    return {
      ok: false,
      error: `${details.email} is already on the list with a cancelled ticket. Reinstate that one instead.`,
      fieldErrors: { email: 'This address is already on the list.' },
    };
  }

  const ticketType = from.ticketType ?? 'Added by organizer';
  const moved = await ensureRegistration(db(), { email: details.email, name: details.name, ticketType });
  // The target may be somebody who transferred a ticket away earlier and is
  // now being handed one. Their old forward link no longer describes them.
  const clearForward = target ? { transferredTo: FieldValue.delete(), seatRelease: FieldValue.delete() } : {};

  // One batch for both ends, so there is never a moment with two live badges
  // or none. `ensureRegistration` above is the only step outside it, and a
  // failure after it leaves both active, which is visible and harmless.
  const batch = db().batch();
  const stamp = FieldValue.serverTimestamp();

  if (kind === 'correct') {
    batch.update(regRef(toId), {
      // Same person, same badge: a printed QR and a claim code already read
      // out over the phone both still work.
      qrSecret: from.qrSecret,
      claimCode: from.claimCode ?? moved.claimCode,
      title: details.title || FieldValue.delete(),
      company: details.company || FieldValue.delete(),
      ...(from.answers ? { answers: from.answers } : {}),
      // A category set by hand belongs to the person, so it moves with them.
      ...(from.categorySource === 'manual'
        ? {
            categoryId: from.categoryId ?? FieldValue.delete(),
            category: from.category ?? FieldValue.delete(),
            categorySource: 'manual',
          }
        : {}),
      ...(from.seatRelease ? { seatRelease: from.seatRelease } : {}),
      createdAt: from.createdAt,
      transferredFrom: fromId,
      updatedAt: stamp,
    });
    batch.update(regRef(fromId), {
      status: 'transferred',
      transferredTo: toId,
      // The old document must not answer to the badge that moved.
      qrSecret: qrSecret(),
      claimCode: claimCode(),
      tempPassword: FieldValue.delete(),
      updatedAt: stamp,
    });
  } else {
    batch.update(regRef(toId), {
      ...clearForward,
      title: details.title || FieldValue.delete(),
      company: details.company || FieldValue.delete(),
      transferredFrom: fromId,
      updatedAt: stamp,
    });
    batch.update(regRef(fromId), {
      status: 'transferred',
      transferredTo: toId,
      tempPassword: FieldValue.delete(),
      updatedAt: stamp,
    });
  }
  await batch.commit();

  if (kind === 'correct') await moveCheckIns(fromId, toId);

  // An order that named the old registration now also names the new one, so
  // whoever reads the order can find the person holding the seat.
  // A single `array-contains`, for the same index reason as the profile lookup.
  const orders = await db()
    .collection(COLLECTIONS.orders)
    .where('registrationIds', 'array-contains', fromId)
    .get();
  for (const o of orders.docs) {
    if (o.data().eventId !== EVENT_ID) continue;
    await o.ref.update({ registrationIds: FieldValue.arrayUnion(toId), updatedAt: stamp });
  }

  await setAppAccess(from.email, false);
  await setAppAccess(details.email, true);

  await sendAttendeeConfirmation({
    registrationId: toId,
    email: details.email,
    name: details.name,
    ticketType,
    claimCode: kind === 'correct' ? (from.claimCode ?? moved.claimCode) : moved.claimCode,
  });

  await appendAudit({
    actor,
    action: kind === 'correct' ? 'attendee.update' : 'attendee.transfer',
    targetPath: `${COLLECTIONS.registrations}/${fromId}`,
    targetId: fromId,
    before: { email: from.email, name: from.name ?? null, status: from.status },
    after: { email: details.email, name: details.name, registrationId: toId, ticketType },
  });

  return {
    ok: true,
    registrationId: toId,
    message:
      kind === 'correct'
        ? `${details.name} is now under ${details.email}. Their badge is unchanged.${mailed(details.email)}`
        : `Transferred to ${details.name} (${details.email}). ${from.name ?? from.email} no longer has a ticket.${mailed(details.email)}`,
  };
}

const mailed = (to: string) =>
  process.env.RESEND_API_KEY ? ` A confirmation went to ${to}.` : emailNote();

/**
 * Carry check-ins across a corrected address, so somebody already through the
 * door is not asked again. Lists are read one by one rather than with a
 * collection-group query, which would need an index the emulator does not
 * enforce and production does.
 */
async function moveCheckIns(fromId: string, toId: string): Promise<void> {
  const lists = await db().collection(COLLECTIONS.checkInLists).where('eventId', '==', EVENT_ID).get();
  for (const list of lists.docs) {
    const old = list.ref.collection(SUBCOLLECTIONS.checkIns).doc(fromId);
    const snap = await old.get();
    if (!snap.exists) continue;
    const batch = db().batch();
    batch.set(list.ref.collection(SUBCOLLECTIONS.checkIns).doc(toId), { ...snap.data(), registrationId: toId });
    batch.delete(old);
    await batch.commit();
  }
}

export async function transferAttendee(
  rid: string,
  details: AttendeeDetails,
  actor: string,
): Promise<AttendeeActionResult> {
  const reg = await readRegistration(rid);
  if (!reg) return { ok: false, error: 'That attendee is no longer on the list.' };
  if (reg.status !== 'active') return { ok: false, error: 'Only an active ticket can be transferred.' };
  return moveRegistration(rid, reg, details, actor, 'transfer');
}

// ---------------------------------------------------------------------------
// Cancel and reinstate
// ---------------------------------------------------------------------------

async function ordersFor(email: string, rid: string): Promise<SeatOrder[]> {
  // Read once and matched in memory, the way this screen already reads
  // attendees. An order can name this person three ways, and a query per way
  // is three composite indexes for a few hundred documents.
  const snap = await db().collection(COLLECTIONS.orders).where('eventId', '==', EVENT_ID).get();
  const key = emailKey(email);
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as OrderDoc) }))
    .filter(
      (o) =>
        emailKey(o.email) === key ||
        (o.registrationIds ?? []).includes(rid) ||
        (o.items ?? []).some((l) => emailKey(l.attendeeEmail) === key),
    );
}

export async function cancelAttendee(rid: string, actor: string): Promise<AttendeeActionResult> {
  const reg = await readRegistration(rid);
  if (!reg) return { ok: false, error: 'That attendee is no longer on the list.' };
  if (reg.status !== 'active') return { ok: false, error: 'This registration is not active.' };

  const orders = await ordersFor(reg.email, rid);
  const seat = seatToRelease({ id: rid, email: reg.email, ticketType: reg.ticketType }, orders);
  const paid = orders.some((o) => o.status === 'paid' || o.status === 'partially_refunded');

  let tierName: string | undefined;
  await db().runTransaction(async (tx) => {
    const fresh = (await tx.get(regRef(rid))).data() as RegistrationDoc | undefined;
    if (!fresh || fresh.status !== 'active') return;

    if (seat) {
      const tierRef = db().collection(COLLECTIONS.ticketTypes).doc(seat.ticketTypeId);
      const tier = (await tx.get(tierRef)).data() as TicketTypeDoc | undefined;
      if (tier) {
        tierName = tier.name;
        tx.update(tierRef, {
          quantitySold: Math.max(0, (tier.quantitySold ?? 0) - 1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      tx.update(db().collection(COLLECTIONS.orders).doc(seat.orderId), {
        [`releasedSeats.${rid}`]: seat.ticketTypeId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.update(regRef(rid), {
      status: 'cancelled',
      ...(seat ? { seatRelease: seat } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const access = await setAppAccess(reg.email, false);

  await appendAudit({
    actor,
    action: 'attendee.cancel',
    targetPath: `${COLLECTIONS.registrations}/${rid}`,
    targetId: rid,
    before: { status: 'active' },
    after: { status: 'cancelled', seatReleased: seat ?? null, appAccess: access },
  });

  return {
    ok: true,
    registrationId: rid,
    message:
      `Cancelled ${reg.name ?? reg.email}. Their badge will not scan.` +
      (tierName ? ` One ${tierName} seat is back on sale.` : '') +
      (paid ? ' No money was refunded. Refund the order from Attendee Orders.' : ''),
  };
}

export async function reinstateAttendee(rid: string, actor: string): Promise<AttendeeActionResult> {
  const reg = await readRegistration(rid);
  if (!reg) return { ok: false, error: 'That attendee is no longer on the list.' };
  if (reg.status === 'active') return { ok: false, error: 'This registration is already active.' };
  if (reg.status === 'transferred') {
    return { ok: false, error: 'This ticket was transferred. Add this person again to give them a new one.' };
  }

  let soldOut: string | undefined;
  await db().runTransaction(async (tx) => {
    soldOut = undefined;
    const fresh = (await tx.get(regRef(rid))).data() as RegistrationDoc | undefined;
    if (!fresh || fresh.status !== 'cancelled') return;

    const held = fresh.seatRelease;
    if (held) {
      const orderRef = db().collection(COLLECTIONS.orders).doc(held.orderId);
      const tierRef = db().collection(COLLECTIONS.ticketTypes).doc(held.ticketTypeId);
      const order = (await tx.get(orderRef)).data() as OrderDoc | undefined;
      const tier = (await tx.get(tierRef)).data() as TicketTypeDoc | undefined;

      // Only a seat that is still paid for goes back into the count. If the
      // order was refunded meanwhile the refund left this seat out, and there
      // is nothing to take.
      const stillPaid = order?.status === 'paid' || order?.status === 'partially_refunded';
      if (stillPaid && order?.releasedSeats?.[rid]) {
        if (tier && tier.quantityTotal !== undefined && (tier.quantitySold ?? 0) >= tier.quantityTotal) {
          soldOut = tier.name;
          return;
        }
        if (tier) {
          tx.update(tierRef, {
            quantitySold: (tier.quantitySold ?? 0) + 1,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        tx.update(orderRef, {
          [`releasedSeats.${rid}`]: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    tx.update(regRef(rid), {
      status: 'active',
      seatRelease: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  if (soldOut) {
    return {
      ok: false,
      error: `${soldOut} has sold out since this ticket was cancelled. Raise its quantity, then reinstate.`,
    };
  }

  await setAppAccess(reg.email, true);

  await appendAudit({
    actor,
    action: 'attendee.reinstate',
    targetPath: `${COLLECTIONS.registrations}/${rid}`,
    targetId: rid,
    before: { status: reg.status },
    after: { status: 'active' },
  });

  return {
    ok: true,
    registrationId: rid,
    message: `Reinstated ${reg.name ?? reg.email}. Their badge scans again.`,
  };
}

// ---------------------------------------------------------------------------
// Ticket type
// ---------------------------------------------------------------------------

export async function changeTicketType(
  rid: string,
  ticketType: string,
  actor: string,
): Promise<AttendeeActionResult> {
  const next = ticketType.trim();
  if (!next) return { ok: false, error: 'Choose a ticket type.' };

  const reg = await readRegistration(rid);
  if (!reg) return { ok: false, error: 'That attendee is no longer on the list.' };
  if (reg.ticketType === next) return { ok: false, error: `This ticket is already ${next}.` };

  await regRef(rid).update({ ticketType: next, updatedAt: FieldValue.serverTimestamp() });
  // The ticket rule follows the ticket, unless an organizer set the category by hand.
  const category = await applyRuleTo(rid, next);

  await appendAudit({
    actor,
    action: 'attendee.ticketType',
    targetPath: `${COLLECTIONS.registrations}/${rid}`,
    targetId: rid,
    before: { ticketType: reg.ticketType ?? null },
    after: { ticketType: next },
  });

  return {
    ok: true,
    registrationId: rid,
    message: `${reg.name ?? reg.email} now holds ${next}${category ? ` and is ${category}` : ''}. No payment or refund was made.`,
  };
}

/** What the edit panel needs about one registration. Never the badge secret. */
export interface AttendeeForEdit {
  registrationId: string;
  name: string;
  email: string;
  title: string;
  company: string;
  ticketType: string;
  status: RegistrationDoc['status'];
  transferredTo?: string;
  hasPaidOrder: boolean;
  categoryId: string;
}

export async function getAttendeeForEdit(rid: string): Promise<AttendeeForEdit | null> {
  const reg = await readRegistration(rid);
  if (!reg) return null;
  const orders = await ordersFor(reg.email, rid);
  return {
    registrationId: rid,
    name: reg.name ?? '',
    email: reg.email,
    title: reg.title ?? '',
    company: reg.company ?? '',
    ticketType: reg.ticketType ?? '',
    status: reg.status,
    transferredTo: reg.transferredTo,
    categoryId: reg.categoryId ?? '',
    hasPaidOrder: orders.some((o) => o.status === 'paid' || o.status === 'partially_refunded'),
  };
}
