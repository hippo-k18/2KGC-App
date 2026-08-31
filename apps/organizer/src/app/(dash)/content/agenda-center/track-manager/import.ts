import 'server-only';

import { COLLECTIONS, EVENT_ID, type TrackDoc } from '@kgc/shared';
import { trackId as deriveTrackId } from '@kgc/scripts/src/lib/ids';
import { appendAudit } from '@/lib/audit';
import { buildPreview, parseCsv, TRACK_FIELDS, type Mapping, type RowError } from '@/lib/csv-import';
import { fanOutTrackChange } from '@/lib/denormalise';
import { db } from '@/lib/firestore';

/**
 * Importing the track list.
 *
 * The smallest of the three programme importers and the one with the sharpest
 * edge, because a track is not just a label: `TrackDoc.color` is **cached onto
 * every session** as `primaryTrackColor`, and that cache is what paints the
 * agenda card in the app and the track chip on the website. Changing a colour
 * here therefore changes data on documents this file is not writing.
 *
 * ── So a colour change fans out, in the same run ────────────────────────────
 *
 * `lib/denormalise.ts` owns that fan-out and its header states the contract:
 * every cache needs a writer on the *other* side of the edit, and until the
 * track editor shipped there was none. Audit C called the hazard "armed, not
 * fired". A bulk colour change from a spreadsheet is precisely the thing that
 * fires it — one row can restyle sixty sessions — so `fanOutTrackChange` runs
 * for every track whose colour actually moved, and the outcome reports how many
 * sessions were rewritten. An importer that skipped it would leave the agenda
 * painted in the old palette with nothing to say why.
 *
 * ── A rename is a new track, and that is stated rather than hidden ──────────
 *
 * The document id is `trackId(name)`, a slug of the name — the same derivation
 * the seed and the CLI importer use, which is what makes a re-import update in
 * place. It also means changing "Graph ML" to "Graph Machine Learning" in the
 * sheet does not rename anything; it adds a second track and leaves the first
 * on every session that referenced it. There is no delete anywhere in this
 * product to clean that up, so the importer says so on screen rather than
 * discovering it later. Renaming is the track *form*'s job, where
 * `fanOutTrackChange` can show the blast radius first.
 *
 * Preview then commit, per-line errors, additive — `sponsor-manager/import.ts`
 * is the worked example.
 */

export interface TrackImportOutcome {
  created: number;
  updated: number;
  /** Sessions whose cached track name or colour were rewritten by the fan-out. */
  sessionsRecoloured: number;
  /** Tracks whose colour moved but whose fan-out did not fully commit. */
  fanOutFailures: string[];
  failed: { line: number; name: string; message: string }[];
  errors: RowError[];
  /** Rows the file contained, before validation. */
  totalRows: number;
}

/** Rows the caller can preview before committing. Nothing is written. */
export function previewTrackCsv(text: string, mapping?: Mapping) {
  return buildPreview<Record<string, string>>(parseCsv(text), TRACK_FIELDS, mapping);
}

/**
 * A conference runs a handful of tracks — KGC has under a dozen. A file with
 * more rows than this is a session list with a Track column, not a track list,
 * and importing it would create one track per talk.
 */
const MAX_ROWS = 100;

/** `#2180b2`, always with the hash and always lower case, so a comparison is a comparison. */
function normaliseColor(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  return `#${v.replace(/^#/, '')}`.toLowerCase();
}

export async function commitTrackImport(input: {
  text: string;
  mapping?: Mapping;
  actor: string;
  /** When false, rows that failed validation stop the whole import. */
  allowPartial: boolean;
}): Promise<TrackImportOutcome> {
  const preview = previewTrackCsv(input.text, input.mapping);
  const empty = {
    created: 0,
    updated: 0,
    sessionsRecoloured: 0,
    fanOutFailures: [],
    failed: [],
  };

  if (preview.totalRows > MAX_ROWS) {
    return {
      ...empty,
      errors: [
        {
          line: 0,
          message: `${preview.totalRows} rows is above the ${MAX_ROWS} cap. That looks like a session list rather than a track list — importing it would create one track per talk.`,
        },
      ],
      totalRows: preview.totalRows,
    };
  }

  if (preview.errors.length > 0 && !input.allowPartial) {
    return { ...empty, errors: preview.errors, totalRows: preview.totalRows };
  }

  let created = 0;
  let updated = 0;
  let sessionsRecoloured = 0;
  const fanOutFailures: string[] = [];
  const failed: TrackImportOutcome['failed'] = [];
  const seenInFile = new Set<string>();

  for (const [i, row] of preview.valid.entries()) {
    const line = i + 2;
    const name = (row.name ?? '').trim();
    const docId = deriveTrackId(name);

    if (!docId) {
      failed.push({ line, name, message: 'That name produces an empty id.' });
      continue;
    }
    if (seenInFile.has(docId)) {
      failed.push({ line, name, message: `“${name}” appears twice in this file.` });
      continue;
    }
    seenInFile.add(docId);

    try {
      const ref = db().collection(COLLECTIONS.tracks).doc(docId);
      const before = await ref.get();
      const previous = before.exists ? (before.data() as TrackDoc) : undefined;
      const color = normaliseColor(row.color ?? '');

      await ref.set(
        {
          eventId: EVENT_ID,
          name,
          /*
           * `|| undefined` — the sponsor importer's rule, and the reason it is
           * the opposite of the form's `FieldValue.delete()` (AGENTS.md gotcha
           * 9). A blank cell means "the column was not filled in", so a sheet
           * exported without the Colour column leaves the palette alone rather
           * than draining the colour out of the whole agenda.
           */
          color,
          description: (row.description ?? '').trim() || undefined,
          ...(before.exists ? {} : { createdAt: new Date() }),
          updatedAt: new Date(),
        },
        { merge: true },
      );

      if (before.exists) updated++;
      else created++;

      /*
       * The cache on the other side of the edit.
       *
       * Only when something the sessions actually cache has moved. `color` is
       * the realistic case — the name cannot change without changing the id, so
       * a differing name here means a *new* track with nothing referencing it
       * yet — but both are passed, because `fanOutTrackChange` compares before
       * writing and a run with nothing to do issues no writes at all.
       *
       * A new track is skipped: nothing references it, so there is nothing to
       * rewrite, and the scan would read the whole sessions collection to
       * confirm it.
       */
      const colorMoved = previous !== undefined && previous.color !== color;
      const nameMoved = previous !== undefined && previous.name !== name;
      if (colorMoved || nameMoved) {
        const fan = await fanOutTrackChange(db(), docId, { name, color });
        sessionsRecoloured += fan.updated.length;
        if (!fan.ok) {
          // Stated, never swallowed: a half-applied recolour leaves some cards
          // in the old palette and there is no second pass that would notice.
          fanOutFailures.push(
            `${name}: ${fan.failed.length} session(s) still show the old colour — ${fan.errors[0] ?? 'the batch failed'}`,
          );
        }
      }
    } catch (err) {
      failed.push({ line, name, message: err instanceof Error ? err.message : 'Write failed.' });
    }
  }

  await appendAudit({
    actor: input.actor,
    action: 'track.import',
    targetPath: COLLECTIONS.tracks,
    targetId: 'bulk',
    before: {},
    after: {
      rows: preview.totalRows,
      created,
      updated,
      sessionsRecoloured,
      failedRows: failed.length,
      invalidRows: preview.errors.length,
      partial: input.allowPartial,
    },
  });

  return {
    created,
    updated,
    sessionsRecoloured,
    fanOutFailures,
    failed,
    errors: preview.errors,
    totalRows: preview.totalRows,
  };
}
