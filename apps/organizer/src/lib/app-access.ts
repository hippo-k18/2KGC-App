import 'server-only';

import {
  APP_ACCESS_KEY,
  COLLECTIONS,
  EVENT_ID,
  accessWindowWallClocks,
  normaliseJoinCode,
  type AppAccessProjection,
  type EventBasics,
} from '@kgc/shared';
import { eventBasics } from './event';
import { recordError } from './errors';
import { db } from './firestore';
import { SETTINGS_KEYS, readSettings } from './settings';
import { fromWallClock } from './time';

/**
 * `settings/appAccess` — the access settings, projected for the phone.
 *
 * ── Why this writes a second document ───────────────────────────────────────
 *
 * `settings/access` is where an organizer types. It also holds `staffNote`,
 * written for the check-in desk, and rules filter documents rather than fields,
 * so opening that bag to a phone opens all of it. This is the same answer
 * `directory/{uid}` gives for `users/{uid}` and `exhibitorListings` for
 * `exhibitors`: a projection carrying only what the reader may have.
 *
 * It is written by this server and read by two things that cannot compute it:
 * the app, and `firestore.rules`, which has no date parser and no arithmetic
 * beyond comparing `request.time.toMillis()` against a stored number. So the
 * dates are resolved here, once, into epoch milliseconds.
 *
 * ── Called from every save that can change the answer ───────────────────────
 *
 * The access settings are two screens, and the event's end date is a third —
 * "30 days after the event" moves when the event does. All three call this, so
 * the projection cannot be left describing a window nobody chose. A save that
 * cannot write it does not fail: the settings document is the record, this is a
 * cache of it, and the caller says so on the page rather than refusing the save.
 */
export async function writeAppAccessProjection(
  /**
   * The event's dates and zone, when the caller has just changed them.
   *
   * ⚠️ Not an optimisation. `eventBasics()` is `cache()`d per request, and
   * Content › Basics reads it *before* its own save to work out what moved —
   * so calling it again in the same request hands back the dates the organizer
   * just replaced, and the projection would describe the old event.
   */
  basicsOverride?: EventBasics,
): Promise<
  | { ok: true; values: AppAccessProjection; window: { readOnlyFrom: string | null; closesAt: string | null } }
  | { ok: false; error: string }
> {
  try {
    const [access, resolved] = await Promise.all([
      readSettings(SETTINGS_KEYS.access),
      basicsOverride ? Promise.resolve(basicsOverride) : eventBasics(),
    ]);
    const basics = resolved;

    const { readOnlyFrom, closesAt } = accessWindowWallClocks({
      endDate: basics.endDate,
      postEventDays: access.postEventDays,
      postEventReadOnly: access.postEventReadOnly,
    });

    /**
     * Wall clock into an instant, in the event's own zone.
     *
     * Never `new Date('2027-06-06T23:59')`, which resolves in whatever zone the
     * process runs in: on Netlify's UTC servers that is four hours early, and
     * an app that closes at 19:59 on the last evening is the same bug
     * `fromWallClock` exists for on the agenda.
     */
    const instant = (local: string | null): number =>
      local ? fromWallClock(local, basics.timeZone).toMillis() : 0;

    const values: AppAccessProjection = {
      closesAtMs: instant(closesAt),
      readOnlyFromMs: instant(readOnlyFrom),
      messagingEnabled: access.attendeeMessagingEnabled,
      joinCode: normaliseJoinCode(access.eventCode),
      joinCodeRequired: access.codeRequired && normaliseJoinCode(access.eventCode).length > 0,
    };

    await db()
      .collection(COLLECTIONS.settings)
      .doc(APP_ACCESS_KEY)
      .set(
        { eventId: EVENT_ID, key: APP_ACCESS_KEY, values, updatedAt: new Date() },
        { merge: true },
      );

    return { ok: true, values, window: { readOnlyFrom, closesAt } };
  } catch (err) {
    recordError('appAccess.project', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update the app.' };
  }
}
