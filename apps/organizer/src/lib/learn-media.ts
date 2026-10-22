import 'server-only';

import { randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import type { File as StorageFile } from '@google-cloud/storage';
import {
  LEARN_PAGE_LIBRARY,
  LEARN_PAGE_MEDIA,
  type LearnLibraryItem,
  type LearnMediaItem,
  type LearnPageContent,
  type LearnPageDoc,
  type LearnPageVersion,
  type PageImage,
} from '@kgc/shared';
import { db } from './firestore';
import { learnImageUrl, learnValidateOptions, loadSharp } from './learn-page';
import { validateLearnSection } from './learn-page-core';
import type { LearnImageEditState } from './learn-image-edit-core';
import {
  MEDIA_LIMITS,
  allTags,
  cleanName,
  cleanTags,
  dedupeMediaRows,
  imageUseMap,
  inUseMessage,
  isRowId,
  learnImageObjectPath,
  mediaIdForPath,
  mediaSources,
  parseMediaRow,
  queryMedia,
  savedSectionUses,
  versionLabel,
  type MediaRow,
  type MediaSort,
} from './learn-media-core';
import { storageBucketName } from './uploads';

/**
 * The Learn page's media library and saved sections (T315).
 *
 * `pageLayouts/learn/media/{id}` has one row per uploaded image, keyed by the
 * random file name the upload chose, so the editor can list, search, rename,
 * tag and delete images without listing the bucket. `pageLayouts/learn/library/{id}`
 * holds saved sections that `reusable` blocks point at; publishing expands them
 * (`expandReusableBlocks`), so www never reads the library.
 *
 * A delete of either is refused while anything still uses it: the draft, the
 * live page, a kept version (Restore can bring it back), or a saved section.
 * Every decision is in `learn-media-core.ts`.
 */

/** Refused with a message the editor shows as it is. */
export class LearnMediaRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearnMediaRefused';
  }
}

function mediaCol() {
  return db().collection(LEARN_PAGE_MEDIA);
}

function libraryCol() {
  return db().collection(LEARN_PAGE_LIBRARY);
}

function pageRef() {
  return db().doc('pageLayouts/learn');
}

/** Everything that may hold an image or a reusable block: the page, its versions, the library. */
async function loadSources(): Promise<{
  draft: LearnPageContent | null;
  published: LearnPageContent | null;
  versions: { id: string; publishedAt: number; content: LearnPageContent }[];
  library: { id: string; item: LearnLibraryItem }[];
}> {
  const [page, versions, library] = await Promise.all([
    pageRef().get(),
    pageRef().collection('versions').get(),
    libraryCol().get(),
  ]);
  // Read loosely: every consumer (`mediaSources`, `savedSectionUses`) copes with
  // a stored doc of the wrong shape, so one bad row costs only itself.
  const doc = page.exists ? ((page.data() ?? null) as Partial<LearnPageDoc> | null) : null;
  return {
    draft: doc?.draft ?? null,
    published: doc?.published ?? null,
    versions: versions.docs.map((d) => {
      const v = (d.data() ?? {}) as Partial<LearnPageVersion>;
      return { id: d.id, publishedAt: v.publishedAt as number, content: v.content as LearnPageContent };
    }),
    library: library.docs.map((d) => ({ id: d.id, item: (d.data() ?? {}) as LearnLibraryItem })),
  };
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export interface LearnMediaListing {
  items: (MediaRow & { uses: string[] })[];
  tags: string[];
  /** Rows before the search and tag filter. */
  total: number;
  /** Rows the backfill added on this call (the first list after T315 ships). */
  backfilled: number;
}

/** Write the row for an image `uploadLearnImage` just stored. */
export async function recordLearnMedia(input: {
  path: string;
  image: PageImage;
  bytes: number;
  fileName: string;
  actor: string;
}): Promise<MediaRow> {
  const id = mediaIdForPath(input.path);
  if (!id) throw new Error(`Upload path ${input.path} is not a Learn page image path.`);
  const row: LearnMediaItem = {
    image: input.image,
    fileName: input.fileName,
    bytes: input.bytes,
    uploadedAt: Date.now(),
    uploadedBy: input.actor,
  };
  await mediaCol().doc(id).set(row);
  return { id, ...row };
}

/** A row the library cannot use is skipped and logged, never thrown: one bad row must not hide the rest. */
function parseOrWarn(id: string, data: unknown): MediaRow | null {
  const parsed = parseMediaRow(id, data);
  if (parsed.ok) return parsed.row;
  console.warn(`[learn media] skipped row ${LEARN_PAGE_MEDIA}/${id}: ${parsed.reason}`);
  return null;
}

/** Every usable row, including a second row for the same file (see `dedupeMediaRows`). */
async function readAllRows(): Promise<MediaRow[]> {
  const snap = await mediaCol().limit(MEDIA_LIMITS.listed).get();
  return snap.docs.flatMap((d) => parseOrWarn(d.id, d.data()) ?? []);
}

async function readRows(): Promise<MediaRow[]> {
  return dedupeMediaRows(await readAllRows()).rows;
}

export async function listLearnMedia(opts: { search?: string; tag?: string; sort?: MediaSort } = {}): Promise<LearnMediaListing> {
  let rows = await readRows();
  let backfilled = 0;
  if (rows.length === 0) {
    backfilled = (await backfillLearnMedia()).added;
    if (backfilled > 0) rows = await readRows();
  }
  const uses = imageUseMap(mediaSources(await loadSources()));
  const items = queryMedia(rows, opts).map((r) => ({
    ...r,
    uses: uses.get(learnImageObjectPath(r.image.src) ?? '') ?? [],
  }));
  return { items, tags: allTags(rows), total: rows.length, backfilled };
}

async function usesOfRow(row: LearnMediaItem): Promise<string[]> {
  const path = learnImageObjectPath(row.image.src);
  if (!path) return [];
  return imageUseMap(mediaSources(await loadSources())).get(path) ?? [];
}

async function getRow(id: unknown): Promise<MediaRow> {
  if (!isRowId(id)) throw new LearnMediaRefused('That image is not in the library any more.');
  const snap = await mediaCol().doc(id).get();
  const row = snap.exists ? parseOrWarn(id, snap.data()) : null;
  if (!row) throw new LearnMediaRefused('That image is not in the library any more.');
  return row;
}

export async function learnMediaUses(id: string): Promise<string[]> {
  return usesOfRow(await getRow(id));
}

/**
 * Rename, retag, or set the alt text the editor offers when the image is next
 * inserted. Changing the alt text here does not change images already placed
 * on the page; each placement keeps its own.
 */
export async function updateLearnMedia(
  id: string,
  patch: { fileName?: unknown; tags?: unknown; alt?: unknown },
): Promise<{ before: MediaRow; after: MediaRow }> {
  const next: Partial<LearnMediaItem> = {};
  if (patch.fileName !== undefined) {
    const name = cleanName(patch.fileName, MEDIA_LIMITS.fileName);
    if (!name) throw new LearnMediaRefused(`Give the image a name of 1 to ${MEDIA_LIMITS.fileName} characters.`);
    next.fileName = name;
  }
  let tags: string[] | undefined;
  if (patch.tags !== undefined) {
    const t = cleanTags(patch.tags);
    if (!t) {
      throw new LearnMediaRefused(
        `Tags are words of up to ${MEDIA_LIMITS.tag} letters, digits, spaces or dashes, at most ${MEDIA_LIMITS.tags} of them.`,
      );
    }
    tags = t;
  }
  let alt: string | undefined;
  if (patch.alt !== undefined) {
    if (typeof patch.alt !== 'string' || patch.alt.length > 300) throw new LearnMediaRefused('Alt text is at most 300 characters.');
    alt = patch.alt.trim();
  }
  if (!isRowId(id)) throw new LearnMediaRefused('That image is not in the library any more.');
  const ref = mediaCol().doc(id);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const parsed = snap.exists ? parseOrWarn(id, snap.data()) : null;
    if (!parsed) throw new LearnMediaRefused('That image is not in the library any more.');
    const before = parsed;
    // A whole-document set, so a cleared tag list is really cleared (AGENTS.md gotcha 9).
    const after: Omit<MediaRow, 'id'> = {
      image: alt === undefined ? before.image : { ...before.image, alt },
      fileName: next.fileName ?? before.fileName,
      bytes: before.bytes,
      uploadedAt: before.uploadedAt,
      uploadedBy: before.uploadedBy,
    };
    const finalTags = tags ?? before.tags;
    if (finalTags && finalTags.length) after.tags = finalTags;
    if (before.editedFrom) after.editedFrom = before.editedFrom;
    tx.set(ref, after);
    return { before, after: { id, ...after } };
  });
}

/** Delete the file and its row, unless anything still uses it. */
export async function deleteLearnMedia(id: string): Promise<MediaRow> {
  const row = await getRow(id);
  const uses = await usesOfRow(row);
  if (uses.length) throw new LearnMediaRefused(inUseMessage(`"${row.fileName}"`, uses));
  const path = learnImageObjectPath(row.image.src);
  if (path) {
    db();
    try {
      await getStorage().bucket(storageBucketName()).file(path).delete();
    } catch (err) {
      // Already gone is the outcome we wanted.
      if ((err as { code?: unknown } | null)?.code !== 404) throw err;
    }
  }
  // Any other row for the same file (a pre-T325 Rescan duplicate) goes too,
  // so no row is left pointing at the deleted file.
  const batch = db().batch();
  batch.delete(mediaCol().doc(row.id));
  if (path) {
    for (const other of await readAllRows()) {
      if (other.id !== row.id && learnImageObjectPath(other.image.src) === path) batch.delete(mediaCol().doc(other.id));
    }
  }
  await batch.commit();
  return row;
}

/**
 * Where "Edit image" should start for `src` (T325, D8): when `src` is an
 * edited copy whose original is still stored, the original and the crop,
 * turn and flips that made the copy, so the editor works from the full
 * picture instead of cropping the copy again. Null means edit `src` itself.
 */
export async function learnImageEditStart(
  src: unknown,
): Promise<{ image: PageImage; state: LearnImageEditState } | null> {
  if (typeof src !== 'string') return null;
  const path = learnImageObjectPath(src);
  if (!path) return null;
  const row = await rowForPath(path, src);
  const from = row?.editedFrom;
  if (!from) return null;
  const originalPath = learnImageObjectPath(from.image.src);
  if (!originalPath || originalPath === path) return null;
  const original = await rowForPath(originalPath, from.image.src);
  let image: PageImage;
  if (original) {
    image = { src: original.image.src, alt: '', width: original.image.width, height: original.image.height };
  } else {
    // An original from before the library has no row; use it while the file is there.
    db();
    const [exists] = await getStorage().bucket(storageBucketName()).file(originalPath).exists();
    if (!exists) return null;
    image = { src: from.image.src, alt: '', width: from.image.width, height: from.image.height };
  }
  return { image, state: { crop: from.crop, rotate: from.rotate, flipX: from.flipX, flipY: from.flipY } };
}

/** The row for a stored file: keyed by its file name, or (an older edited copy) found by its URL. */
async function rowForPath(path: string, src: string): Promise<MediaRow | null> {
  const id = mediaIdForPath(path);
  if (id) {
    const snap = await mediaCol().doc(id).get();
    const row = snap.exists ? parseOrWarn(id, snap.data()) : null;
    if (row) return row;
  }
  const q = await mediaCol().where('image.src', '==', src).limit(1).get();
  return q.empty ? null : parseOrWarn(q.docs[0].id, q.docs[0].data());
}

/**
 * Write a row for every image under `pageLayouts/learn/` that has none: the
 * ones uploaded before the media library existed. Reads each file's real size
 * from its bytes, keeps its existing download token (so URLs already on the
 * page keep working), and gives a token to a file that has none. Idempotent:
 * a file with a row is skipped.
 */
export async function backfillLearnMedia(): Promise<{ added: number; skipped: number }> {
  db();
  const bucket = getStorage().bucket(storageBucketName());
  let files: StorageFile[];
  try {
    [files] = await bucket.getFiles({ prefix: 'pageLayouts/learn/' });
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === 404) return { added: 0, skipped: 0 };
    throw err;
  }
  // A file is skipped when a row has its name as id, or when any row (an
  // edited copy from before T325 has an auto id) already points at it.
  const snap = await mediaCol().get();
  const existing = new Set(snap.docs.map((d) => d.id));
  const referenced = new Set<string>();
  for (const d of snap.docs) {
    const src = (d.data() as { image?: { src?: unknown } } | undefined)?.image?.src;
    const p = typeof src === 'string' ? learnImageObjectPath(src) : null;
    if (p) referenced.add(p);
  }
  const sharp = await loadSharp();
  let added = 0;
  let skipped = 0;
  for (const file of files) {
    const id = mediaIdForPath(file.name);
    if (!id || existing.has(id) || referenced.has(file.name)) {
      skipped++;
      continue;
    }
    const [meta] = await file.getMetadata();
    let token = String(meta.metadata?.firebaseStorageDownloadTokens ?? '').split(',')[0];
    if (!token) {
      token = randomUUID();
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
    }
    let width = 0;
    let height = 0;
    if (sharp) {
      try {
        const [bytes] = await file.download();
        const m = await sharp(bytes, { animated: true }).metadata();
        const rotated = (m.orientation ?? 1) >= 5;
        const w = m.width ?? 0;
        const h = m.pageHeight ?? m.height ?? 0;
        width = rotated ? h : w;
        height = rotated ? w : h;
      } catch {
        // Not readable as an image: no row, since the editor could not place it.
      }
    }
    if (!width || !height) {
      skipped++;
      continue;
    }
    const created = Date.parse(String(meta.timeCreated ?? ''));
    const row: LearnMediaItem = {
      image: { src: learnImageUrl(file.name, token), alt: '', width, height },
      fileName: file.name.slice('pageLayouts/learn/'.length),
      bytes: Number(meta.size) || 0,
      uploadedAt: Number.isFinite(created) ? created : Date.now(),
      uploadedBy: '',
    };
    // `create`, so a row the editor wrote meanwhile is never overwritten.
    try {
      await mediaCol().doc(id).create(row);
      added++;
    } catch {
      skipped++;
    }
  }
  return { added, skipped };
}

// ---------------------------------------------------------------------------
// Saved sections
// ---------------------------------------------------------------------------

export interface LearnLibraryRow extends LearnLibraryItem {
  id: string;
  /** Where the draft, the live page or a kept version points at it. */
  uses: string[];
}

function libraryUses(
  id: string,
  sources: { draft: LearnPageContent | null; published: LearnPageContent | null; versions: { publishedAt: number; content: LearnPageContent }[] },
): string[] {
  const out: string[] = [];
  for (const w of savedSectionUses(sources.draft, id)) out.push(`Draft: ${w}`);
  for (const w of savedSectionUses(sources.published, id)) out.push(`Live page: ${w}`);
  for (const v of sources.versions) {
    for (const w of savedSectionUses(v.content, id)) out.push(`${versionLabel(v.publishedAt)}: ${w}`);
  }
  return out;
}

/** A saved section the editor can list: a name and a section with blocks. Others are skipped and logged. */
function usableLibraryItem(id: string, item: unknown): item is LearnLibraryItem {
  const i = item as Partial<LearnLibraryItem> | null;
  const ok =
    !!i && typeof i.name === 'string' && !!i.section && typeof i.section === 'object' && Array.isArray(i.section.blocks);
  if (!ok) console.warn(`[learn media] skipped saved section ${LEARN_PAGE_LIBRARY}/${id}: not the right shape`);
  return ok;
}

export async function listLearnLibrary(): Promise<LearnLibraryRow[]> {
  const sources = await loadSources();
  const time = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
  return sources.library
    .filter(({ id, item }) => usableLibraryItem(id, item))
    .map(({ id, item }) => ({ id, ...item, uses: libraryUses(id, sources) }))
    .sort((a, b) => time(b.createdAt) - time(a.createdAt) || a.name.localeCompare(b.name));
}

/**
 * Save a section to the library, or replace the section of an existing item
 * (`replaceId`). The section is validated with the page's own rules, and may
 * not hold a reusable block itself.
 */
export async function saveLearnLibraryItem(input: {
  name: unknown;
  section: unknown;
  replaceId?: unknown;
  actor: string;
}): Promise<{ row: LearnLibraryItem & { id: string }; replaced: boolean }> {
  const name = cleanName(input.name, MEDIA_LIMITS.libraryName);
  if (!name) throw new LearnMediaRefused(`Give the saved section a name of 1 to ${MEDIA_LIMITS.libraryName} characters.`);
  const v = validateLearnSection(input.section, { ...learnValidateOptions(), forLibrary: true });
  if (!v.ok) throw new LearnMediaRefused(`That section cannot be saved: ${v.problems.slice(0, 5).join(' ')}`);

  if (input.replaceId !== undefined && input.replaceId !== null) {
    if (!isRowId(input.replaceId)) throw new LearnMediaRefused('That saved section no longer exists.');
    const ref = libraryCol().doc(input.replaceId);
    return db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new LearnMediaRefused('That saved section no longer exists.');
      const before = snap.data() as LearnLibraryItem;
      const row: LearnLibraryItem = { name, section: v.section, createdAt: before.createdAt, createdBy: before.createdBy };
      tx.set(ref, row);
      return { row: { id: ref.id, ...row }, replaced: true };
    });
  }
  const ref = libraryCol().doc();
  const row: LearnLibraryItem = { name, section: v.section, createdAt: Date.now(), createdBy: input.actor };
  await ref.create(row);
  return { row: { id: ref.id, ...row }, replaced: false };
}

export async function renameLearnLibraryItem(id: string, nameInput: unknown): Promise<{ before: string; after: string }> {
  const name = cleanName(nameInput, MEDIA_LIMITS.libraryName);
  if (!name) throw new LearnMediaRefused(`Give the saved section a name of 1 to ${MEDIA_LIMITS.libraryName} characters.`);
  if (!isRowId(id)) throw new LearnMediaRefused('That saved section no longer exists.');
  const ref = libraryCol().doc(id);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new LearnMediaRefused('That saved section no longer exists.');
    const item = snap.data() as LearnLibraryItem;
    tx.set(ref, { name, section: item.section, createdAt: item.createdAt, createdBy: item.createdBy } satisfies LearnLibraryItem);
    return { before: item.name, after: name };
  });
}

/** Delete a saved section unless the draft, the live page or a kept version points at it. */
export async function deleteLearnLibraryItem(id: string): Promise<LearnLibraryRow> {
  if (!isRowId(id)) throw new LearnMediaRefused('That saved section no longer exists.');
  const sources = await loadSources();
  const found = sources.library.find((l) => l.id === id);
  // A saved section of the wrong shape can still be deleted, which is the way to clear it.
  if (found && typeof found.item.name !== 'string') found.item = { ...found.item, name: 'Untitled' };
  if (!found) throw new LearnMediaRefused('That saved section no longer exists.');
  const uses = libraryUses(id, sources);
  if (uses.length) throw new LearnMediaRefused(inUseMessage(`The saved section "${found.item.name}"`, uses));
  await libraryCol().doc(id).delete();
  return { id, ...found.item, uses: [] };
}
