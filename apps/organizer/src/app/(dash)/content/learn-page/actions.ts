'use server';

import { revalidatePath } from 'next/cache';
import { LEARN_PAGE_DOC, type LearnPageContent, type PageImage } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import { recordLearnMedia } from '@/lib/learn-media';
import { uploadName } from '@/lib/learn-media-core';
import {
  LearnPublishInvalid,
  LearnVersionMissing,
  loadLearnEditor,
  loadLearnLibrarySections,
  publishLearnPage,
  restoreLearnVersion,
  revertLearnDraft,
  saveLearnDraft,
  uploadLearnImage,
  usingStorageEmulator,
  type LearnEditorState,
} from '@/lib/learn-page';
import { LEARN_LIMITS, LearnConflict, validateLearnContent } from '@/lib/learn-page-core';
import { ROUTES } from '@/lib/nav';
import { UploadRejected, UploadUnavailable } from '@/lib/uploads';

/**
 * Content > Learn Page: the editor's five verbs, plus a reload (T309).
 *
 * Every action starts with `requireOrganizer()`, which is also the role gate:
 * this file is imported only by the `content/learn-page` screen, so only an
 * owner or a member holding the `learn` role can run it (`team-core.ts`,
 * `canRunAction`). Content is validated here, on the server, before anything
 * is stored; the editor's own checks are a courtesy.
 *
 * The website re-renders /learn on its own 30 second revalidate window, the
 * way every other dashboard content edit reaches www; there is no on-demand
 * revalidation endpoint on www to call.
 */

export type LearnResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; conflict?: boolean; currentRevision?: number; problems?: string[] };

function refreshEditor() {
  revalidatePath(ROUTES.learnPage);
}

function failure(err: unknown, what: string): LearnResult<never> {
  if (err instanceof LearnConflict) {
    return { ok: false, error: err.message, conflict: true, currentRevision: err.currentRevision };
  }
  if (err instanceof LearnPublishInvalid) return { ok: false, error: err.message, problems: err.problems };
  if (err instanceof LearnVersionMissing || err instanceof UploadRejected || err instanceof UploadUnavailable) {
    return { ok: false, error: err.message };
  }
  recordError(`learn page ${what} failed`, err);
  return { ok: false, error: `Could not ${what}. Nothing was changed. Try again in a moment.` };
}

/** Validated against the saved sections that exist now, so a reusable block can never point nowhere. */
async function checkContent(content: unknown): Promise<{ ok: true; content: LearnPageContent } | LearnResult<never>> {
  const libraryIds = new Set((await loadLearnLibrarySections()).keys());
  const v = validateLearnContent(content, { allowEmulator: usingStorageEmulator(), libraryIds });
  if (!v.ok) {
    return { ok: false, error: 'Some parts of the page need fixing before it can be saved.', problems: v.problems };
  }
  return v;
}

function isRevision(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

export async function loadLearnEditorAction(): Promise<LearnResult<{ state: LearnEditorState }>> {
  await requireOrganizer();
  try {
    return { ok: true, state: await loadLearnEditor() };
  } catch (err) {
    return failure(err, 'load the page');
  }
}

export async function saveLearnDraftAction(
  content: LearnPageContent,
  baseRevision: number,
): Promise<LearnResult<{ revision: number; savedAt: number }>> {
  const actor = await requireOrganizer();
  if (!isRevision(baseRevision)) return { ok: false, error: 'The editor sent no revision. Reload the page.' };
  const checked = await checkContent(content);
  if (!checked.ok) return checked;
  try {
    const doc = await saveLearnDraft(checked.content, baseRevision, actor);
    await appendAudit({
      actor,
      action: 'learnPage.saveDraft',
      targetPath: LEARN_PAGE_DOC,
      subject: 'KGC | Learn page',
      targetId: 'learn',
      before: { revision: baseRevision },
      after: { revision: doc.revision },
    });
    refreshEditor();
    return { ok: true, revision: doc.revision, savedAt: doc.draftUpdatedAt };
  } catch (err) {
    return failure(err, 'save the draft');
  }
}

export async function publishLearnPageAction(input: {
  baseRevision: number;
  content?: LearnPageContent;
  note?: string;
}): Promise<LearnResult<{ revision: number; publishedAt: number; versionId: string }>> {
  const actor = await requireOrganizer();
  if (!input || !isRevision(input.baseRevision)) return { ok: false, error: 'The editor sent no revision. Reload the page.' };
  let content: LearnPageContent | undefined;
  if (input.content !== undefined) {
    const checked = await checkContent(input.content);
    if (!checked.ok) return checked;
    content = checked.content;
  }
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, LEARN_LIMITS.note) : undefined;
  try {
    const { doc, versionId } = await publishLearnPage({ baseRevision: input.baseRevision, content, note, actor });
    await appendAudit({
      actor,
      action: 'learnPage.publish',
      targetPath: LEARN_PAGE_DOC,
      subject: 'KGC | Learn page',
      targetId: 'learn',
      before: { revision: input.baseRevision },
      after: { revision: doc.revision, versionId, note: note || null },
    });
    refreshEditor();
    return { ok: true, revision: doc.revision, publishedAt: doc.publishedAt ?? Date.now(), versionId };
  } catch (err) {
    return failure(err, 'publish the page');
  }
}

export async function revertLearnDraftAction(): Promise<LearnResult<{ revision: number; draft: LearnPageContent }>> {
  const actor = await requireOrganizer();
  try {
    const doc = await revertLearnDraft(actor);
    await appendAudit({
      actor,
      action: 'learnPage.revert',
      targetPath: LEARN_PAGE_DOC,
      subject: 'KGC | Learn page',
      targetId: 'learn',
      before: {},
      after: { revision: doc.revision },
    });
    refreshEditor();
    return { ok: true, revision: doc.revision, draft: doc.draft };
  } catch (err) {
    return failure(err, 'discard the draft');
  }
}

export async function restoreLearnVersionAction(
  versionId: string,
): Promise<LearnResult<{ revision: number; draft: LearnPageContent }>> {
  const actor = await requireOrganizer();
  try {
    const doc = await restoreLearnVersion(String(versionId ?? ''), actor);
    await appendAudit({
      actor,
      action: 'learnPage.restore',
      targetPath: LEARN_PAGE_DOC,
      subject: 'KGC | Learn page',
      targetId: 'learn',
      before: {},
      after: { revision: doc.revision, versionId },
    });
    refreshEditor();
    return { ok: true, revision: doc.revision, draft: doc.draft };
  } catch (err) {
    return failure(err, 'restore that version');
  }
}

export async function uploadLearnImageAction(formData: FormData): Promise<LearnResult<{ image: PageImage; mediaId?: string }>> {
  const actor = await requireOrganizer();
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'Choose an image file.' };
  try {
    const { image, path, bytes, resized } = await uploadLearnImage(file);
    // The media library row (T315). The file is already stored and usable, so a
    // failed row write is logged rather than failing the upload; Rescan (backfill) picks it up.
    let mediaId: string | undefined;
    try {
      mediaId = (await recordLearnMedia({ path, image, bytes, fileName: uploadName(file.name), actor })).id;
    } catch (err) {
      recordError('learn page media row write failed', err);
    }
    await appendAudit({
      actor,
      action: 'learnPage.uploadImage',
      targetPath: LEARN_PAGE_DOC,
      subject: 'KGC | Learn page',
      targetId: 'learn',
      before: {},
      after: { path, bytes, width: image.width, height: image.height, resized, mediaId: mediaId ?? null },
    });
    return mediaId ? { ok: true, image, mediaId } : { ok: true, image };
  } catch (err) {
    return failure(err, 'upload that image');
  }
}
