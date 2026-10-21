'use server';

import type { LearnPageContent, PageImage } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { db } from '@/lib/firestore';
import { DEV_DOC, loadLearnEditor, loadLearnVersion, type LearnEditorState } from '@/lib/learn-page-dev';
import { learnPageDevDefault } from '@/lib/learn-page-dev-default';

/**
 * ⚠️ Stand-ins for T309's `./actions.ts`, same names and signatures as
 * `orchestrator/reports/T309-api.md`, so the editor could be built and
 * screenshotted while the store was being written. No validation, no audit,
 * the upload returns a data: URL. Delete on merge and point `./api.ts` at
 * `./actions`.
 */

export type LearnResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; conflict?: boolean; currentRevision?: number; problems?: string[] };

export async function loadLearnEditorAction(): Promise<LearnResult<{ state: LearnEditorState }>> {
  await requireOrganizer();
  return { ok: true, state: await loadLearnEditor() };
}

async function current() {
  const snap = await db().doc(DEV_DOC).get();
  return snap.exists ? snap.data()! : null;
}

export async function saveLearnDraftAction(
  content: LearnPageContent,
  baseRevision: number,
): Promise<LearnResult<{ revision: number; savedAt: number }>> {
  const who = await requireOrganizer();
  const doc = await current();
  const revision = (doc?.revision as number | undefined) ?? 0;
  if (revision !== baseRevision)
    return {
      ok: false,
      conflict: true,
      currentRevision: revision,
      error: 'Someone else saved this page since you opened it.',
    };
  const savedAt = Date.now();
  await db()
    .doc(DEV_DOC)
    .set(
      { draft: content, published: doc?.published ?? null, draftUpdatedAt: savedAt, draftUpdatedBy: who, revision: revision + 1 },
      { merge: true },
    );
  return { ok: true, revision: revision + 1, savedAt };
}

export async function publishLearnPageAction(input: {
  baseRevision: number;
  content?: LearnPageContent;
  note?: string;
}): Promise<LearnResult<{ revision: number; publishedAt: number; versionId: string }>> {
  const who = await requireOrganizer();
  let revision = input.baseRevision;
  if (input.content) {
    const saved = await saveLearnDraftAction(input.content, input.baseRevision);
    if (!saved.ok) return saved;
    revision = saved.revision;
  }
  const doc = await current();
  const draft = (doc?.draft as LearnPageContent | undefined) ?? learnPageDevDefault();
  const publishedAt = Date.now();
  const v = await db().doc(DEV_DOC).collection('versions').add({
    content: draft,
    publishedAt,
    publishedBy: who,
    ...(input.note ? { note: input.note } : {}),
  });
  await db().doc(DEV_DOC).set({ published: draft, publishedAt, publishedBy: who }, { merge: true });
  return { ok: true, revision, publishedAt, versionId: v.id };
}

export async function revertLearnDraftAction(): Promise<LearnResult<{ revision: number; draft: LearnPageContent }>> {
  const who = await requireOrganizer();
  const doc = await current();
  const draft = (doc?.published as LearnPageContent | null) ?? learnPageDevDefault();
  const revision = ((doc?.revision as number | undefined) ?? 0) + 1;
  await db().doc(DEV_DOC).set({ draft, revision, draftUpdatedAt: Date.now(), draftUpdatedBy: who }, { merge: true });
  return { ok: true, revision, draft };
}

export async function restoreLearnVersionAction(
  versionId: string,
): Promise<LearnResult<{ revision: number; draft: LearnPageContent }>> {
  const who = await requireOrganizer();
  const content = await loadLearnVersion(versionId);
  if (!content) return { ok: false, error: 'That version no longer exists.' };
  const doc = await current();
  const revision = ((doc?.revision as number | undefined) ?? 0) + 1;
  await db()
    .doc(DEV_DOC)
    .set({ draft: content, published: doc?.published ?? null, revision, draftUpdatedAt: Date.now(), draftUpdatedBy: who }, { merge: true });
  return { ok: true, revision, draft: content };
}

export async function uploadLearnImageAction(formData: FormData): Promise<LearnResult<{ image: PageImage }>> {
  await requireOrganizer();
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'Choose an image first.' };
  const buf = Buffer.from(await file.arrayBuffer());
  return {
    ok: true,
    image: { src: `data:${file.type};base64,${buf.toString('base64')}`, alt: '', width: 0, height: 0 },
  };
}
