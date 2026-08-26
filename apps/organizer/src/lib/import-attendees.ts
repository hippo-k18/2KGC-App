import 'server-only';

import { ensureRegistration } from '@kgc/scripts/src/lib/fulfilment';
import { appendAudit } from './audit';
import { db } from './firestore';
import { buildPreview, parseCsv, ATTENDEE_FIELDS, type Mapping, type RowError } from './csv-import';

/**
 * Writing an imported attendee list into Firestore.
 *
 * The parsing and validation live in `csv-import.ts`, which is pure and tested.
 * This is the half that touches the database, and it is small on purpose: it
 * calls `ensureRegistration`, which is the same function the Stripe webhook and
 * the invoice path call.
 *
 * ── That shared call is the whole point ─────────────────────────────────────
 *
 * An importer that wrote registrations itself would be a fourth place that
 * decides when to mint `qrSecret` and `claimCode`. The day it disagreed with
 * the other three is the day somebody's badge stops scanning while they are
 * holding it at the desk — which is exactly why `ensureRegistration` was moved
 * into `@kgc/scripts` rather than copied.
 *
 * ── An import creates no order ──────────────────────────────────────────────
 *
 * Deliberately. These people did not pay through us — they came from a
 * spreadsheet, a previous ticketing system, or a comp list. Writing an order
 * would put money in the revenue figures that nobody received. They get a
 * registration and appear on the attendee list, and Attendee Orders correctly
 * shows nothing for them.
 */

export interface ImportOutcome {
  created: number;
  updated: number;
  failed: { line: number; email: string; message: string }[];
  errors: RowError[];
  /** Rows the file contained, before validation. */
  totalRows: number;
}

/** Rows the caller can preview before committing. Nothing is written. */
export function previewAttendeeCsv(text: string, mapping?: Mapping) {
  return buildPreview<Record<string, string>>(parseCsv(text), ATTENDEE_FIELDS, mapping);
}

/**
 * Commit an attendee import.
 *
 * ── Sequential, and capped ──────────────────────────────────────────────────
 *
 * `Promise.all` over 400 rows would open 400 transactions at once, which
 * Firestore throttles and which makes a partial failure impossible to reason
 * about. The loop takes a few seconds for a conference-sized list and each row
 * either lands or is reported.
 *
 * The cap exists because a file with more rows than that is almost always the
 * wrong file — a full CRM export rather than a delegate list — and finding out
 * after writing 40,000 registrations is expensive to undo.
 */
const MAX_ROWS = 2000;

export async function commitAttendeeImport(input: {
  text: string;
  mapping?: Mapping;
  actor: string;
  /** When false, rows that failed validation stop the whole import. */
  allowPartial: boolean;
}): Promise<ImportOutcome> {
  const preview = previewAttendeeCsv(input.text, input.mapping);

  if (preview.totalRows > MAX_ROWS) {
    return {
      created: 0,
      updated: 0,
      failed: [],
      errors: [
        {
          line: 0,
          message: `${preview.totalRows} rows is above the ${MAX_ROWS} cap. A file this large is usually the wrong file — check it is a delegate list and not a full CRM export.`,
        },
      ],
      totalRows: preview.totalRows,
    };
  }

  // A file with problems is refused outright unless the organizer has said
  // otherwise, because a half-imported list is worse than none: nobody knows
  // which half, and re-running it is only safe because the writes happen to be
  // idempotent.
  if (preview.errors.length > 0 && !input.allowPartial) {
    return {
      created: 0,
      updated: 0,
      failed: [],
      errors: preview.errors,
      totalRows: preview.totalRows,
    };
  }

  let created = 0;
  let updated = 0;
  const failed: ImportOutcome['failed'] = [];

  for (const [i, row] of preview.valid.entries()) {
    try {
      const result = await ensureRegistration(db(), {
        email: row.email,
        name: row.name,
        // A registration with no ticket type prints a blank line on a badge.
        // "Imported" is visibly a placeholder, which is better than empty.
        ticketType: row.ticketType || 'Imported',
      });
      if (result.created) created++;
      else updated++;
    } catch (err) {
      failed.push({
        line: i + 2,
        email: row.email,
        message: err instanceof Error ? err.message : 'Write failed.',
      });
    }
  }

  await appendAudit({
    actor: input.actor,
    action: 'attendee.import',
    targetPath: 'registrations',
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
