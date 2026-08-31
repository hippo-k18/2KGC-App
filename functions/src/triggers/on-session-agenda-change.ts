import { COLLECTIONS, SUBCOLLECTIONS } from '@kgc/shared';
import type { SessionDoc, UserDoc } from '@kgc/shared';
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentReference,
  type Firestore,
} from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

import { tickWindow, type WindowCounterDoc } from '../lib/rate-limit.js';
import { SERIAL_FANOUT_TRIGGER } from '../runtime-options.js';

/** Firestore batched writes cap at 500 ops; FCM multicast caps at 500 tokens. */
const BATCH_LIMIT = 500;

/**
 * The debounce. A second material change to the *same* session inside this
 * window is dropped if it says nothing the first one did not already say.
 *
 * Leading edge, not trailing: the first change of a burst notifies
 * immediately, and later ones inside the window are suppressed. An attendee
 * walking to a room needs the notice now, and a trailing-edge debounce would
 * hold every genuine single change back by the length of the window for no
 * benefit.
 *
 * Suppression is by change-set, not by time alone — `changed` is compared
 * against what was already announced, so "room moved, then five seconds later
 * the time moved too" still sends the second notice while "room moved, room
 * moved again to the same field" does not. Coalescing on time alone would
 * silently swallow a real second fact, which is a worse failure than one extra
 * notification.
 */
const COALESCE_WINDOW_MS = 2 * 60_000;

/**
 * The circuit breaker, and the reason this file was rewritten.
 *
 * This trigger is the largest fan-out in the project: one changed session
 * becomes one notification write and one token read for every attendee who
 * saved it. Re-importing a CSV agenda where rooms or times differ updates
 * every changed session at once — at KGC scale (200 sessions changed, 500
 * attendees, 20 saved sessions each) that is roughly 100,000 notification
 * writes and, once `fcmTokens` has a writer, roughly 100,000 real push
 * notifications to real phones.
 *
 * The money there is tens of cents. The 100,000 unwanted pushes are not
 * recoverable, and being blasted about other people's sessions is the single
 * most-cited complaint about the incumbent product — it trains people to turn
 * notifications off, after which nothing you send arrives, including the one
 * that matters.
 *
 * So there is a ceiling: past this many distinct sessions notified inside the
 * window, the fan-out stops and says so, loudly. More than twenty material
 * agenda changes in ten minutes is not an organizer editing the agenda, it is
 * a bulk operation, and the right response to a bulk operation is one
 * announcement — not one push per attendee per session.
 *
 * The window rolls, so the breaker resets itself. That is deliberate: a
 * breaker that latches open until a human clears it would silently stop
 * notifying mid-conference, and nobody would find out until the room change
 * nobody heard about.
 */
const FANOUT_WINDOW_MS = 10 * 60_000;
const FANOUT_MAX_SESSIONS = 20;

/**
 * Both live in `rateLimits` — server-only, no `match` block in
 * `firestore.rules`, unreachable by any client. Prefixed ids, so they can
 * never collide with the OTP counters that share the collection.
 */
const FANOUT_BUDGET_ID = 'agendaNotice_fanout';
const noticeStateId = (sessionId: string) => `agendaNotice_${sessionId}`;

interface AgendaNoticeStateDoc {
  kind: 'agenda-notice';
  sessionId: string;
  /** What was already announced in this window — the debounce compares against it. */
  changed: string[];
  cancelled: boolean;
  lastNoticeAt: Timestamp;
  /** Read only by the Firestore TTL policy. See docs/deploy-functions.md. */
  expiresAt: Timestamp;
}

type Decision = 'send' | 'coalesced' | 'suppressed';

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * The debounce and the breaker, decided together in one transaction.
 *
 * One transaction rather than two checks, because both are read-modify-write
 * on documents this function is racing itself for. `maxInstances: 1` plus
 * `concurrency: 1` (see `SERIAL_FANOUT_TRIGGER`) already serialises the
 * function, so contention here is near zero in practice — the transaction is
 * what keeps the count honest if that ever changes.
 */
async function decide(
  db: Firestore,
  sessionId: string,
  changed: string[],
  cancelled: boolean,
): Promise<Decision> {
  const noticeRef = db.collection(COLLECTIONS.rateLimits).doc(noticeStateId(sessionId));
  const budgetRef = db.collection(COLLECTIONS.rateLimits).doc(FANOUT_BUDGET_ID);

  return db.runTransaction<Decision>(async (tx) => {
    const now = Timestamp.now();
    const noticeSnap = await tx.get(noticeRef);
    const budgetSnap = await tx.get(budgetRef);

    const state = noticeSnap.data() as AgendaNoticeStateDoc | undefined;
    const withinCoalesce =
      Boolean(state) && now.toMillis() - state!.lastNoticeAt.toMillis() < COALESCE_WINDOW_MS;

    if (withinCoalesce) {
      const alreadySaid =
        changed.every((c) => state!.changed.includes(c)) && (!cancelled || state!.cancelled);
      if (alreadySaid) return 'coalesced';
    }

    const nextBudget = tickWindow(
      budgetSnap.data() as WindowCounterDoc | undefined,
      'agenda-fanout',
      now,
      FANOUT_WINDOW_MS,
      FANOUT_MAX_SESSIONS,
    );

    if (!nextBudget) {
      // Merge, so the running window's own fields are left alone — the
      // breaker must not extend its own window every time it trips.
      tx.set(budgetRef, { suppressed: FieldValue.increment(1) }, { merge: true });
      return 'suppressed';
    }

    tx.set(budgetRef, nextBudget, { merge: true });
    tx.set(noticeRef, {
      kind: 'agenda-notice',
      sessionId,
      changed: withinCoalesce ? [...new Set([...state!.changed, ...changed])] : changed,
      cancelled: cancelled || (withinCoalesce ? state!.cancelled : false),
      lastNoticeAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + COALESCE_WINDOW_MS),
    } satisfies AgendaNoticeStateDoc);

    return 'send';
  });
}

/**
 * Devices to push to, honouring `notificationPrefs.sessionReminders`.
 *
 * The preference gate applies to the *push* only, never to the in-app
 * notification document — SPEC.md's Phase 0 decision 5 stands: every attendee
 * who saved the session gets the in-app notice, unconditionally, and there is
 * still no new checkbox. What changed is that the push half now respects the
 * switch that already exists and that the dashboard has always honoured for
 * exactly this message (`apps/organizer/src/lib/push.ts`). An attendee who
 * turned session reminders off and gets a push anyway has been told the switch
 * does not work.
 *
 * Tokens are read before preferences and preferences only for attendees who
 * have at least one device. Nothing writes `fcmTokens` yet, so today that is
 * zero extra reads rather than one per saver; when a writer does exist it is
 * still the cheaper order, because a saver with no device costs one read
 * instead of two.
 */
async function pushTokensFor(db: Firestore, uids: string[]): Promise<string[]> {
  const tokenSnaps = await Promise.all(
    uids.map((uid) => db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.fcmTokens).get()),
  );

  const withDevices = uids
    .map((uid, i) => ({
      uid,
      tokens: tokenSnaps[i].docs
        .map((d) => d.data().token as string | undefined)
        .filter((t): t is string => Boolean(t)),
    }))
    .filter((entry) => entry.tokens.length > 0);
  if (withDevices.length === 0) return [];

  const userRefs: DocumentReference[] = withDevices.map((entry) =>
    db.collection(COLLECTIONS.users).doc(entry.uid),
  );
  const userSnaps = await db.getAll(...userRefs);

  return withDevices.flatMap((entry, i) => {
    const user = userSnaps[i].data() as UserDoc | undefined;
    if (user?.notificationPrefs?.sessionReminders === false) return [];
    return entry.tokens;
  });
}

/**
 * `sessions/{sessionId}` — see functions/SPEC.md #8.
 *
 * Only fires for a session that *was* published — `before.status` is
 * checked, not `after.status`, so a draft being edited has nobody in
 * `savedSessions` relying on it, while a published→cancelled transition
 * still fires this one last time. And only for the fields that change
 * where, when or whether the session happens — `description`, `slidesUrl`
 * and the cached `speakerNames`/`roomName` are display text, not agenda
 * facts, and editing them must not spam every attendee who saved the talk.
 *
 * ⚠️ THIS TRIGGER IS THE SOLE OWNER OF THE ROOM/TIME-CHANGE PUSH. The
 * dashboard's `roomChangePush()` used to send the same message from the same
 * event; deploying this function alongside it would have delivered two
 * notifications to every device. The trigger won because it catches changes
 * made by the CSV importer and by scripts, not only by the dashboard UI —
 * `apps/organizer/src/lib/push.ts` now computes the audience and reports it,
 * and sends nothing. Do not re-arm that path. (Announcements went the other
 * way: the dashboard owns them, and `onAnnouncementCreate` no longer sends.)
 *
 * The notification id is the event's own id (stable across a Cloud
 * Functions retry of the *same* delivery), not a generated one — a retry
 * `set()`s the same document again instead of duplicating the notification.
 * It is not `sessionId`, unlike `onAnnouncementCreate`'s use of
 * `announcementId`, because a session can legitimately change again later
 * and each change is its own notification.
 */
export const onSessionAgendaChange = onDocumentUpdated(
  { document: `${COLLECTIONS.sessions}/{sessionId}`, ...SERIAL_FANOUT_TRIGGER },
  async (event) => {
    const change = event.data;
    if (!change) return;

    // Both can be undefined on a retried delivery whose document has since
    // been deleted — see the same guard, and the same reason, in
    // `on-announcement-create.ts`.
    const before = change.before.data() as SessionDoc | undefined;
    const after = change.after.data() as SessionDoc | undefined;
    if (!before || !after) return;
    if (before.status !== 'published') return;

    const changed: string[] = [];
    if (before.roomId !== after.roomId) changed.push('room');
    if (before.startsAtLocal !== after.startsAtLocal || before.endsAtLocal !== after.endsAtLocal) {
      changed.push('time');
    }
    if (before.day !== after.day) changed.push('day');
    const cancelled = after.status === 'cancelled';
    if (changed.length === 0 && !cancelled) return;

    const { sessionId } = event.params;
    const db = getFirestore();

    const decision = await decide(db, sessionId, changed, cancelled);
    if (decision === 'coalesced') {
      console.log(
        `[onSessionAgendaChange] ${sessionId}: already announced ${joinWithAnd(changed)} within the last ` +
          `${COALESCE_WINDOW_MS / 1000}s — not notifying again.`,
      );
      return;
    }
    if (decision === 'suppressed') {
      // console.error, not console.log: this is the line that should page
      // somebody. It means an agenda-wide change is in flight, and the right
      // response is one announcement to the event, not one push per attendee
      // per session. See the FANOUT_MAX_SESSIONS docblock.
      console.error(
        `[onSessionAgendaChange] FAN-OUT SUPPRESSED for ${sessionId}: more than ${FANOUT_MAX_SESSIONS} ` +
          `sessions changed materially in the last ${FANOUT_WINDOW_MS / 60_000} minutes. This looks like a ` +
          `bulk agenda import. Nobody was notified about this session. Post one announcement instead.`,
      );
      return;
    }

    const savedSnap = await db
      .collectionGroup(SUBCOLLECTIONS.savedSessions)
      .where('sessionId', '==', sessionId)
      .get();

    const uids = savedSnap.docs
      .map((d) => d.ref.parent.parent?.id)
      .filter((uid): uid is string => Boolean(uid));
    if (uids.length === 0) return;

    const title = after.title;
    const body = cancelled ? `${title} has been cancelled.` : `${title}'s ${joinWithAnd(changed)} changed.`;
    const href = `/agenda/${sessionId}`;

    for (const page of chunk(uids, BATCH_LIMIT)) {
      const batch = db.batch();
      for (const uid of page) {
        batch.set(
          db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.notifications).doc(event.id),
          {
            type: 'agenda-change',
            title,
            body,
            href,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          },
        );
      }
      await batch.commit();
    }

    const tokens = await pushTokensFor(db, uids);
    for (const page of chunk(tokens, BATCH_LIMIT)) {
      await getMessaging().sendEachForMulticast({
        tokens: page,
        notification: { title, body },
      });
    }
  },
);
