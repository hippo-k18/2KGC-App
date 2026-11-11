'use server';

import type { LearnPageContent } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { recordError } from '@/lib/errors';
import { LearnVersionMissing, loadLearnVersion } from '@/lib/learn-page';
import { LearnUnreadable } from '@/lib/learn-page-core';

/**
 * One published version's content, for the history list's preview.
 *
 * Not in T309's action list, which restores a version into the draft but has
 * no way to look at one first. Read-only, so it needs no audit entry. The id
 * is checked before it reaches Firestore and the content is validated before
 * it reaches the preview, so an odd id or a malformed version is a message,
 * never a 500.
 */
export async function loadLearnVersionAction(
  versionId: string,
): Promise<{ ok: true; content: LearnPageContent } | { ok: false; error: string }> {
  await requireOrganizer();
  try {
    return { ok: true, content: await loadLearnVersion(versionId) };
  } catch (err) {
    if (err instanceof LearnVersionMissing) return { ok: false, error: 'That version no longer exists.' };
    if (err instanceof LearnUnreadable) return { ok: false, error: err.message };
    recordError('learn page load version failed', err);
    return { ok: false, error: 'Could not load that version. Try again in a moment.' };
  }
}
