'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import type { SponsorTier } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { getSponsor, TIER_ORDER } from '@/lib/data';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { removeImage, uploadImage, UploadRejected, UploadUnavailable } from '@/lib/uploads';
import type { FormState } from '../../../form';
import { commitSponsorImport, previewSponsorCsv, type SponsorImportOutcome } from './import';
import { EMAIL, normaliseWebsite, parseOffers, sponsorSlug } from './sponsor-fields';

/**
 * Writing a sponsor.
 *
 * Modelled on `exhibitor-manager/actions.ts`, which is the worked example for
 * audit trail, validation, id collision and no-delete. The differences are the
 * ones the data model forces, and they are worth naming:
 *
 * - **`tier` is the field with a contract behind it.** It is a closed union in
 *   `@kgc/shared`, and it decides logo size on the public site (`TIER_SIZE`) and
 *   position in the app's directory (`useSponsors`' comparator). So it is a
 *   `<select>` over `TIER_ORDER` and it is re-checked here, because a tier that
 *   is not in the union sorts to the end of every one of those three surfaces
 *   and renders under no heading at all.
 *
 * ── There is no delete, and no retire either ────────────────────────────────
 *
 * No delete, for the house reason: `sponsors/{id}/leads` is keyed by sponsor id
 * and the public site keys its self-hosted logo files by name, so removing the
 * document turns both into dangling pointers weeks after anyone would connect
 * the two.
 *
 * The exhibitor pattern retires instead — `status: 'cancelled'` — and that is
 * **not** available here: `SponsorDoc` has no status field, and neither
 * `apps/web/src/lib/data.ts:listSponsors` nor `app/src/lib/data/directory.ts:useSponsors`
 * filters on one. A "Retire" button added now would set a field nothing reads,
 * leave the sponsor on the public sponsor page and in the app directory, and
 * tell the organizer it had been taken down. That is the exact defect class
 * `AGENTS.md` counts fourteen instances of, so the button is absent and the
 * screen says why rather than implying a capability that stops at this
 * database. What it would take is written down in the gap note on `page.tsx`.
 */

const ROUTE = '/content/sponsor-center/sponsor-manager';

/**
 * `sponsors/{sponsorId}/logo.{ext}` — the convention `docs/storage-uploads.md`
 * fixes for all three image-bearing entities, so a bucket listing reads as the
 * data model.
 */
function logoTarget(docId: string) {
  return { folder: `${COLLECTIONS.sponsors}/${docId}`, name: 'logo' };
}

function isTier(value: string): value is SponsorTier {
  return (TIER_ORDER as string[]).includes(value);
}

export async function saveSponsorAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const tier = String(formData.get('tier') ?? '').trim();
  const websiteRaw = String(formData.get('website') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  const boothLocation = String(formData.get('boothLocation') ?? '').trim();
  const contactName = String(formData.get('contactName') ?? '').trim();
  const contactEmail = String(formData.get('contactEmail') ?? '').trim();
  const offersRaw = String(formData.get('offers') ?? '');

  const fieldErrors: Record<string, string> = {};

  if (name.length < 2) fieldErrors.name = 'Enter the sponsoring company’s name.';
  if (!isTier(tier)) {
    fieldErrors.tier = 'Choose a tier. This is what the sponsor bought, and it decides their logo size on the public site.';
  }
  if (contactEmail && !EMAIL.test(contactEmail)) {
    fieldErrors.contactEmail = 'That contact email is not valid.';
  }

  const website = normaliseWebsite(websiteRaw);
  if (website === null) {
    fieldErrors.website = 'That is not a web address. Use something like https://example.com.';
  }

  const { offers, error: offersError } = parseOffers(offersRaw);
  if (offersError) fieldErrors.offers = offersError;

  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Some fields need attention.', fieldErrors };
  }

  const docId = id || sponsorSlug(name);
  if (!docId) {
    return { error: 'That name produces an empty id. Use some letters or numbers.', fieldErrors: { name: 'Use some letters or numbers.' } };
  }

  const existing = id ? await getSponsor(id) : null;
  if (!id) {
    const clash = await getSponsor(docId);
    if (clash) {
      return {
        error: `“${clash.name}” already uses the id “${docId}”. Edit that record instead of creating a second one — the app and the website both key sponsors by this id.`,
      };
    }
  }

  /**
   * The file is resolved before the document is written, not after.
   *
   * A save that succeeded and an upload that then failed would leave the
   * organizer looking at a saved sponsor with no logo and an error message,
   * with no way to tell which half landed. Doing the fallible part first means
   * a failure here is simply a save that did not happen.
   */
  let logoURL: string | FieldValue | undefined;
  const picked = formData.get('logo');
  const logoFile = picked instanceof File && picked.size > 0 ? picked : null;
  const clearLogo = String(formData.get('logoRemoved') ?? '') === '1' && !logoFile;

  try {
    if (logoFile) {
      logoURL = (await uploadImage(logoFile, logoTarget(docId))).url;
    } else if (clearLogo) {
      await removeImage(logoTarget(docId));
      // `undefined` would be dropped by `ignoreUndefinedProperties` and the old
      // logo would survive the save that was meant to remove it.
      logoURL = FieldValue.delete();
    }
  } catch (err) {
    recordError('sponsor.logo', err);
    if (err instanceof UploadRejected || err instanceof UploadUnavailable) {
      return { error: err.message, fieldErrors: { logo: err.message } };
    }
    return { error: err instanceof Error ? err.message : 'Could not store that image.' };
  }

  try {
    const ref = db().collection(COLLECTIONS.sponsors).doc(docId);
    await ref.set(
      {
        eventId: EVENT_ID,
        name,
        tier,
        ...(logoURL === undefined ? {} : { logoURL }),
        /**
         * Emptied fields are deleted, not set to `undefined`.
         *
         * The store runs with `ignoreUndefinedProperties`, and this is a
         * `{ merge: true }` write. So `x || undefined` on a cleared field
         * writes *nothing at all* — the old value survives and the action
         * reports "Saved". A sponsor whose booth moved to "unassigned" would
         * still be printed at the old booth on every surface.
         */
        website: website || FieldValue.delete(),
        description: description || FieldValue.delete(),
        boothLocation: boothLocation || FieldValue.delete(),
        contactName: contactName || FieldValue.delete(),
        contactEmail: contactEmail || FieldValue.delete(),
        // Written unconditionally, including empty: clearing the box has to
        // clear the array, and `[]` is falsy-enough for every reader
        // (`s.offers?.length`) while still being a value Firestore stores.
        offers,
        ...(existing ? {} : { createdAt: new Date() }),
        updatedAt: new Date(),
      },
      { merge: true },
    );

    await appendAudit({
      actor,
      action: existing ? 'sponsor.update' : 'sponsor.create',
      targetPath: `${COLLECTIONS.sponsors}/${docId}`,
      targetId: docId,
      before: existing
        ? {
            name: existing.name,
            tier: existing.tier,
            boothLocation: existing.boothLocation ?? null,
            logoURL: existing.logoURL ?? null,
          }
        : {},
      after: {
        name,
        tier,
        boothLocation: boothLocation || null,
        // Only when it moved — an audit row claiming a logo changed on every
        // description edit makes the trail useless for the one time it matters.
        ...(typeof logoURL === 'string' ? { logoURL } : clearLogo ? { logoURL: null } : {}),
      },
    });

    revalidatePath(ROUTE);
    revalidatePath('/content/sponsor-center/sponsor-tiering');
    revalidatePath('/content/sponsor-center/advanced-banners');
    revalidatePath('/content/sponsor-center/message-sponsors');

    return {
      ok: true,
      message: existing
        ? `Saved ${name}.`
        : `Added ${name} as ${docId}. They are on the public sponsor page and in the app now.`,
    };
  } catch (err) {
    recordError('sponsor.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the sponsor.' };
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface SponsorImportState {
  stage: 'idle' | 'preview' | 'done';
  message?: string;
  error?: string;
  /** Carried between the two steps so the file is uploaded once. */
  csv?: string;
  header?: string[];
  sample?: Record<string, string>[];
  validCount?: number;
  totalRows?: number;
  errors?: SponsorImportOutcome['errors'];
  created?: number;
  updated?: number;
}

/** A whole sponsorship spreadsheet is a few dozen rows; this is generous. */
const MAX_CSV_BYTES = 500_000;

async function readCsv(formData: FormData): Promise<string | { error: string }> {
  const file = formData.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CSV_BYTES) {
      return { error: 'That file is over 500 KB, which is far larger than any sponsor list. Check it is the right file.' };
    }
    return await file.text();
  }
  const pasted = String(formData.get('pasted') ?? '').trim();
  if (pasted) {
    if (pasted.length > MAX_CSV_BYTES) return { error: 'That is more text than the importer takes.' };
    return pasted;
  }
  return { error: 'Choose a CSV file, or paste one in.' };
}

export async function previewSponsorImportAction(
  _prev: SponsorImportState,
  formData: FormData,
): Promise<SponsorImportState> {
  await requireOrganizer();

  const csv = await readCsv(formData);
  if (typeof csv !== 'string') return { stage: 'idle', error: csv.error };

  const preview = previewSponsorCsv(csv);

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

export async function commitSponsorImportAction(
  _prev: SponsorImportState,
  formData: FormData,
): Promise<SponsorImportState> {
  const actor = await requireOrganizer();

  const csv = String(formData.get('csv') ?? '');
  if (!csv) return { stage: 'idle', error: 'The file was lost between steps. Upload it again.' };

  let outcome: SponsorImportOutcome;
  try {
    outcome = await commitSponsorImport({
      text: csv,
      actor,
      allowPartial: formData.get('allowPartial') === 'on',
    });
  } catch (err) {
    recordError('sponsor.import', err);
    return { stage: 'preview', csv, error: err instanceof Error ? err.message : 'The import failed.' };
  }

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

  revalidatePath(ROUTE);
  revalidatePath('/content/sponsor-center/sponsor-tiering');

  return {
    stage: 'done',
    created: outcome.created,
    updated: outcome.updated,
    errors: outcome.errors,
    totalRows: outcome.totalRows,
    message:
      `Imported ${outcome.created} new ${outcome.created === 1 ? 'sponsor' : 'sponsors'}` +
      (outcome.updated ? `, updated ${outcome.updated} already on the list` : '') +
      (outcome.failed.length ? `, and ${outcome.failed.length} rows failed to write` : '') +
      '.',
  };
}
