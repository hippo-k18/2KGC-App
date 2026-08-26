'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { commitAttendeeImport, previewAttendeeCsv } from '@/lib/import-attendees';
import type { RowError } from '@/lib/csv-import';
import { ROUTES } from '@/lib/nav';

/**
 * Importing an attendee list.
 *
 * Two steps, and the split is the point: **preview first, commit second.**
 * Whova's importer does the same, and the failure it prevents is a file whose
 * columns are in an unexpected order importing every name into the company
 * field — which nothing about the result looks wrong about until somebody reads
 * a badge.
 */

export interface ImportState {
  stage: 'idle' | 'preview' | 'done';
  message?: string;
  error?: string;
  /** Carried between the two steps so the file is uploaded once. */
  csv?: string;
  header?: string[];
  sample?: Record<string, string>[];
  validCount?: number;
  totalRows?: number;
  errors?: RowError[];
  created?: number;
  updated?: number;
}

/** Guard against somebody pasting a whole CRM export into a textarea. */
const MAX_BYTES = 2_000_000;

async function readCsv(formData: FormData): Promise<string | { error: string }> {
  const file = formData.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return { error: 'That file is over 2 MB. Split it, or trim the columns you do not need.' };
    return await file.text();
  }
  const pasted = String(formData.get('pasted') ?? '').trim();
  if (pasted) {
    if (pasted.length > MAX_BYTES) return { error: 'That is more text than the importer takes. Upload it as a file instead.' };
    return pasted;
  }
  return { error: 'Choose a CSV file, or paste one in.' };
}

export async function previewImportAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  await requireOrganizer();

  const csv = await readCsv(formData);
  if (typeof csv !== 'string') return { stage: 'idle', error: csv.error };

  const preview = previewAttendeeCsv(csv);

  return {
    stage: 'preview',
    csv,
    header: preview.header,
    // Three rows is enough to see that the columns landed in the right places,
    // which is the only question a preview has to answer.
    sample: preview.valid.slice(0, 3),
    validCount: preview.valid.length,
    totalRows: preview.totalRows,
    errors: preview.errors,
  };
}

export async function commitImportAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const actor = await requireOrganizer();

  const csv = String(formData.get('csv') ?? '');
  if (!csv) return { stage: 'idle', error: 'The file was lost between steps. Upload it again.' };

  const outcome = await commitAttendeeImport({
    text: csv,
    actor,
    allowPartial: formData.get('allowPartial') === 'on',
  });

  if (outcome.created === 0 && outcome.updated === 0) {
    return {
      stage: 'preview',
      csv,
      error:
        outcome.errors.length > 0
          ? 'Nothing was imported — the file still has problems. Fix them, or tick “import the good rows anyway”.'
          : 'Nothing was imported.',
      errors: outcome.errors,
      totalRows: outcome.totalRows,
    };
  }

  revalidatePath(ROUTES.attendees);
  revalidatePath(ROUTES.analyticsExports);

  return {
    stage: 'done',
    created: outcome.created,
    updated: outcome.updated,
    errors: outcome.errors,
    totalRows: outcome.totalRows,
    message:
      `Imported ${outcome.created} new ${outcome.created === 1 ? 'attendee' : 'attendees'}` +
      (outcome.updated ? `, updated ${outcome.updated} who were already on the list` : '') +
      (outcome.failed.length ? `, and ${outcome.failed.length} rows failed to write` : '') +
      '.',
  };
}
