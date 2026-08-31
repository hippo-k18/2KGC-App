import 'server-only';

import { COLLECTIONS, EVENT_ID, type SpeakerDoc } from '@kgc/shared';
import { speakerId as deriveSpeakerId } from '@kgc/scripts/src/lib/ids';
import { appendAudit } from '@/lib/audit';
import { buildPreview, parseCsv, SPEAKER_FIELDS, type Mapping, type RowError } from '@/lib/csv-import';
import { db } from '@/lib/firestore';

/**
 * Importing the speaker list.
 *
 * The committee keeps one — that is what the call for papers produces — and
 * until now the only route from that sheet into Firestore was a terminal
 * command. Forty-five speakers typed twice is what an importer is for, and this
 * one has a second job the sponsor importer does not: **the session importer
 * refuses any row naming a speaker it cannot resolve**, so this runs first and
 * is what makes the agenda importable at all.
 *
 * Shaped after `sponsor-center/sponsor-manager/import.ts` — preview then
 * commit, per-line errors, additive.
 *
 * ── The id policy, which is not `speakerId()` alone ─────────────────────────
 *
 * `speakerId(name, company)` hashes **both**, so correcting an affiliation from
 * "Acme" to "Acme Corp" and re-importing would mint a second document for the
 * same person — permanently, because nothing merges speakers and nothing
 * deletes one. So an existing speaker is found **by name** first, and the
 * derived id is only used to create somebody genuinely new. That makes the
 * sheet re-importable, which is the workflow: you re-import as bios and
 * headshots arrive.
 *
 * The cost of matching by name is that this importer **cannot rename anybody**
 * — a corrected spelling reads as a new person. That is deliberate rather than
 * unfortunate: `speakerNames` is cached positionally onto every session that
 * speaker presents, and a rename is therefore a fan-out
 * (`fanOutSpeakerRename` in `lib/denormalise.ts`), not a field write. Renaming
 * is the speaker *form*'s job, one person at a time, where the blast radius can
 * be shown before it is agreed to. Two speakers sharing a name are reported
 * rather than guessed at, for the same reason.
 *
 * ── `sessionIds` is not importable ──────────────────────────────────────────
 *
 * The programme export carries a `Sessions` column and this importer ignores
 * it. That link has two ends — `speakerIds` on the session and `sessionIds`
 * here — and the session importer writes both in one batch. A second writer
 * coming from this sheet would let the two directions disagree, and the side
 * that would be wrong is the one `people/speaker/[id].tsx` renders.
 */

export interface SpeakerImportOutcome {
  created: number;
  updated: number;
  failed: { line: number; name: string; message: string }[];
  errors: RowError[];
  /** Rows the file contained, before validation. */
  totalRows: number;
}

/** Rows the caller can preview before committing. Nothing is written. */
export function previewSpeakerCsv(text: string, mapping?: Mapping) {
  return buildPreview<Record<string, string>>(parseCsv(text), SPEAKER_FIELDS, mapping);
}

/**
 * A programme committee handles hundreds of submissions and confirms tens. A
 * file above this is the submission list rather than the speaker list.
 */
const MAX_ROWS = 500;

/** Lower case, punctuation-insensitive. Matching only — never stored. */
function key(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function commitSpeakerImport(input: {
  text: string;
  mapping?: Mapping;
  actor: string;
  /** When false, rows that failed validation stop the whole import. */
  allowPartial: boolean;
}): Promise<SpeakerImportOutcome> {
  const preview = previewSpeakerCsv(input.text, input.mapping);

  if (preview.totalRows > MAX_ROWS) {
    return {
      created: 0,
      updated: 0,
      failed: [],
      errors: [
        {
          line: 0,
          message: `${preview.totalRows} rows is above the ${MAX_ROWS} cap. A speaker list this large is usually the wrong file.`,
        },
      ],
      totalRows: preview.totalRows,
    };
  }

  if (preview.errors.length > 0 && !input.allowPartial) {
    return { created: 0, updated: 0, failed: [], errors: preview.errors, totalRows: preview.totalRows };
  }

  // Read once. Two speakers with the same name have to be detected across the
  // whole collection before any row naming that name can be believed.
  const existingSnap = await db()
    .collection(COLLECTIONS.speakers)
    .where('eventId', '==', EVENT_ID)
    .get();

  const idByName = new Map<string, string>();
  const duplicated = new Set<string>();
  for (const d of existingSnap.docs) {
    const k = key((d.data() as SpeakerDoc).name ?? '');
    if (idByName.has(k)) duplicated.add(k);
    else idByName.set(k, d.id);
  }

  let created = 0;
  let updated = 0;
  const failed: SpeakerImportOutcome['failed'] = [];
  /** Names this file has already written, so one sheet cannot fight itself. */
  const seenInFile = new Set<string>();

  // Sequential, as the sponsor importer is: a partial failure across N
  // concurrent writes cannot be reported against a line number.
  for (const [i, row] of preview.valid.entries()) {
    const line = i + 2;
    const name = (row.name ?? '').trim();
    const k = key(name);

    if (!k) {
      failed.push({ line, name, message: 'That name is only punctuation.' });
      continue;
    }
    if (duplicated.has(k)) {
      failed.push({
        line,
        name,
        message: `Two speakers are already called “${name}”. Edit them on the speaker page — an import cannot tell them apart.`,
      });
      continue;
    }
    if (seenInFile.has(k)) {
      failed.push({ line, name, message: `“${name}” appears twice in this file.` });
      continue;
    }
    seenInFile.add(k);

    const company = (row.company ?? '').trim();
    const existingId = idByName.get(k);
    const docId = existingId ?? deriveSpeakerId(name, company || undefined);

    try {
      const ref = db().collection(COLLECTIONS.speakers).doc(docId);

      /*
       * `|| undefined` throughout, and it is the deliberate opposite of what an
       * interactive form must do (AGENTS.md gotcha 9): the form's emptied box
       * means "remove this" and writes `FieldValue.delete()`, whereas a blank
       * spreadsheet cell means the column was not filled in, or the export
       * dropped it. Clearing on blank would let a sheet exported without the
       * Bio column wipe forty-five bios that took a month to collect, and there
       * is no undo. Clearing a field is something you do on the form, one
       * speaker at a time.
       */
      const social = {
        linkedin: (row.linkedin ?? '').trim() || undefined,
        website: (row.website ?? '').trim() || undefined,
      };

      await ref.set(
        {
          eventId: EVENT_ID,
          name,
          title: (row.title ?? '').trim() || undefined,
          company: company || undefined,
          bio: (row.bio ?? '').trim() || undefined,
          contactEmail: (row.contactEmail ?? '').trim() || undefined,
          // Only when the file supplies one, so a speaker whose headshot was
          // uploaded through the form last week keeps it.
          ...((row.photoURL ?? '').trim() ? { photoURL: row.photoURL.trim() } : {}),
          // `merge: true` merges nested maps key by key, so an absent
          // `linkedin` leaves a stored one alone rather than replacing the map.
          ...(social.linkedin || social.website ? { social } : {}),
          /*
           * `userId` is never written here. It is the join to the ticket
           * holder, set when a speaker signs in, and a spreadsheet has no
           * business asserting a Firebase uid. `sessionIds` likewise — see the
           * file header — but the model requires the array to exist, so a
           * genuinely new speaker gets an empty one.
           */
          ...(existingId ? {} : { sessionIds: [], createdAt: new Date() }),
          updatedAt: new Date(),
        },
        { merge: true },
      );

      if (existingId) updated++;
      else {
        created++;
        // So a second row naming the same person updates rather than colliding.
        idByName.set(k, docId);
      }
    } catch (err) {
      failed.push({ line, name, message: err instanceof Error ? err.message : 'Write failed.' });
    }
  }

  await appendAudit({
    actor: input.actor,
    action: 'speaker.import',
    targetPath: COLLECTIONS.speakers,
    targetId: 'bulk',
    before: {},
    after: {
      rows: preview.totalRows,
      created,
      updated,
      failedRows: failed.length,
      invalidRows: preview.errors.length,
      partial: input.allowPartial,
    },
  });

  return { created, updated, failed, errors: preview.errors, totalRows: preview.totalRows };
}
