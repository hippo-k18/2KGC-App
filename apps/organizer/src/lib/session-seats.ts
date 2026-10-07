import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  planLeaveSeat,
  planLeaveWaitlist,
  planPromotions,
  seatStateOf,
  type RegistrationDoc,
  type SeatState,
  type SessionDoc,
  type SessionSeatDoc,
  type UserDoc,
} from '@kgc/shared';
import { sendBulkMessage } from '@kgc/scripts/src/lib/email';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * Session seats, from the organizer's side: who holds one, who is waiting, and
 * the two things an organizer does about it.
 *
 * Attendees take and give up seats from the app, inside a transaction that
 * `firestore.rules` re-checks. The writes here go through the Admin SDK, which
 * bypasses the rules, so they keep the same invariants by calling the same
 * planning functions from `@kgc/shared`: `taken` equals the number of seated
 * documents, and the waitlist on the counter lists exactly the waitlisted ones,
 * in order.
 */

export type SeatCounts = Map<string, SeatState>;

/** Every session's counter, keyed by session id. A session nobody joined is absent. */
export async function seatCounts(): Promise<SeatCounts> {
  const snap = await db().collection(COLLECTIONS.sessionSeats).where('eventId', '==', EVENT_ID).get();
  return new Map(snap.docs.map((d) => [d.id, seatStateOf(d.data())]));
}

export interface SeatHolder {
  uid: string;
  registrationId: string;
  name: string;
  email: string;
  ticketType?: string;
  status: SessionSeatDoc['status'];
  /** 1-based, for the waitlisted only. */
  position?: number;
  /** ISO, for display. */
  since?: string;
}

export interface SessionSeats {
  state: SeatState;
  seated: SeatHolder[];
  waitlisted: SeatHolder[];
}

function iso(v: unknown): string | undefined {
  const d = (v as { toDate?: () => Date } | undefined)?.toDate?.();
  return d ? d.toISOString() : undefined;
}

/** One session's people, named from their registration. */
export async function sessionSeats(sessionId: string): Promise<SessionSeats> {
  const counterRef = db().collection(COLLECTIONS.sessionSeats).doc(sessionId);
  const [counterSnap, seatSnap] = await Promise.all([
    counterRef.get(),
    counterRef.collection(SUBCOLLECTIONS.seats).get(),
  ]);
  const state = seatStateOf(counterSnap.data());
  const seats = seatSnap.docs.map((d) => d.data() as SessionSeatDoc);

  const regRefs = seats.map((s) => db().collection(COLLECTIONS.registrations).doc(s.registrationId));
  const regSnaps = regRefs.length ? await db().getAll(...regRefs) : [];
  const regs = new Map(regSnaps.map((r) => [r.id, r.data() as RegistrationDoc | undefined]));

  const holders = seats.map((s): SeatHolder => {
    const reg = regs.get(s.registrationId);
    const position = state.waitlist.indexOf(s.uid);
    return {
      uid: s.uid,
      registrationId: s.registrationId,
      name: reg?.name ?? reg?.email ?? s.uid,
      email: reg?.email ?? '',
      ticketType: reg?.ticketType,
      status: s.status,
      position: s.status === 'waitlisted' && position >= 0 ? position + 1 : undefined,
      since: iso(s.promotedAt) ?? iso(s.createdAt),
    };
  });

  return {
    state,
    seated: holders
      .filter((h) => h.status === 'seated')
      .sort((a, b) => a.name.localeCompare(b.name)),
    waitlisted: holders
      .filter((h) => h.status === 'waitlisted')
      .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9)),
  };
}

export interface SeatOutcome {
  ok: boolean;
  error?: string;
  /** Uids moved from the waitlist into a seat by this write. */
  promoted: string[];
  sessionTitle?: string;
}

/**
 * Tells a promoted attendee. The app shows the seat by itself, from its own
 * listener; this is the in-app notification and the email for somebody who is
 * not looking at their phone. Never throws: the seat is already theirs.
 */
async function notifyPromoted(
  sessionId: string,
  sessionTitle: string,
  uids: string[],
  actor: string,
): Promise<void> {
  for (const uid of uids) {
    try {
      await db()
        .collection(COLLECTIONS.users)
        .doc(uid)
        .collection(SUBCOLLECTIONS.notifications)
        .add({
          type: 'agenda-change',
          title: 'You have a seat',
          body: `A seat opened in ${sessionTitle}. It is yours and it is in your agenda.`,
          href: `/agenda/${sessionId}`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });

      const user = (await db().collection(COLLECTIONS.users).doc(uid).get()).data() as
        | UserDoc
        | undefined;
      if (!user?.email) continue;
      await sendBulkMessage(db(), {
        to: user.email,
        name: user.name,
        subject: `You have a seat in ${sessionTitle}`,
        body: `A seat opened in ${sessionTitle} and you were first on the waitlist, so it is yours.\n\nIt is already in your agenda in the conference app. If you can no longer come, remove it there and the seat goes to the next person waiting.`,
        campaignId: `seat-promotion_${sessionId}`,
        actor,
      });
    } catch (err) {
      recordError('sessionSeats.notifyPromoted', err);
    }
  }
}

/**
 * Takes somebody out of a session: seat or waitlist place, and the entry on
 * their schedule. A freed seat goes to the first person waiting, in the same
 * transaction, exactly as it would had the attendee left by themselves.
 */
export async function removeFromSession(
  sessionId: string,
  uid: string,
  actor: string,
): Promise<SeatOutcome> {
  const sessionRef = db().collection(COLLECTIONS.sessions).doc(sessionId);
  const counterRef = db().collection(COLLECTIONS.sessionSeats).doc(sessionId);
  const seatRef = counterRef.collection(SUBCOLLECTIONS.seats).doc(uid);

  const outcome = await db().runTransaction(async (tx): Promise<SeatOutcome> => {
    const [sessionSnap, counterSnap, seatSnap] = await tx.getAll(sessionRef, counterRef, seatRef);
    if (!seatSnap.exists) return { ok: false, error: 'That person is no longer in this session.', promoted: [] };

    const session = (sessionSnap.data() ?? {}) as Partial<SessionDoc>;
    const seat = seatSnap.data() as SessionSeatDoc;
    const state = seatStateOf(counterSnap.data());

    const plan =
      seat.status === 'seated'
        ? planLeaveSeat(state, session)
        : { next: planLeaveWaitlist(state, uid), promote: null };

    tx.set(
      counterRef,
      { eventId: EVENT_ID, sessionId, ...plan.next, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.delete(seatRef);
    tx.delete(
      db().collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.savedSessions).doc(sessionId),
    );
    if (plan.promote) {
      tx.update(counterRef.collection(SUBCOLLECTIONS.seats).doc(plan.promote), {
        status: 'seated',
        promotedAt: FieldValue.serverTimestamp(),
      });
    }
    return { ok: true, promoted: plan.promote ? [plan.promote] : [], sessionTitle: session.title };
  });

  if (outcome.ok && outcome.promoted.length) {
    await notifyPromoted(sessionId, outcome.sessionTitle ?? 'your session', outcome.promoted, actor);
  }
  return outcome;
}

/**
 * Sets a session's cap and lets in as many of the waitlist as the new number
 * allows, in order. Lowering a cap below the seats taken removes nobody.
 * `null` removes the cap, which seats everybody waiting.
 */
export async function setSessionCap(
  sessionId: string,
  capacity: number | null,
  actor: string,
): Promise<SeatOutcome & { before?: number }> {
  const sessionRef = db().collection(COLLECTIONS.sessions).doc(sessionId);
  const counterRef = db().collection(COLLECTIONS.sessionSeats).doc(sessionId);

  const outcome = await db().runTransaction(async (tx) => {
    const [sessionSnap, counterSnap] = await tx.getAll(sessionRef, counterRef);
    if (!sessionSnap.exists) return { ok: false, error: 'That session no longer exists.', promoted: [] };

    const session = sessionSnap.data() as SessionDoc;
    const state = seatStateOf(counterSnap.data());
    const plan = planPromotions(state, { capacity: capacity ?? undefined });

    tx.update(sessionRef, {
      capacity: capacity ?? FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (plan.promoted.length) {
      tx.set(
        counterRef,
        { eventId: EVENT_ID, sessionId, ...plan.next, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      for (const uid of plan.promoted) {
        tx.update(counterRef.collection(SUBCOLLECTIONS.seats).doc(uid), {
          status: 'seated',
          promotedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    return { ok: true, promoted: plan.promoted, sessionTitle: session.title, before: session.capacity };
  });

  if (outcome.ok && outcome.promoted.length) {
    await notifyPromoted(sessionId, outcome.sessionTitle ?? 'your session', outcome.promoted, actor);
  }
  return outcome;
}

/**
 * Which ticket types may take a seat, as ticket type names. An empty list opens
 * the session to every ticket. People already seated keep their seats.
 */
export async function setEligibleTicketTypes(
  sessionId: string,
  names: string[],
): Promise<{ ok: boolean; error?: string; before: string[]; title?: string }> {
  const ref = db().collection(COLLECTIONS.sessions).doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'That session no longer exists.', before: [] };
  const session = snap.data() as SessionDoc;
  await ref.update({
    eligibleTicketTypes: names.length ? names : FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, before: session.eligibleTicketTypes ?? [], title: session.title };
}
