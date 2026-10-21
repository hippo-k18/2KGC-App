'use server';

import { LEARN_PAGE_VERSIONS, type LearnPageContent } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { db } from '@/lib/firestore';

/**
 * One published version's content, for the history list's preview.
 *
 * Not in T309's action list, which restores a version into the draft but has
 * no way to look at one first. Read-only, so it needs no audit entry.
 */
export async function loadLearnVersionAction(
  versionId: string,
): Promise<{ ok: true; content: LearnPageContent } | { ok: false; error: string }> {
  await requireOrganizer();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(versionId)) return { ok: false, error: 'That version no longer exists.' };
  const snap = await db().collection(LEARN_PAGE_VERSIONS).doc(versionId).get();
  if (!snap.exists) return { ok: false, error: 'That version no longer exists.' };
  return { ok: true, content: snap.get('content') as LearnPageContent };
}
