'use server';

import { LEARN_PAGE_LIBRARY, LEARN_PAGE_MEDIA, type PageImage } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import {
  LearnMediaRefused,
  backfillLearnMedia,
  deleteLearnLibraryItem,
  deleteLearnMedia,
  learnImageEditStart,
  learnMediaUses,
  listLearnLibrary,
  listLearnMedia,
  renameLearnLibraryItem,
  saveLearnLibraryItem,
  updateLearnMedia,
  type LearnLibraryRow,
  type LearnMediaListing,
} from '@/lib/learn-media';
import type { LearnImageEditState } from '@/lib/learn-image-edit-core';
import { MEDIA_SORTS, type MediaRow, type MediaSort } from '@/lib/learn-media-core';
import type { LearnResult } from './actions';

/**
 * Content > Learn Page: the media library and saved sections (T315).
 *
 * The same gate as `actions.ts`: every action starts with `requireOrganizer()`,
 * and this file is imported only by the `content/learn-page` screen, so only an
 * owner or a `learn` member can run it (`canRunAction`; pinned by
 * `tests/programme/learn-page-gate.test.ts`). Every change is audit-logged;
 * the reads (list, where used) are not.
 */

function failure(err: unknown, what: string): LearnResult<never> {
  if (err instanceof LearnMediaRefused) return { ok: false, error: err.message };
  recordError(`learn page ${what} failed`, err);
  return { ok: false, error: `Could not ${what}. Nothing was changed. Try again in a moment.` };
}

const SUBJECT = 'KGC | Learn page';

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

export async function listLearnMediaAction(
  opts: { search?: string; tag?: string; sort?: MediaSort } = {},
): Promise<LearnResult<{ media: LearnMediaListing }>> {
  await requireOrganizer();
  const sort = MEDIA_SORTS.includes(opts?.sort as MediaSort) ? opts.sort : undefined;
  const search = typeof opts?.search === 'string' ? opts.search : undefined;
  const tag = typeof opts?.tag === 'string' ? opts.tag : undefined;
  try {
    return { ok: true, media: await listLearnMedia({ search, tag, sort }) };
  } catch (err) {
    return failure(err, 'list the images');
  }
}

export async function learnMediaUsesAction(id: string): Promise<LearnResult<{ uses: string[] }>> {
  await requireOrganizer();
  try {
    return { ok: true, uses: await learnMediaUses(id) };
  } catch (err) {
    return failure(err, 'check where that image is used');
  }
}

/**
 * Where "Edit image" starts: for an edited copy whose original is still
 * stored, the original and the settings that made the copy; otherwise null,
 * and the editor opens the image itself. A read, so not audit-logged.
 */
export async function learnImageEditStartAction(
  src: string,
): Promise<LearnResult<{ start: { image: PageImage; state: LearnImageEditState } | null }>> {
  await requireOrganizer();
  try {
    return { ok: true, start: await learnImageEditStart(src) };
  } catch (err) {
    return failure(err, 'open the original image');
  }
}

/** Rename, retag, or set the default alt text. Send only the fields that change. */
export async function updateLearnMediaAction(
  id: string,
  patch: { fileName?: string; tags?: string[]; alt?: string },
): Promise<LearnResult<{ item: MediaRow }>> {
  const actor = await requireOrganizer();
  try {
    const { before, after } = await updateLearnMedia(id, patch ?? {});
    await appendAudit({
      actor,
      action: 'learnMedia.update',
      targetPath: `${LEARN_PAGE_MEDIA}/${after.id}`,
      subject: SUBJECT,
      targetId: after.id,
      before: { fileName: before.fileName, tags: before.tags ?? [], alt: before.image.alt },
      after: { fileName: after.fileName, tags: after.tags ?? [], alt: after.image.alt },
    });
    return { ok: true, item: after };
  } catch (err) {
    return failure(err, 'update that image');
  }
}

/** Refused, with the places named, while the draft, the live page, a kept version or a saved section uses it. */
export async function deleteLearnMediaAction(id: string): Promise<LearnResult> {
  const actor = await requireOrganizer();
  try {
    const row = await deleteLearnMedia(id);
    await appendAudit({
      actor,
      action: 'learnMedia.remove',
      targetPath: `${LEARN_PAGE_MEDIA}/${row.id}`,
      subject: SUBJECT,
      targetId: row.id,
      before: { fileName: row.fileName, src: row.image.src, bytes: row.bytes },
      after: {},
    });
    return { ok: true };
  } catch (err) {
    return failure(err, 'delete that image');
  }
}

/** Add rows for images uploaded before the media library existed. Safe to run again. */
export async function backfillLearnMediaAction(): Promise<LearnResult<{ added: number; skipped: number }>> {
  const actor = await requireOrganizer();
  try {
    const { added, skipped } = await backfillLearnMedia();
    await appendAudit({
      actor,
      action: 'learnMedia.backfill',
      targetPath: LEARN_PAGE_MEDIA,
      subject: SUBJECT,
      targetId: 'learn',
      before: {},
      after: { added, skipped },
    });
    return { ok: true, added, skipped };
  } catch (err) {
    return failure(err, 'scan for older images');
  }
}

// ---------------------------------------------------------------------------
// Saved sections
// ---------------------------------------------------------------------------

export async function listLearnLibraryAction(): Promise<LearnResult<{ items: LearnLibraryRow[] }>> {
  await requireOrganizer();
  try {
    return { ok: true, items: await listLearnLibrary() };
  } catch (err) {
    return failure(err, 'list the saved sections');
  }
}

/** Save a section under a name; with `replaceId`, replace that saved section's content. */
export async function saveLearnLibraryItemAction(input: {
  name: string;
  section: unknown;
  replaceId?: string;
}): Promise<LearnResult<{ id: string }>> {
  const actor = await requireOrganizer();
  try {
    const { row, replaced } = await saveLearnLibraryItem({ ...(input ?? {}), name: input?.name, section: input?.section, actor });
    await appendAudit({
      actor,
      action: replaced ? 'learnSection.update' : 'learnSection.save',
      targetPath: `${LEARN_PAGE_LIBRARY}/${row.id}`,
      subject: SUBJECT,
      targetId: row.id,
      before: {},
      after: { name: row.name, blocks: row.section.blocks.length },
    });
    return { ok: true, id: row.id };
  } catch (err) {
    return failure(err, 'save that section');
  }
}

export async function renameLearnLibraryItemAction(id: string, name: string): Promise<LearnResult<{ name: string }>> {
  const actor = await requireOrganizer();
  try {
    const r = await renameLearnLibraryItem(id, name);
    await appendAudit({
      actor,
      action: 'learnSection.rename',
      targetPath: `${LEARN_PAGE_LIBRARY}/${id}`,
      subject: SUBJECT,
      targetId: id,
      before: { name: r.before },
      after: { name: r.after },
    });
    return { ok: true, name: r.after };
  } catch (err) {
    return failure(err, 'rename that section');
  }
}

/** Refused, with the places named, while the draft, the live page or a kept version points at it. */
export async function deleteLearnLibraryItemAction(id: string): Promise<LearnResult> {
  const actor = await requireOrganizer();
  try {
    const row = await deleteLearnLibraryItem(id);
    await appendAudit({
      actor,
      action: 'learnSection.remove',
      targetPath: `${LEARN_PAGE_LIBRARY}/${row.id}`,
      subject: SUBJECT,
      targetId: row.id,
      before: { name: row.name, blocks: Array.isArray(row.section?.blocks) ? row.section.blocks.length : 0 },
      after: {},
    });
    return { ok: true };
  } catch (err) {
    return failure(err, 'delete that section');
  }
}
