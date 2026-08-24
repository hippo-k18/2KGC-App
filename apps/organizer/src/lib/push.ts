import 'server-only';

import { recordError } from './errors';

/**
 * ────────────────────────────────────────────────────────────────────────────
 *  PUSH SEAM — NOT WIRED. Nothing here sends a notification yet.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * These two functions are the only places the console will ever ask for a push,
 * so wiring FCM later is a change to this file and to nothing else. They log
 * and return.
 *
 * What replaces the bodies, per DECISIONS.md #7 and WP-17:
 *
 *   announcementPush()  → ONE FCM topic send (`event-kgc-2027-announcements`).
 *                         Never a per-device Firestore fan-out: 1,000 writes to
 *                         deliver one message is the pattern that makes the
 *                         announcement button the most expensive control in the
 *                         product. Honour `notificationPrefs.announcements` via
 *                         topic subscription, at subscribe time, not send time.
 *
 *   roomChangePush()    → targeted, NOT a topic. Only attendees with this
 *                         session in `users/{uid}/savedSessions/{sessionId}`.
 *                         A collectionGroup query on `savedSessions` where
 *                         `sessionId == id` gives the uids; their `fcmTokens`
 *                         subcollections give the tokens; `messaging()
 *                         .sendEachForMulticast()` in chunks of 500 sends it.
 *                         Blasting everyone for a room change is Whova's single
 *                         most-cited complaint and trains people to disable
 *                         notifications entirely — after which nothing you send
 *                         arrives, including the one that matters.
 *
 * Both need the FCM path from WP-02. Do not build a second one here. FCM works
 * on the Spark plan via the Admin SDK from the laptop, so this can be finished
 * without Blaze — it is unbuilt because WP-02 owns it, not because it is blocked.
 */

export interface PushOutcome {
  wired: boolean;
  detail: string;
}

export async function roomChangePush(args: {
  sessionId: string;
  title: string;
  roomName: string;
}): Promise<PushOutcome> {
  const detail =
    `[push seam] would notify attendees who saved ${args.sessionId}: ` +
    `"Room change: ${args.title} is now in ${args.roomName}."`;
  console.info(detail);
  return { wired: false, detail };
}

export async function announcementPush(args: {
  announcementId: string;
  title: string;
}): Promise<PushOutcome> {
  const detail =
    `[push seam] would broadcast announcement ${args.announcementId} ` +
    `("${args.title}") to the event FCM topic.`;
  console.info(detail);
  return { wired: false, detail };
}

/** Kept so a future wiring mistake shows up in the war room rather than silently. */
export function reportPushFailure(context: string, err: unknown): void {
  recordError(context, err);
}
