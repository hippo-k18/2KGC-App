'use server';

import { revalidatePath } from 'next/cache';
import { LEARN_PAGE_DOC, publicSiteOrigin, type PageImage } from '@kgc/shared';
import { appendAudit } from '@/lib/audit';
import { requireOrganizer } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import { editLearnImage } from '@/lib/learn-image-edit';
import { LearnConflict } from '@/lib/learn-page-core';
import {
  cancelLearnSchedule,
  revokeLearnPreviewToken,
  rotateLearnPreviewToken,
  scheduleLearnPublish,
} from '@/lib/learn-page-ops';
import { LearnOpRejected, learnPreviewUrl } from '@/lib/learn-page-ops-core';
import { ROUTES } from '@/lib/nav';
import { UploadRejected, UploadUnavailable } from '@/lib/uploads';
import type { LearnResult } from './actions';

/**
 * Content > Learn Page: scheduled publish, the draft preview link and the
 * image tools (T316). A separate file from T309's `actions.ts` so the builders
 * working on the editor at the same time do not edit one file; the gate is the
 * same (`requireOrganizer()` first, imported only by this screen), and
 * `tests/programme/learn-page-gate.test.ts` covers this file too.
 *
 * The publish itself happens in `/api/cron/learn-page`, run by the droplet's
 * timer, which writes its own audit entry.
 */

const SUBJECT = 'KGC | Learn page';

function failure(err: unknown, what: string): LearnResult<never> {
  if (err instanceof LearnConflict) {
    return { ok: false, error: err.message, conflict: true, currentRevision: err.currentRevision };
  }
  if (err instanceof LearnOpRejected || err instanceof UploadRejected || err instanceof UploadUnavailable) {
    return { ok: false, error: err.message };
  }
  recordError(`learn page ${what} failed`, err);
  return { ok: false, error: `Could not ${what}. Nothing was changed. Try again in a moment.` };
}

function isRevision(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

/**
 * Publish the saved draft at `at` (ms since epoch). Calling it again moves the
 * time. What gets published is the draft as it is at that time, not as it is now.
 */
export async function scheduleLearnPublishAction(
  at: number,
  baseRevision: number,
): Promise<LearnResult<{ scheduledPublishAt: number }>> {
  const actor = await requireOrganizer();
  if (!isRevision(baseRevision)) return { ok: false, error: 'The editor sent no revision. Reload the page.' };
  try {
    const doc = await scheduleLearnPublish(at, baseRevision, actor);
    const scheduledPublishAt = doc.scheduledPublishAt ?? at;
    await appendAudit({
      actor,
      action: 'learnPage.schedule',
      targetPath: LEARN_PAGE_DOC,
      subject: SUBJECT,
      targetId: 'learn',
      before: { revision: baseRevision },
      after: { scheduledPublishAt: new Date(scheduledPublishAt).toISOString() },
    });
    revalidatePath(ROUTES.learnPage);
    return { ok: true, scheduledPublishAt };
  } catch (err) {
    return failure(err, 'schedule the page');
  }
}

export async function cancelLearnScheduleAction(): Promise<LearnResult<{ cancelled: boolean }>> {
  const actor = await requireOrganizer();
  try {
    const was = await cancelLearnSchedule();
    if (was !== null) {
      await appendAudit({
        actor,
        action: 'learnPage.cancelSchedule',
        targetPath: LEARN_PAGE_DOC,
        subject: SUBJECT,
        targetId: 'learn',
        before: { scheduledPublishAt: new Date(was).toISOString() },
        after: {},
      });
      revalidatePath(ROUTES.learnPage);
    }
    return { ok: true, cancelled: was !== null };
  } catch (err) {
    return failure(err, 'cancel the schedule');
  }
}

/**
 * Make a link that shows the current draft to anyone who has it, without
 * signing in. Calling it again makes a new link and the old one stops working.
 */
export async function createLearnPreviewLinkAction(): Promise<LearnResult<{ token: string; url: string }>> {
  const actor = await requireOrganizer();
  try {
    const token = await rotateLearnPreviewToken();
    await appendAudit({
      actor,
      action: 'learnPage.previewLink',
      targetPath: LEARN_PAGE_DOC,
      subject: SUBJECT,
      targetId: 'learn',
      before: {},
      // Never the token itself: the audit log is read by more people than the link was meant for.
      after: { previewLink: 'created' },
    });
    revalidatePath(ROUTES.learnPage);
    return { ok: true, token, url: learnPreviewUrl(publicSiteOrigin(), token) };
  } catch (err) {
    return failure(err, 'make a preview link');
  }
}

export async function revokeLearnPreviewLinkAction(): Promise<LearnResult<{ revoked: boolean }>> {
  const actor = await requireOrganizer();
  try {
    const revoked = await revokeLearnPreviewToken();
    if (revoked) {
      await appendAudit({
        actor,
        action: 'learnPage.previewLink',
        targetPath: LEARN_PAGE_DOC,
        subject: SUBJECT,
        targetId: 'learn',
        before: { previewLink: 'on' },
        after: { previewLink: 'off' },
      });
      revalidatePath(ROUTES.learnPage);
    }
    return { ok: true, revoked };
  } catch (err) {
    return failure(err, 'turn off the preview link');
  }
}

/**
 * Crop, rotate, flip, resize or convert an uploaded image. The result is a new
 * file and a new media library row; the original is kept, so pages and older
 * versions that use it are unaffected. The editor swaps the block's image for
 * the returned one.
 */
export async function editLearnImageAction(input: {
  src: string;
  edit: unknown;
  alt?: string;
}): Promise<LearnResult<{ image: PageImage; mediaId: string }>> {
  const actor = await requireOrganizer();
  if (!input || typeof input.src !== 'string') return { ok: false, error: 'Choose an image to edit.' };
  try {
    const { image, mediaId, path, bytes } = await editLearnImage({
      src: input.src,
      edit: input.edit,
      alt: typeof input.alt === 'string' ? input.alt : undefined,
      actor,
    });
    await appendAudit({
      actor,
      action: 'learnPage.editImage',
      targetPath: LEARN_PAGE_DOC,
      subject: SUBJECT,
      targetId: 'learn',
      before: {},
      after: { path, mediaId, bytes, width: image.width, height: image.height },
    });
    return { ok: true, image, mediaId };
  } catch (err) {
    return failure(err, 'edit that image');
  }
}
