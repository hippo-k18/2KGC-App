'use server';

import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { getExhibitor } from '@/lib/exhibitors';
import { db } from '@/lib/firestore';
import { recordError } from '@/lib/errors';
import { removeImage, uploadImage, UploadRejected, UploadUnavailable } from '@/lib/uploads';

export interface ExhibitorState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROUTE = '/content/exhibitor-center/exhibitor-manager';

/**
 * `exhibitors/{id}/logo.{ext}` — the same shape `uploads.ts` documents for
 * sponsors and speakers, so a bucket listing reads as the data model rather
 * than as a pile of hashes, and so a deleted exhibitor's assets can be found.
 */
function logoTarget(docId: string) {
  return { folder: `${COLLECTIONS.exhibitors}/${docId}`, name: 'logo' };
}

/** URL-safe and readable, so a Firestore path is legible in the console. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48);
}

export async function saveExhibitorAction(
  _prev: ExhibitorState,
  formData: FormData,
): Promise<ExhibitorState> {
  const actor = await requireOrganizer();

  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const boothNumber = String(formData.get('boothNumber') ?? '').trim();
  const contactName = String(formData.get('contactName') ?? '').trim();
  const contactEmail = String(formData.get('contactEmail') ?? '').trim();
  const website = String(formData.get('website') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const status = String(formData.get('status') ?? 'provisional');
  const passesRaw = String(formData.get('passesAllocated') ?? '').trim();

  if (name.length < 2) return { error: 'Enter the exhibiting company’s name.' };
  if (contactEmail && !EMAIL.test(contactEmail)) {
    return { error: 'That contact email is not valid.' };
  }
  if (!['confirmed', 'provisional', 'cancelled'].includes(status)) {
    return { error: 'Choose a status.' };
  }

  const passesAllocated = passesRaw === '' ? undefined : Number(passesRaw);
  if (passesAllocated !== undefined && (!Number.isInteger(passesAllocated) || passesAllocated < 0)) {
    return { error: 'Staff passes must be a whole number, or blank if the package does not say.' };
  }

  const docId = id || slugify(name);
  if (!docId) return { error: 'That name produces an empty id. Use some letters or numbers.' };

  const existing = id ? await getExhibitor(id) : null;
  if (!id) {
    const clash = await getExhibitor(docId);
    if (clash) return { error: `“${clash.name}” already uses the id “${docId}”.` };
  }

  /**
   * The file is resolved before the document is written, not after.
   *
   * A save that succeeded and an upload that then failed would leave the
   * organizer looking at a saved exhibitor with no logo and an error message,
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
    if (err instanceof UploadRejected || err instanceof UploadUnavailable) {
      recordError('exhibitor.logo', err);
      return { error: err.message };
    }
    recordError('exhibitor.logo', err);
    return { error: err instanceof Error ? err.message : 'Could not store that image.' };
  }

  try {
    const ref = db().collection(COLLECTIONS.exhibitors).doc(docId);
    await ref.set(
      {
        eventId: EVENT_ID,
        name,
        ...(logoURL === undefined ? {} : { logoURL }),
        /**
         * Emptied fields are deleted, not set to `undefined`.
         *
         * The store runs with `ignoreUndefinedProperties`, and this is a
         * `{ merge: true }` write. So `x || undefined` on a cleared field
         * writes *nothing at all* — the old value survives and the action
         * reports "Saved". An organizer who deletes a wrong contact email and
         * is told it saved still has the wrong contact email.
         */
        boothNumber: boothNumber || FieldValue.delete(),
        contactName: contactName || FieldValue.delete(),
        contactEmail: contactEmail || FieldValue.delete(),
        website: website || FieldValue.delete(),
        description: description || FieldValue.delete(),
        status,
        passesAllocated,
        /**
         * Never written on an update. `passesUsed` counts badges actually
         * claimed at the desk; resetting it while editing a booth number would
         * hand out a second set of passes to a company that already has them.
         */
        ...(existing ? {} : { passesUsed: 0 }),
        ...(existing ? {} : { createdAt: new Date() }),
        updatedAt: new Date(),
      },
      { merge: true },
    );

    await appendAudit({
      actor,
      action: existing ? 'exhibitor.update' : 'exhibitor.create',
      targetPath: `${COLLECTIONS.exhibitors}/${docId}`,
      targetId: docId,
      before: existing
        ? {
            name: existing.name,
            boothNumber: existing.boothNumber,
            status: existing.status,
            logoURL: existing.logoURL ?? null,
          }
        : {},
      after: {
        name,
        boothNumber,
        status,
        passesAllocated,
        // Only when it moved — an audit row claiming a logo changed on every
        // description edit makes the trail useless for the one time it matters.
        ...(typeof logoURL === 'string' ? { logoURL } : clearLogo ? { logoURL: null } : {}),
      },
    });

    revalidatePath(ROUTE);
    return {
      ok: true,
      message: existing ? `Saved ${name}.` : `Added ${name} as ${docId}.`,
    };
  } catch (err) {
    recordError('exhibitor.save', err);
    return { error: err instanceof Error ? err.message : 'Could not save the exhibitor.' };
  }
}

/**
 * Cancel or reinstate. There is no delete.
 *
 * Staff passes, lead scans and any exhibitor ticket order reference an
 * exhibitor by id. Deleting one turns each of those into a dangling pointer,
 * and the symptom appears weeks later as a badge that resolves to nothing.
 * Cancelling keeps the record and answers the question at the desk.
 */
export async function setExhibitorStatusAction(formData: FormData): Promise<void> {
  const actor = await requireOrganizer();
  const id = String(formData.get('id') ?? '').trim();
  const status = String(formData.get('status') ?? '');
  if (!id || !['confirmed', 'provisional', 'cancelled'].includes(status)) return;

  try {
    const existing = await getExhibitor(id);
    if (!existing) return;
    await db()
      .collection(COLLECTIONS.exhibitors)
      .doc(id)
      .update({ status, updatedAt: new Date() });
    await appendAudit({
      actor,
      action: 'exhibitor.update',
      targetPath: `${COLLECTIONS.exhibitors}/${id}`,
      targetId: id,
      before: { status: existing.status },
      after: { status },
    });
  } catch (err) {
    recordError('exhibitor.setStatus', err);
  }
  revalidatePath(ROUTE);
}
