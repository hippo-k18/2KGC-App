import 'server-only';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import type { SponsorTier } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { buildPreview, parseCsv, type Mapping, type RowError } from '@/lib/csv-import';
import { TIER_ORDER } from '@/lib/data';
import { db } from '@/lib/firestore';
import { normaliseWebsite, sponsorSlug, SPONSOR_FIELDS } from './sponsor-fields';

/**
 * Importing a sponsor list from the sponsorship spreadsheet.
 *
 * The sales side already keeps one — that fact is why Sponsor Manager was
 * read-only for so long, and it is the reason this exists rather than only the
 * one-at-a-time form. Eighteen sponsors typed twice is the thing an importer is
 * for.
 *
 * ── The write is the same shape as the form's ───────────────────────────────
 *
 * `{ merge: true }` onto `sponsors/{slug(name)}`, exactly as `saveSponsorAction`
 * does, so re-running the same file updates rather than duplicates and a
 * sponsor that already has an uploaded logo keeps it (the `logoURL` column is
 * only written when the file supplies one). That idempotency is what makes it
 * safe to fix two cells and re-upload the whole sheet, which is what people
 * actually do.
 *
 * ── No delete ───────────────────────────────────────────────────────────────
 *
 * A sponsor missing from the file is *not* removed. An import is additive
 * because the alternative is a truncated export silently unpublishing a paying
 * sponsor from the website — and there is no undo for that, because there is no
 * delete anywhere in this product to undo it with.
 */

export interface SponsorImportOutcome {
  created: number;
  updated: number;
  failed: { line: number; name: string; message: string }[];
  errors: RowError[];
  /** Rows the file contained, before validation. */
  totalRows: number;
}

/** Rows the caller can preview before committing. Nothing is written. */
export function previewSponsorCsv(text: string, mapping?: Mapping) {
  return buildPreview<Record<string, string>>(parseCsv(text), SPONSOR_FIELDS, mapping);
}

/**
 * A sponsorship deck has tens of rows, not thousands. A file larger than this
 * is almost always the wrong file, and finding that out after writing it to the
 * collection the public website renders is expensive.
 */
const MAX_ROWS = 500;

function toTier(raw: string): SponsorTier | undefined {
  const lower = raw.trim().toLowerCase();
  return (TIER_ORDER as string[]).includes(lower) ? (lower as SponsorTier) : undefined;
}

export async function commitSponsorImport(input: {
  text: string;
  mapping?: Mapping;
  actor: string;
  /** When false, rows that failed validation stop the whole import. */
  allowPartial: boolean;
}): Promise<SponsorImportOutcome> {
  const preview = previewSponsorCsv(input.text, input.mapping);

  if (preview.totalRows > MAX_ROWS) {
    return {
      created: 0,
      updated: 0,
      failed: [],
      errors: [
        {
          line: 0,
          message: `${preview.totalRows} rows is above the ${MAX_ROWS} cap. A sponsor list this large is usually the wrong file.`,
        },
      ],
      totalRows: preview.totalRows,
    };
  }

  // A file with problems is refused outright unless the organizer has said
  // otherwise: these documents are rendered on a public marketing page, and a
  // half-imported list is one nobody can tell the halves of.
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
  const failed: SponsorImportOutcome['failed'] = [];

  // Sequential rather than `Promise.all`: a conference-sized list takes a
  // second or two, and a partial failure across N concurrent writes is
  // impossible to report a line number for.
  for (const [i, row] of preview.valid.entries()) {
    const line = i + 2;
    const name = (row.name ?? '').trim();
    const docId = sponsorSlug(name);
    const tier = toTier(row.tier ?? '');

    if (!docId || !tier) {
      failed.push({
        line,
        name,
        message: !docId ? 'That name produces an empty id.' : `“${row.tier}” is not a tier.`,
      });
      continue;
    }

    try {
      const ref = db().collection(COLLECTIONS.sponsors).doc(docId);
      const before = await ref.get();

      const website = normaliseWebsite(row.website ?? '') || undefined;
      const logoURL = normaliseWebsite(row.logoURL ?? '') || undefined;

      await ref.set(
        {
          eventId: EVENT_ID,
          name,
          tier,
          website,
          // Only when the file carries one. A blank column must not wipe a logo
          // somebody uploaded through the form last week.
          ...(logoURL ? { logoURL } : {}),
          /*
           * `|| undefined` here is deliberate and is the opposite of the rule
           * in `actions.ts`, which uses `FieldValue.delete()`.
           *
           * On the form, an emptied box means "remove this" and must clear the
           * field (AGENTS.md gotcha 9). In a spreadsheet a blank cell almost
           * never means that — it means the column was not filled in, or the
           * export dropped it. Clearing on blank would let a sheet exported
           * without the Booth column silently unassign every sponsor's booth.
           * So a blank import cell leaves the stored value alone, and clearing
           * a field is something you do on the form, one sponsor at a time.
           */
          description: (row.description ?? '').trim() || undefined,
          boothLocation: (row.boothLocation ?? '').trim() || undefined,
          contactName: (row.contactName ?? '').trim() || undefined,
          contactEmail: (row.contactEmail ?? '').trim() || undefined,
          /*
           * `offers` is deliberately not an importable column. It is a
           * booth-week detail — "live demo at 2pm" — that arrives long after the
           * sales sheet is signed, and the form is where it is written. Left
           * untouched by `{ merge: true }`, so a re-import cannot wipe it.
           */
          ...(before.exists ? {} : { createdAt: new Date() }),
          updatedAt: new Date(),
        },
        { merge: true },
      );

      if (before.exists) updated++;
      else created++;
    } catch (err) {
      failed.push({ line, name, message: err instanceof Error ? err.message : 'Write failed.' });
    }
  }

  // One entry for the run rather than one per row: eighteen audit entries for
  // one action is a log nobody reads, and the per-row outcome is on screen at
  // the time.
  await appendAudit({
    actor: input.actor,
    action: 'sponsor.import',
    targetPath: COLLECTIONS.sponsors,
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
