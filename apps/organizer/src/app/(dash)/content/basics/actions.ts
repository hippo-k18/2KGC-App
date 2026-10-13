'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  resolveEventBasics,
  validateEventSettings,
  type EventSettings,
  type SessionDoc,
} from '@kgc/shared';
import { writeAppAccessProjection } from '@/lib/app-access';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import { eventBasics } from '@/lib/event';
import { db } from '@/lib/firestore';
import { SETTINGS_KEYS, saveSettings } from '@/lib/settings';
import { deriveTimes } from '@/lib/time';
import type { FormState } from '../../form';

/**
 * Content > Basics: the event's name, dates, time zone, venue and type.
 *
 * Every field may be left empty. An empty field is cleared from
 * `settings/event`, and every reader then falls back to the constant in
 * `@kgc/shared` through `resolveEventBasics`, which is what each surface showed
 * before this was editable.
 *
 * ── The time zone ───────────────────────────────────────────────────────────
 *
 * A session stores its wall-clock strings and its own `timeZone`, and its UTC
 * instants are derived from the pair. Saving a new zone here therefore changes
 * where *new* sessions are authored and nothing else, unless the organizer
 * ticks "move existing sessions": then every session still in the old event
 * zone keeps its wall clock ("09:00") and has `startsAt`, `endsAt` and `day`
 * re-derived in the new one. A session imported in some other zone on purpose
 * is left alone.
 */
export async function saveBasicsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireOrganizer();

  const text = (k: string) => String(formData.get(k) ?? '').trim();
  const input: EventSettings = {
    name: text('name'),
    shortName: text('shortName'),
    startDate: text('startDate'),
    endDate: text('endDate'),
    timeZone: text('timeZone'),
    venue: text('venue'),
    eventType: text('eventType'),
  };

  const fieldErrors = validateEventSettings(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Some fields need attention.', fieldErrors };
  }

  const before = await eventBasics();
  const after = resolveEventBasics(input);

  const saved = await saveSettings(
    SETTINGS_KEYS.event,
    {
      name: input.name || null,
      shortName: input.shortName || null,
      startDate: input.startDate || null,
      endDate: input.endDate || null,
      timeZone: input.timeZone || null,
      venue: input.venue || null,
      eventType: input.eventType || null,
    },
    actor,
  );
  if (!saved.ok) return { error: saved.error };

  /*
   * The app's access window is "the end of the event plus N days", so moving
   * the end date moves it. Rewritten here rather than only on the two access
   * screens, because an organizer who pushes the event back a week has no
   * reason to visit those screens and would otherwise have the app close on
   * the old date. `eventBasics()` is per-request cached, and the projection
   * reads it after this save, so it is handed the new dates rather than the
   * per-request cached ones `before` already resolved.
   */
  await writeAppAccessProjection(after);

  let moved = 0;
  if (after.timeZone !== before.timeZone && formData.get('moveSessions') === 'on') {
    try {
      moved = await moveSessions(before.timeZone, after.timeZone, actor);
    } catch (err) {
      recordError('basics.moveSessions', err);
      return {
        error: 'The details were saved, but the sessions could not be moved. Save again to retry.',
      };
    }
  }

  revalidatePath('/', 'layout');
  return {
    ok: true,
    message:
      moved > 0
        ? `Saved. ${moved} session${moved === 1 ? '' : 's'} moved to ${after.timeZone}.`
        : 'Saved. The website and the app show these details now.',
  };
}

/** Re-derive every session authored in `from` so its wall clock is read in `to`. */
async function moveSessions(from: string, to: string, actor: string): Promise<number> {
  const snap = await db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get();
  const due = snap.docs.filter((d) => (d.data() as SessionDoc).timeZone === from);

  // 400 per batch, under Firestore's 500-write cap.
  for (let i = 0; i < due.length; i += 400) {
    const batch = db().batch();
    for (const doc of due.slice(i, i + 400)) {
      const s = doc.data() as SessionDoc;
      const times = deriveTimes(s.startsAtLocal, s.endsAtLocal, to);
      batch.update(doc.ref, {
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        timeZone: times.timeZone,
        day: times.day,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  if (due.length > 0) {
    await appendAudit({
      actor,
      action: 'session.update',
      targetPath: COLLECTIONS.sessions,
      targetId: EVENT_ID,
      before: { timeZone: from },
      after: { timeZone: to, sessions: due.length },
    });
  }
  return due.length;
}
