import 'server-only';

// This app's own copy of `firebase-admin`. A sentinel built anywhere else fails
// the whole write on an `instanceof` check — AGENTS.md gotcha 8.
import { FieldValue } from 'firebase-admin/firestore';
import {
  APP_ACCESS_KEY,
  APP_JOIN_CODE_KEY,
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

    const joinCode = normaliseJoinCode(access.eventCode);

    const values: AppAccessProjection = {
      closesAtMs: instant(closesAt),
      readOnlyFromMs: instant(readOnlyFrom),
      messagingEnabled: access.attendeeMessagingEnabled,
      joinCodeRequired: access.codeRequired && joinCode.length > 0,
    };

    /*
     * Two documents, because two audiences. The window has to reach anybody
     * signed in — a closed app must be able to read the sentence that says it
     * is closed, and `isRegistered()` ends with `appOpen()` — while the code
     * belongs only to people who hold a ticket. One document could not be both,
     * and while the code was in this one any account at all could read it.
     */
    await Promise.all([
      db()
        .collection(COLLECTIONS.settings)
        .doc(APP_ACCESS_KEY)
        .set(
          {
            eventId: EVENT_ID,
            key: APP_ACCESS_KEY,
            values: {
              ...values,
              /*
               * The code used to be a key in this map, and a merge write leaves
               * a key it does not mention exactly where it was (AGENTS.md
               * gotcha 9, in its nested form). So every projection written
               * before the split would keep handing the old code to anybody
               * signed in, and the split would have changed nothing on any
               * database that already exists. Naming it is what removes it.
               */
              joinCode: FieldValue.delete(),
            },
            updatedAt: new Date(),
          },
          { merge: true },
        ),
      db()
        .collection(COLLECTIONS.settings)
        .doc(APP_JOIN_CODE_KEY)
        .set(
          {
            eventId: EVENT_ID,
            key: APP_JOIN_CODE_KEY,
            values: { joinCode },
            updatedAt: new Date(),
          },
          { merge: true },
        ),
    ]);

    return { ok: true, values, window: { readOnlyFrom, closesAt } };
  } catch (err) {
    recordError('appAccess.project', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update the app.' };
  }
}
