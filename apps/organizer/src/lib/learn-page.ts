import 'server-only';

import { randomUUID } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  COLLECTIONS,
  LEARN_PAGE_LIBRARY,
  expandReusableBlocks,
  type LearnLibraryItem,
  type LearnPageContent,
  type LearnPageDoc,
  type LearnPageVersion,
  type LearnSection,
  type PageImage,
} from '@kgc/shared';
import { db } from './firestore';
import {
  LEARN_LIMITS,
  LEARN_VERSIONS_KEPT,
  LearnConflict,
  effectiveDoc,
  fitWidth,
  hasUnpublishedChanges,
  planPublish,
  planReplaceDraft,
  planSave,
  revertTarget,
  validateLearnContent,
  versionsToPrune,
} from './learn-page-core';
import { UploadRejected, UploadUnavailable, storageBucketName } from './uploads';

/**
 * `pageLayouts/learn`: the KGC | Learn page as data (T309).
 *
 * One document holds the draft the editor writes and the published copy www
 * renders; `versions` keeps each publish, newest 50. Every decision is in
 * `learn-page-core.ts`; this file only reads, writes and stores images.
 *
 * Every write here is a whole-document `set` inside a transaction, never a
 * `merge`, so there is no field an organizer can clear and find still there
 * (AGENTS.md gotcha 9): the stored document is exactly what `planSave` and
 * friends built.
 */

export interface LearnVersionSummary {
  id: string;
  publishedAt: number;
  publishedBy: string;
  note?: string;
}

export interface LearnEditorState {
  doc: LearnPageDoc;
  exists: boolean;
  versions: LearnVersionSummary[];
  hasUnpublishedChanges: boolean;
}

function docRef() {
  return db().collection(COLLECTIONS.pageLayouts).doc('learn');
}

function versionsRef() {
  return docRef().collection('versions');
}

/** True when uploads go to a local Storage emulator, so its URLs validate. */
export function usingStorageEmulator(): boolean {
  return Boolean(process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? process.env.STORAGE_EMULATOR_HOST);
}

export async function listLearnVersions(limit = LEARN_VERSIONS_KEPT): Promise<LearnVersionSummary[]> {
  const snap = await versionsRef().orderBy('publishedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => {
    const v = d.data() as LearnPageVersion;
    const out: LearnVersionSummary = { id: d.id, publishedAt: v.publishedAt, publishedBy: v.publishedBy };
    if (v.note) out.note = v.note;
    return out;
  });
}

/** Saved sections by id. Read inside a transaction when `tx` is given. */
export async function loadLearnLibrarySections(tx?: Transaction): Promise<Map<string, LearnSection>> {
  const q = db().collection(LEARN_PAGE_LIBRARY);
  const snap = tx ? await tx.get(q) : await q.get();
  return new Map(snap.docs.map((d) => [d.id, (d.data() as LearnLibraryItem).section]));
}

export async function loadLearnEditor(): Promise<LearnEditorState> {
  const [snap, versions, library] = await Promise.all([docRef().get(), listLearnVersions(), loadLearnLibrarySections()]);
  const exists = snap.exists;
  const doc = effectiveDoc(exists ? (snap.data() as LearnPageDoc) : null);
  // The live copy holds saved sections expanded, so the draft is compared the same way:
  // a reusable block is not an unpublished change, and an edit to its saved section is.
  const asPublished = { ...doc, draft: expandReusableBlocks(doc.draft, library) };
  return { doc, exists, versions, hasUnpublishedChanges: hasUnpublishedChanges(asPublished, exists) };
}

/** Publishing would put a page on www that does not pass validation (a saved section changed under it). */
export class LearnPublishInvalid extends Error {
  constructor(readonly problems: string[]) {
    super('The page with its saved sections filled in does not pass the checks, so it was not published.');
    this.name = 'LearnPublishInvalid';
  }
}

/** Save a validated draft. Throws `LearnConflict` on a stale `baseRevision`. */
export async function saveLearnDraft(
  content: LearnPageContent,
  baseRevision: number,
  actor: string,
): Promise<LearnPageDoc> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(docRef());
    const next = planSave(snap.exists ? (snap.data() as LearnPageDoc) : null, content, baseRevision, actor, Date.now());
    tx.set(docRef(), next);
    return next;
  });
}

/**
 * Publish the draft, optionally saving `content` into it first in the same
 * transaction. The revision check applies either way: publishing what you were
 * not looking at is the conflict this exists to stop.
 */
export async function publishLearnPage(input: {
  baseRevision: number;
  content?: LearnPageContent;
  note?: string;
  actor: string;
}): Promise<{ doc: LearnPageDoc; versionId: string; pruned: number }> {
  const versionRef = versionsRef().doc();
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(docRef());
    const stored = snap.exists ? (snap.data() as LearnPageDoc) : null;
    const now = Date.now();
    let base: LearnPageDoc;
    if (input.content) {
      base = planSave(stored, input.content, input.baseRevision, input.actor, now);
    } else {
      base = effectiveDoc(stored);
      if (base.revision !== input.baseRevision) throw new LearnConflict(base.revision);
    }
    // Saved sections are expanded into the live copy and the kept version, so www
    // and Restore never depend on the library (`learn-reusable-core.ts`). The
    // expanded page is checked again: a saved section can be older than today's rules.
    const expanded = expandReusableBlocks(base.draft, await loadLearnLibrarySections(tx));
    const check = validateLearnContent(expanded, { allowEmulator: usingStorageEmulator() });
    if (!check.ok) throw new LearnPublishInvalid(check.problems);
    const planned = planPublish(base, input.actor, now, input.note);
    const doc: LearnPageDoc = { ...planned.doc, published: check.content };
    const version = { ...planned.version, content: check.content };
    tx.set(docRef(), doc);
    tx.set(versionRef, version);
    return doc;
  });

  // Outside the transaction: pruning is housekeeping, and a failure here must
  // not undo a publish that already reached www.
  let pruned = 0;
  try {
    const snap = await versionsRef().orderBy('publishedAt', 'desc').select().get();
    const ids = versionsToPrune(snap.docs.map((d) => ({ id: d.id })));
    await Promise.all(ids.map((id) => versionsRef().doc(id).delete()));
    pruned = ids.length;
  } catch {
    // An extra old version costs a few kilobytes.
  }
  return { doc: result, versionId: versionRef.id, pruned };
}

/** Throw the draft away: back to the published copy, or the default page. */
export async function revertLearnDraft(actor: string): Promise<LearnPageDoc> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(docRef());
    const stored = snap.exists ? (snap.data() as LearnPageDoc) : null;
    const next = planReplaceDraft(stored, revertTarget(stored), actor, Date.now());
    tx.set(docRef(), next);
    return next;
  });
}

export class LearnVersionMissing extends Error {
  constructor() {
    super('That version no longer exists. Only the last 50 published versions are kept.');
    this.name = 'LearnVersionMissing';
  }
}

/** Copy a published version into the draft. Not published until somebody presses Publish. */
export async function restoreLearnVersion(versionId: string, actor: string): Promise<LearnPageDoc> {
  if (!/^[A-Za-z0-9]{1,64}$/.test(versionId)) throw new LearnVersionMissing();
  return db().runTransaction(async (tx) => {
    const [snap, version] = await Promise.all([tx.get(docRef()), tx.get(versionsRef().doc(versionId))]);
    if (!version.exists) throw new LearnVersionMissing();
    const content = (version.data() as LearnPageVersion).content;
    const next = planReplaceDraft(snap.exists ? (snap.data() as LearnPageDoc) : null, content, actor, Date.now());
    tx.set(docRef(), next);
    return next;
  });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

type Sharp = typeof import('sharp');

/**
 * `sharp`, loaded lazily. It arrives with Next (the image optimiser's own
 * dependency) and is pinned in `package.json`. It is a native binary, so a
 * host where it failed to install gets a clear refusal rather than a crash:
 * without it the server cannot read an image's real size or format, and
 * storing bytes it cannot check is the thing `uploads.ts` exists to avoid.
 */
export async function loadSharp(): Promise<Sharp | null> {
  try {
    const mod = (await import('sharp')) as unknown as { default?: Sharp } & Sharp;
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

const FORMATS: Record<string, { type: string; ext: string }> = {
  jpeg: { type: 'image/jpeg', ext: 'jpg' },
  png: { type: 'image/png', ext: 'png' },
  webp: { type: 'image/webp', ext: 'webp' },
  gif: { type: 'image/gif', ext: 'gif' },
};

/**
 * Store one image for the Learn page and return it as a `PageImage`.
 *
 * Unlike the logo pickers, this accepts up to 10 MB, because a course page
 * wants full-width photographs and the editor sends the original. The server
 * reads the real pixel size from the bytes (never from the client), and with
 * `sharp` present it rotates by EXIF, strips metadata (a phone photo's GPS
 * position should not end up on www) and, past 2400 px wide, stores a resized
 * WebP. GIFs are stored as they are so an animation survives.
 *
 * Every upload gets its own random name under `pageLayouts/learn/`, so an image
 * still used by an older version or by the published page is never
 * overwritten by a new one.
 */
export async function uploadLearnImage(file: File): Promise<{ image: PageImage; path: string; bytes: number; resized: boolean }> {
  if (process.env.FIRESTORE_EMULATOR_HOST && !usingStorageEmulator()) {
    throw new UploadUnavailable(
      'Firestore is pointed at the emulator but Storage is not, so this upload would go to the live bucket. ' +
        'Set FIREBASE_STORAGE_EMULATOR_HOST.',
    );
  }
  if (!(file instanceof File) || file.size === 0) throw new UploadRejected('Choose an image file.');
  if (file.size > LEARN_LIMITS.imageMaxBytes) {
    throw new UploadRejected(
      `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${LEARN_LIMITS.imageMaxBytes / 1024 / 1024} MB.`,
    );
  }

  const input = Buffer.from(await file.arrayBuffer());
  const sharp = await loadSharp();
  if (!sharp) throw new UploadUnavailable('Image processing is not installed on this server, so images cannot be checked. Tell the site admin.');

  let meta: import('sharp').Metadata;
  try {
    meta = await sharp(input, { animated: true }).metadata();
  } catch {
    throw new UploadRejected('That file is not an image this page can show. Use JPEG, PNG, WebP or GIF.');
  }
  const format = meta.format && FORMATS[meta.format];
  if (!format) {
    throw new UploadRejected('That file is not a JPEG, PNG, WebP or GIF image. (SVG is not accepted: it can carry scripts.)');
  }

  let out: Buffer = input;
  let contentType = format.type;
  let ext = format.ext;
  // The displayed size: EXIF orientations 5 to 8 swap width and height.
  // An animated GIF reports every frame stacked; `pageHeight` is one frame.
  const rotated = (meta.orientation ?? 1) >= 5;
  const w0 = meta.width ?? 0;
  const h0 = meta.pageHeight ?? meta.height ?? 0;
  let width = rotated ? h0 : w0;
  let height = rotated ? w0 : h0;
  let resized = false;

  if (format.ext !== 'gif') {
    const fit = fitWidth(width, height, LEARN_LIMITS.imageMaxWidth);
    resized = fit.width !== width;
    const pipeline = sharp(input).rotate();
    if (resized) {
      out = await pipeline.resize({ width: fit.width }).webp({ quality: 82 }).toBuffer();
      contentType = 'image/webp';
      ext = 'webp';
    } else {
      // Re-encoded in its own format: this is what drops the EXIF block.
      out = await pipeline.toFormat(meta.format as 'jpeg' | 'png' | 'webp').toBuffer();
    }
    const after = await sharp(out).metadata();
    width = after.width ?? fit.width;
    height = after.height ?? fit.height;
  }
  if (!width || !height) throw new UploadRejected('Could not read the size of that image.');

  const path = `pageLayouts/learn/${randomUUID()}.${ext}`;
  const token = randomUUID();
  db(); // initialises the Admin app, as `uploads.ts` does
  try {
    await getStorage()
      .bucket(storageBucketName())
      .file(path)
      .save(out, {
        contentType,
        metadata: {
          cacheControl: 'public, max-age=31536000, immutable',
          metadata: { firebaseStorageDownloadTokens: token },
        },
      });
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 404) throw new UploadUnavailable(`The Storage bucket "${storageBucketName()}" does not exist.`);
    throw err;
  }

  return { image: { src: learnImageUrl(path, token), alt: '', width, height }, path, bytes: out.length, resized };
}

/** The token URL www renders a stored image through. */
export function learnImageUrl(path: string, token: string): string {
  const emulator = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? process.env.STORAGE_EMULATOR_HOST)?.replace(/^https?:\/\//, '');
  const origin = emulator ? `http://${emulator}` : 'https://firebasestorage.googleapis.com';
  return `${origin}/v0/b/${storageBucketName()}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}
