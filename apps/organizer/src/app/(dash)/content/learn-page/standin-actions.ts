'use server';

import { randomBytes } from 'node:crypto';
import {
  COLLECTIONS,
  type LearnLibraryItem,
  type LearnMediaItem,
  type LearnSection,
  type PageImage,
} from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { db } from '@/lib/firestore';

/**
 * STAND-INS for the v2 backend actions (T318), so the editor shell can be
 * built and screenshotted while T315 (media, library) and T316 (schedule,
 * preview link, image tools) build the real ones. Same names, same shapes as
 * the contract asks for; minimal checks, no audit.
 *
 * ⚠️ Delete this file at integration and point `api.ts` at the real actions.
 * The exact list is in orchestrator/reports/T318.md, "Wiring left".
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; usedIn?: string[] };

const learnDoc = () => db().collection(COLLECTIONS.pageLayouts).doc('learn');
const media = () => learnDoc().collection('media');
const library = () => learnDoc().collection('library');

export type MediaRow = LearnMediaItem & { id: string };
export type LibraryRow = LearnLibraryItem & { id: string };

export async function listLearnMediaAction(): Promise<Result<{ items: MediaRow[] }>> {
  await requireOrganizer();
  const snap = await media().orderBy('uploadedAt', 'desc').limit(500).get();
  return { ok: true, items: snap.docs.map((d) => ({ id: d.id, ...(d.data() as LearnMediaItem) })) };
}

export async function updateLearnMediaAction(
  id: string,
  patch: { fileName?: string; tags?: string[]; alt?: string },
): Promise<Result<{ item: MediaRow }>> {
  await requireOrganizer();
  const ref = media().doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: 'That image is no longer in the library.' };
  const cur = snap.data() as LearnMediaItem;
  const next: LearnMediaItem = { ...cur };
  if (typeof patch.fileName === 'string' && patch.fileName.trim()) next.fileName = patch.fileName.trim().slice(0, 120);
  if (Array.isArray(patch.tags)) next.tags = patch.tags.map((t) => String(t).trim().toLowerCase().slice(0, 30)).filter(Boolean).slice(0, 20);
  if (typeof patch.alt === 'string') next.image = { ...next.image, alt: patch.alt.slice(0, 300) };
  await ref.set(next);
  return { ok: true, item: { id, ...next } };
}

/** Refuses when the draft or the live page uses the image, and says where. */
export async function deleteLearnMediaAction(id: string, usedIn: string[]): Promise<Result> {
  await requireOrganizer();
  if (usedIn.length > 0) return { ok: false, error: 'This image is still used on the page.', usedIn };
  await media().doc(String(id)).delete();
  return { ok: true };
}

/** Adds a library row for an image the v1 upload stored, so it shows in the grid at once. */
export async function recordLearnMediaAction(image: PageImage, fileName: string, bytes: number): Promise<Result<{ item: MediaRow }>> {
  const actor = await requireOrganizer();
  const item: LearnMediaItem = { image, fileName: fileName.slice(0, 120), bytes, uploadedAt: Date.now(), uploadedBy: actor };
  const ref = await media().add(item);
  return { ok: true, item: { id: ref.id, ...item } };
}

export async function transformLearnImageAction(input: {
  src: string;
  crop?: { x: number; y: number; width: number; height: number };
  rotate?: 0 | 90 | 180 | 270;
  flipX?: boolean;
  flipY?: boolean;
}): Promise<Result<{ image: PageImage }>> {
  await requireOrganizer();
  void input;
  return { ok: false, error: 'Saving edited images is not switched on yet. Your crop is kept as the focal point.' };
}

export async function listLearnLibraryAction(): Promise<Result<{ items: LibraryRow[] }>> {
  await requireOrganizer();
  const snap = await library().orderBy('createdAt', 'desc').limit(200).get();
  return { ok: true, items: snap.docs.map((d) => ({ id: d.id, ...(d.data() as LearnLibraryItem) })) };
}

export async function saveLearnLibraryAction(name: string, section: LearnSection): Promise<Result<{ item: LibraryRow }>> {
  const actor = await requireOrganizer();
  const item: LearnLibraryItem = { name: String(name).trim().slice(0, 80) || 'Saved section', section, createdAt: Date.now(), createdBy: actor };
  const ref = await library().add(JSON.parse(JSON.stringify(item)));
  return { ok: true, item: { id: ref.id, ...item } };
}

export async function renameLearnLibraryAction(id: string, name: string): Promise<Result> {
  await requireOrganizer();
  await library().doc(String(id)).update({ name: String(name).trim().slice(0, 80) });
  return { ok: true };
}

export async function deleteLearnLibraryAction(id: string): Promise<Result> {
  await requireOrganizer();
  await library().doc(String(id)).delete();
  return { ok: true };
}

export async function scheduleLearnPublishAction(at: number): Promise<Result<{ scheduledPublishAt: number }>> {
  const actor = await requireOrganizer();
  if (!Number.isFinite(at) || at < Date.now() + 30_000) return { ok: false, error: 'Choose a time in the future.' };
  await learnDoc().set({ scheduledPublishAt: at, scheduledBy: actor }, { merge: true });
  return { ok: true, scheduledPublishAt: at };
}

export async function cancelLearnScheduleAction(): Promise<Result> {
  await requireOrganizer();
  const { FieldValue } = await import('firebase-admin/firestore');
  await learnDoc().set({ scheduledPublishAt: FieldValue.delete(), scheduledBy: FieldValue.delete() }, { merge: true });
  return { ok: true };
}

export async function createLearnPreviewLinkAction(): Promise<Result<{ token: string }>> {
  await requireOrganizer();
  const token = randomBytes(24).toString('base64url');
  await learnDoc().set({ previewToken: token }, { merge: true });
  return { ok: true, token };
}

export async function revokeLearnPreviewLinkAction(): Promise<Result> {
  await requireOrganizer();
  const { FieldValue } = await import('firebase-admin/firestore');
  await learnDoc().set({ previewToken: FieldValue.delete() }, { merge: true });
  return { ok: true };
}
