import 'server-only';

import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  agendaNoticeBody,
  agendaNoticeId,
  type AgendaChange,
} from '@kgc/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { recordError } from './errors';
import { db } from './firestore';

/** Firestore batched writes cap at 500 operations. */
const BATCH_LIMIT = 500;

export interface AgendaNoticeOutcome {
  /** How many attendees were written a notice. */
  notified: number;
  /** One line for the organizer, always safe to print. */
  detail: string;
}

/**
 * Tell everyone who saved a session that it has moved.
 *
 * ── Why the dashboard writes this and not a trigger ─────────────────────────
 *
 * `onSessionAgendaChange` is written, tested and **undeployed** — it waits on
 * the `iam.serviceAccounts.ActAs` grant in `OWNER-ACTIONS.md` §3, and has since
 * August. Until that lands nothing tells an attendee their keynote moved, which
 * is the single thing an event app is for on the morning it happens. So the
 * action that made the change writes the notice, in the same request.
 *
 * ── Both writers, one notice ────────────────────────────────────────────────
 *
 * On the day the trigger is deployed, both fire for the same edit. The id is
 * what makes that harmless: `agendaNoticeId()` names *where the session ended
 * up*, not the change, so two writers describing one outcome produce one
 * `set()` over another rather than two notifications on one phone. The trigger
 * uses the same function. A generated id would make the duplicate a thing to
 * detect and resolve; this makes it unrepresentable, which is the trick
 * `checkIns` already uses for a double scan.
 *
 * Moving a session to 15:00 and then to 16:00 is two states and therefore two
 * notices, which is right — and moving it *back* rewrites the first one
 * instead of adding a third.
 *
 * ── The audience is everyone who saved it ───────────────────────────────────
 *
 * Not everyone who saved it *and asked for reminders*. `notificationPrefs
 * .sessionReminders` governs a push — something that buzzes in a pocket — and
 * an in-app notice on the home screen is the app being correct about its own
 * contents. Somebody who turned push off has not asked to be told the wrong
 * room. `roomChangeAudience()` in `push.ts` is the other half and keeps the
 * `remind` filter, for the thing that filter is about.
 *
 * The query is a collection group over `savedSessions` filtered on `sessionId`,
 * which `firestore.indexes.json` covers with a COLLECTION_GROUP single-field
 * override on that field — so it works in production rather than being one of
 * the queries that passes locally and fails with `failed-precondition`.
 *
 * Never throws. A programme change that saved and then failed to notify is a
 * change that saved; the caller reports the notice separately.
 */
export async function notifySessionMoved(input: {
  sessionId: string;
  title: string;
  /** The wall clock the session ended up at, `YYYY-MM-DDTHH:mm`. */
  startsAtLocal: string;
  /** The room it ended up in, or null for none. */
  roomId: string | null;
  changed: AgendaChange[];
  cancelled: boolean;
}): Promise<AgendaNoticeOutcome> {
  if (input.changed.length === 0 && !input.cancelled) {
    return { notified: 0, detail: '' };
  }

  try {
    const saved = await db()
      .collectionGroup(SUBCOLLECTIONS.savedSessions)
      .where('sessionId', '==', input.sessionId)
      .get();

    // `users/{uid}/savedSessions/{id}` — the grandparent is the user document.
    const uids = [
      ...new Set(
        saved.docs.map((d) => d.ref.parent.parent?.id).filter((v): v is string => Boolean(v)),
      ),
    ];
    if (uids.length === 0) {
      return { notified: 0, detail: 'Nobody has this session on their schedule, so nobody was told.' };
    }

    const noticeId = agendaNoticeId({
      sessionId: input.sessionId,
      startsAtLocal: input.startsAtLocal,
      roomId: input.roomId,
      cancelled: input.cancelled,
    });
    const body = agendaNoticeBody({
      title: input.title,
      changed: input.changed,
      cancelled: input.cancelled,
    });

    for (let i = 0; i < uids.length; i += BATCH_LIMIT) {
      const batch = db().batch();
      for (const uid of uids.slice(i, i + BATCH_LIMIT)) {
        batch.set(
          db()
            .collection(COLLECTIONS.users)
            .doc(uid)
            .collection(SUBCOLLECTIONS.notifications)
            .doc(noticeId),
          {
            type: 'agenda-change',
            title: input.title,
            body,
            href: `/agenda/${input.sessionId}`,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          },
        );
      }
      await batch.commit();
    }

    return {
      notified: uids.length,
      detail: `Told ${uids.length} ${uids.length === 1 ? 'attendee' : 'attendees'} who saved it.`,
    };
  } catch (err) {
    recordError(`agendaNotice ${input.sessionId}`, err);
    return { notified: 0, detail: 'The change saved. Nobody could be told about it.' };
  }
}
