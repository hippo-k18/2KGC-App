import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, TIME_ZONE, type SessionDoc } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { buildPreview, parseCsv, SESSION_FIELDS, type Mapping, type RowError } from '@/lib/csv-import';
import { listRooms, listSpeakerOptions, listTrackOptions } from '@/lib/data';
import { db } from '@/lib/firestore';
import { deriveTimes } from '@/lib/time';
import { qaDefaultsFor, speakerIndexDelta } from './session-core';
import {
  planSessionImport,
  type ExistingSession,
  type PlannedSession,
  type SessionCatalog,
} from './import-core';

/**
 * Importing the agenda from a spreadsheet.
 *
 * The programme arrives as a sheet — from the review system, from the previous
 * ticketing platform, or from the committee's own Google Sheet — and until now
 * the only way to get it into Firestore was `npm run import:whova` from a
 * terminal, which is not something an organizer does at T-2 weeks.
 *
 * Shaped after `sponsor-center/sponsor-manager/import.ts`: two steps, preview
 * then commit; per-line errors rather than one fatal message; and **additive**,
 * because a truncated export must never quietly remove anything. Sessions carry
 * two obligations that a sponsor row does not, and both live in `import-core.ts`
 * where they can be tested:
 *
 *  1. `startsAt` / `endsAt` / `day` are **derived** from `startsAtLocal` plus
 *     the zone, never taken from the sheet.
 *  2. The denormalised caches are written **in the same operation** as the ids
 *     they mirror — `speakerNames` positionally beside `speakerIds`,
 *     `primaryTrackName` / `primaryTrackColor` beside `trackIds[0]`, `roomName`
 *     beside `roomId`. The attendee app is listening with `onSnapshot`, so one
 *     commit is one snapshot; splitting a session across two writes makes a
 *     phone render its new speakers beside its old room.
 *
 * ── The one write this makes outside the session document ───────────────────
 *
 * `speakers/{id}.sessionIds` is the inverse index, and it is how an attendee
 * sees what somebody is presenting (`people/speaker/[id].tsx`). `saveSessionAction`
 * maintains it for one session at a time; an importer that did not would leave
 * every bulk-imported speaker's own page empty while the agenda card showed
 * them. It is written in the same batch as the session, so the two directions
 * of the relationship commit together or not at all.
 *
 * ── There is no delete here either ──────────────────────────────────────────
 *
 * A session missing from the file stays on the programme. `firestore.rules` is
 * `allow delete: if false` for sessions, retiring one is `status: 'cancelled'`,
 * and attendees hold saved-session bookmarks that Firestore will not cascade.
 */

export interface SessionImportOutcome {
  created: number;
  updated: number;
  /** Rows that resolved but whose write threw, and rows the planner refused. */
  failed: { line: number; title: string; message: string }[];
  errors: RowError[];
  /** Rows the file contained, before validation. */
  totalRows: number;
}

/** Rows the caller can preview before committing. Nothing is written. */
export function previewSessionCsv(text: string, mapping?: Mapping) {
  return buildPreview<Record<string, string>>(parseCsv(text), SESSION_FIELDS, mapping);
}

/**
 * A conference this size runs a few hundred sessions across three days. A file
 * larger than this is a different event's export or an unfiltered dump, and
 * finding that out after writing it to the collection every phone is listening
 * to is expensive — there is no delete to undo it with.
 */
const MAX_ROWS = 1000;

/** Read once, so sixty rows naming eight tracks cost eight reads and not sixty. */
async function loadCatalog(): Promise<SessionCatalog> {
  const [rooms, tracks, speakers, sessionSnap] = await Promise.all([
    listRooms(),
    listTrackOptions(),
    listSpeakerOptions(),
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get(),
  ]);

  const sessions: ExistingSession[] = sessionSnap.docs.map((d) => {
    const s = d.data() as SessionDoc;
    return {
      id: d.id,
      title: s.title,
      startsAtLocal: s.startsAtLocal,
      speakerIds: s.speakerIds ?? [],
    };
  });

  return {
    rooms,
    tracks,
    speakers: speakers.map((s) => ({ id: s.id, name: s.name, sessionIds: s.sessionIds })),
    sessions,
  };
}

/**
 * The Firestore payload for one planned row.
 *
 * ⚠️ Every `undefined` below reaches a store configured with
 * `ignoreUndefinedProperties`, so it writes **no key at all** and the stored
 * value survives. That is exactly what is wanted here and is the opposite of
 * what `saveSessionAction` wants — see `PlannedSessionFields` for the argument.
 * Nothing in this function may be changed to `FieldValue.delete()` without
 * re-reading it.
 *
 * The one deliberate deletion is `primaryTrackColor`, and only when the row
 * *did* name a primary track and that track has no colour. Leaving the previous
 * track's colour cached there would paint the agenda card in a colour no track
 * on the session has.
 */
function payloadFor(p: PlannedSession): Record<string, unknown> {
  const f = p.fields;

  // Re-derived through the console's own wrapper so the `Timestamp` is built by
  // the same `firebase-admin` copy that commits it. `import-core.ts` carries
  // plain `Date`s precisely so this is the only place a sentinel or a
  // `Timestamp` is constructed — see its header.
  const times = deriveTimes(f.startsAtLocal, f.endsAtLocal, f.timeZone);

  const patch: Record<string, unknown> = {
    eventId: EVENT_ID,
    title: f.title,
    description: f.description,
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    startsAtLocal: times.startsAtLocal,
    endsAtLocal: times.endsAtLocal,
    timeZone: times.timeZone,
    day: times.day,
    format: f.format,
    status: f.status,
    skillLevel: f.skillLevel,
    capacity: f.capacity,
    roomId: f.roomId,
    // Beside `roomId`, always. The app cannot read the `rooms` collection at
    // all, so this cache is its only wayfinding data.
    roomName: f.roomName,
    updatedAt: new Date(),
  };

  if (f.trackIds) {
    patch.trackIds = f.trackIds;
    patch.primaryTrackName = f.primaryTrackName;
    patch.primaryTrackColor = f.clearPrimaryTrackColor ? FieldValue.delete() : f.primaryTrackColor;
  }

  if (f.speakerIds && f.speakerNames) {
    patch.speakerIds = f.speakerIds;
    patch.speakerNames = f.speakerNames;
  }

  if (!p.exists) {
    /*
     * Fields a session cannot exist without, written only on create so a
     * re-import never resets them. `qaEnabled` / `pollsEnabled` are seeded from
     * the format exactly as `saveSessionAction` and the seed do, and then belong
     * to Session Q&A Manager. `tags`, `slidesUrl` and `seriesId` have no reader
     * anywhere in the three apps, so the model's required `tags` is written
     * empty and the other two are not written at all.
     */
    const format = f.format ?? 'talk';
    patch.format = format;
    patch.trackIds = f.trackIds ?? [];
    patch.speakerIds = f.speakerIds ?? [];
    patch.speakerNames = f.speakerNames ?? [];
    patch.tags = [];
    patch.sequence = 0;
    patch.stableGuid = p.stableGuid;
    patch.createdAt = new Date();
    Object.assign(patch, qaDefaultsFor(format));
  }

  return patch;
}

export async function commitSessionImport(input: {
  text: string;
  mapping?: Mapping;
  actor: string;
  /** When false, rows that failed validation stop the whole import. */
  allowPartial: boolean;
}): Promise<SessionImportOutcome> {
  const preview = previewSessionCsv(input.text, input.mapping);

  if (preview.totalRows > MAX_ROWS) {
    return {
      created: 0,
      updated: 0,
      failed: [],
      errors: [
        {
          line: 0,
          message: `${preview.totalRows} rows is above the ${MAX_ROWS} cap. An agenda that large is usually the wrong file.`,
        },
      ],
      totalRows: preview.totalRows,
    };
  }

  // A programme with problems is refused outright unless the organizer has said
  // otherwise. A half-imported agenda is one nobody can tell the halves of, and
  // it is on every attendee's phone within a second of the commit.
  if (preview.errors.length > 0 && !input.allowPartial) {
    return { created: 0, updated: 0, failed: [], errors: preview.errors, totalRows: preview.totalRows };
  }

  const catalog = await loadCatalog();
  const { planned, failed } = planSessionImport(preview.valid, catalog, TIME_ZONE);

  if (failed.length > 0 && !input.allowPartial) {
    return { created: 0, updated: 0, failed, errors: preview.errors, totalRows: preview.totalRows };
  }

  let created = 0;
  let updated = 0;
  const writeFailures = [...failed];

  const sessions = db().collection(COLLECTIONS.sessions);
  const speakers = db().collection(COLLECTIONS.speakers);

  /*
   * One batch per row rather than one batch for the file.
   *
   * A session and its inverse-index updates must land together — that is the
   * invariant. Beyond that, batching the whole file would make a single bad
   * document reject four hundred good ones with no line number, which is the
   * failure mode the per-line reporting exists to avoid. Sequential for the
   * reason the sponsor importer gives: a partial failure across N concurrent
   * commits cannot be reported against a line.
   */
  for (const p of planned) {
    try {
      const batch = db().batch();
      batch.set(sessions.doc(p.docId), payloadFor(p), { merge: true });

      // Only when the row actually named speakers. A blank column leaves both
      // `speakerIds` and the index alone, which is the same "not filled in"
      // rule the payload follows.
      if (p.fields.speakerIds) {
        const { added, removed } = speakerIndexDelta(p.speakerIdsBefore, p.fields.speakerIds);
        for (const id of added) {
          batch.update(speakers.doc(id), { sessionIds: FieldValue.arrayUnion(p.docId) });
        }
        for (const id of removed) {
          batch.update(speakers.doc(id), { sessionIds: FieldValue.arrayRemove(p.docId) });
        }
      }

      await batch.commit();
      if (p.exists) updated++;
      else created++;
    } catch (err) {
      writeFailures.push({
        line: p.line,
        title: p.fields.title,
        message: err instanceof Error ? err.message : 'Write failed.',
      });
    }
  }

  // One entry for the run. Four hundred audit rows for one button press is a
  // log nobody reads, and the per-row outcome is on screen at the time.
  await appendAudit({
    actor: input.actor,
    action: 'session.import',
    targetPath: COLLECTIONS.sessions,
    targetId: 'bulk',
    before: {},
    after: {
      rows: preview.totalRows,
      created,
      updated,
      failedRows: writeFailures.length,
      invalidRows: preview.errors.length,
      partial: input.allowPartial,
    },
  });

  return {
    created,
    updated,
    failed: writeFailures,
    errors: preview.errors,
    totalRows: preview.totalRows,
  };
}
