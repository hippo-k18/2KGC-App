import 'server-only';

import { getMessaging } from 'firebase-admin/messaging';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  type PushTokenDoc,
  type UserDoc,
} from '@kgc/shared';
import { recordError } from './errors';
import { db } from './firestore';

/**
 * Push, sent from this dashboard with the Admin SDK — no Cloud Functions.
 *
 * The project has been treating push as blocked on the Blaze plan. It is not.
 * Blaze is required to *deploy a Cloud Function* (unconditionally so since
 * February 2026), and nothing else here needs one: FCM's send API is part of
 * the Admin SDK, this dashboard is already a trusted Node server holding
 * service-account credentials, and the Spark plan does not rate-limit or
 * disable FCM. So the send happens here, in the same server action that made
 * the write that justifies it.
 *
 * That is not merely a workaround — for announcements it is arguably the better
 * shape, because the thing that decides to notify and the thing that notifies
 * are one transaction-adjacent code path instead of two systems agreeing.
 * What it genuinely cannot do is react to a write made by *a client*: nothing
 * calls this when an attendee posts a reply, which is why counters still want a
 * trigger. Push does not, because push is always something an organizer chose.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS AND IS NOT VERIFIED
 *
 * The targeting half — the collection-group query, the token gather, the
 * preference filter, the 500-token chunking — is real code exercised against
 * the emulator. The final `send` / `sendEachForMulticast` call is real too, but
 * it cannot reach FCM from the emulator and has never been run against the live
 * project, because that needs service-account credentials this laptop does not
 * have and a development build of the app to receive it (Expo Go cannot).
 *
 * So this module refuses rather than pretends. `canSend()` is false whenever
 * `FIRESTORE_EMULATOR_HOST` is set, and every function returns
 * `wired: false` with the audience it *would* have reached. A push path that
 * silently no-ops while reporting success is the exact defect class AGENTS.md
 * warns about; one that tells you "23 devices, not sent, no credentials" is
 * useful on the way to being finished.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface PushOutcome {
  /** True only if FCM actually accepted the message. */
  wired: boolean;
  detail: string;
  /** Devices the message was addressed to, whether or not it was sent. */
  recipients?: number;
  /** Per-token failures reported by FCM, when a send did happen. */
  failed?: number;
}

/**
 * Whether a real send is possible right now.
 *
 * Pointing at the emulator is the disqualifier, not the absence of a key: the
 * Admin SDK will happily initialise against the emulator and then try to reach
 * the real FCM endpoint, which either fails confusingly or — far worse, if
 * credentials happen to be present — sends a live notification to a thousand
 * people from what everybody in the room believes is a local test.
 */
export function canSend(): { ok: boolean; why: string } {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return {
      ok: false,
      why: `pointed at the emulator (${process.env.FIRESTORE_EMULATOR_HOST}), so nothing is sent`,
    };
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { ok: false, why: 'no service-account credentials on this machine' };
  }
  return { ok: true, why: '' };
}

/** FCM's hard limit for one multicast call. */
const MULTICAST_CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The event-wide topic. One name, derived, never spelled at a call site. */
export function announcementTopic(): string {
  return `event-${EVENT_ID}-announcements`;
}

/**
 * Broadcast an announcement to the event topic.
 *
 * One FCM call, not a per-device fan-out. A thousand writes to deliver one
 * message is what makes the announcement button the most expensive control in
 * the product, and the per-user `notificationPrefs.announcements` switch is
 * honoured at *subscribe* time — the app subscribes or unsubscribes the device
 * from this topic when the switch moves — so it costs nothing at send time.
 */
export async function announcementPush(args: {
  announcementId: string;
  title: string;
  body?: string;
}): Promise<PushOutcome> {
  const topic = announcementTopic();
  const gate = canSend();

  if (!gate.ok) {
    const detail = `Not sent — ${gate.why}. Would broadcast "${args.title}" to topic ${topic}.`;
    console.info(`[push] ${detail}`);
    return { wired: false, detail };
  }

  try {
    const id = await getMessaging().send({
      topic,
      notification: { title: args.title, body: args.body ?? '' },
      data: { kind: 'announcement', announcementId: args.announcementId, eventId: EVENT_ID },
      apns: { payload: { aps: { sound: 'default' } } },
      android: { priority: 'high' },
    });
    return { wired: true, detail: `Broadcast to ${topic} (message ${id}).` };
  } catch (err) {
    recordError('push.announcement', err);
    return {
      wired: false,
      detail: err instanceof Error ? `FCM refused the broadcast: ${err.message}` : 'FCM refused the broadcast.',
    };
  }
}

/**
 * Everyone who saved this session and asked to be reminded, with their devices.
 *
 * Exported and separately testable on purpose: this is the half that runs
 * against the emulator, and it is where the bugs would be. The query is a
 * collection group over `savedSessions` filtered on `remind` and `sessionId`,
 * which is exactly the composite index `firestore.indexes.json` already
 * declares — so it works in production and is not one of the queries that
 * passes locally and fails with `failed-precondition`.
 */
export async function roomChangeAudience(sessionId: string): Promise<{
  uids: string[];
  tokens: string[];
  optedOut: number;
}> {
  const saved = await db()
    .collectionGroup(SUBCOLLECTIONS.savedSessions)
    .where('remind', '==', true)
    .where('sessionId', '==', sessionId)
    .get();

  // `users/{uid}/savedSessions/{id}` — the grandparent is the user document.
  const uids = [
    ...new Set(saved.docs.map((d) => d.ref.parent.parent?.id).filter((v): v is string => Boolean(v))),
  ];
  if (uids.length === 0) return { uids: [], tokens: [], optedOut: 0 };

  const tokens: string[] = [];
  let optedOut = 0;

  await Promise.all(
    uids.map(async (uid) => {
      const userSnap = await db().collection(COLLECTIONS.users).doc(uid).get();
      const user = userSnap.data() as UserDoc | undefined;

      // A session reminder is governed by `sessionReminders`, not
      // `announcements`. Conflating the two is how "I turned off marketing"
      // becomes "I never heard my room moved".
      if (user && user.notificationPrefs?.sessionReminders === false) {
        optedOut += 1;
        return;
      }

      const devices = await db()
        .collection(COLLECTIONS.users)
        .doc(uid)
        .collection(SUBCOLLECTIONS.fcmTokens)
        .get();

      for (const d of devices.docs) {
        const t = (d.data() as PushTokenDoc).token;
        if (t) tokens.push(t);
      }
    }),
  );

  return { uids, tokens: [...new Set(tokens)], optedOut };
}

/**
 * Tell the people who saved a session that its room moved.
 *
 * Targeted, never a topic. Blasting a thousand people about one room change is
 * the single most-cited complaint about the incumbent, and it trains people to
 * disable notifications entirely — after which nothing you send arrives,
 * including the one that matters.
 */
export async function roomChangePush(args: {
  sessionId: string;
  title: string;
  roomName: string;
}): Promise<PushOutcome> {
  let audience: Awaited<ReturnType<typeof roomChangeAudience>>;
  try {
    audience = await roomChangeAudience(args.sessionId);
  } catch (err) {
    recordError('push.roomChange.audience', err);
    return { wired: false, detail: 'Could not work out who to notify.' };
  }

  const { tokens, uids, optedOut } = audience;
  const who =
    `${uids.length} attendee${uids.length === 1 ? '' : 's'} saved it` +
    (optedOut ? `, ${optedOut} opted out of session reminders` : '') +
    `, ${tokens.length} device${tokens.length === 1 ? '' : 's'}`;

  if (tokens.length === 0) {
    return {
      wired: false,
      recipients: 0,
      detail: `Nobody to notify — ${who}. Nothing writes fcmTokens yet, so this is expected.`,
    };
  }

  const gate = canSend();
  if (!gate.ok) {
    return {
      wired: false,
      recipients: tokens.length,
      detail: `Not sent — ${gate.why}. Would notify ${who}.`,
    };
  }

  const message = {
    notification: {
      title: 'Room change',
      body: `${args.title} is now in ${args.roomName}.`,
    },
    data: { kind: 'roomChange', sessionId: args.sessionId, eventId: EVENT_ID },
  };

  try {
    let failed = 0;
    for (const batch of chunk(tokens, MULTICAST_CHUNK)) {
      const res = await getMessaging().sendEachForMulticast({ ...message, tokens: batch });
      failed += res.failureCount;
    }
    return {
      wired: true,
      recipients: tokens.length,
      failed,
      detail: `Notified ${who}${failed ? `; ${failed} device(s) rejected` : ''}.`,
    };
  } catch (err) {
    recordError('push.roomChange', err);
    return {
      wired: false,
      recipients: tokens.length,
      detail: err instanceof Error ? `FCM refused the send: ${err.message}` : 'FCM refused the send.',
    };
  }
}

/** Kept so a wiring mistake shows up in the report rather than silently. */
export function reportPushFailure(context: string, err: unknown): void {
  recordError(context, err);
}
