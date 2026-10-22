import 'server-only';

import { randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import {
  COLLECTIONS,
  type LearnPageContent,
  type LearnPageDoc,
  type LearnPageVersion,
  type PageImage,
} from '@kgc/shared';
import { db } from './firestore';
import {
  LEARN_LIMITS,
  LEARN_VERSIONS_KEPT,
  LearnConflict,
  LearnUnreadable,
  effectiveDoc,
  fitWidth,
  hasUnpublishedChanges,
  isLearnVersionId,
  planPublish,
  planReplaceDraft,
  planSave,
  readStoredDoc,
  revertTarget,
  validateLearnContent,
  versionsToPrune,
  type LearnValidateOptions,
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

/**
 * What the validator needs to know about this server: whether the Storage
 * emulator's URLs count, and which bucket uploaded images must be in.
 */
export function learnValidateOptions(): LearnValidateOptions {
  return { allowEmulator: usingStorageEmulator(), bucket: storageBucketName() };
}

export async function listLearnVersions(limit = LEARN_VERSIONS_KEPT): Promise<LearnVersionSummary[]> {
  const snap = await versionsRef().orderBy('publishedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => {
    const v = d.data() as Partial<LearnPageVersion>;
    // Only the summary's own fields, typed: the history list renders them as text.
    const out: LearnVersionSummary = {
      id: d.id,
      publishedAt: typeof v.publishedAt === 'number' ? v.publishedAt : 0,
      publishedBy: typeof v.publishedBy === 'string' ? v.publishedBy : '',
    };
    if (typeof v.note === 'string' && v.note) out.note = v.note;
    return out;
  });
}

/**
 * The editor's starting state. Throws `LearnUnreadable` when the stored draft
 * does not pass the validator, so the page can offer to discard or restore
 * instead of failing with a 500.
 */
export async function loadLearnEditor(): Promise<LearnEditorState> {
  const [snap, versions] = await Promise.all([docRef().get(), listLearnVersions()]);
  const exists = snap.exists;
  const read = readStoredDoc(exists ? snap.data() : null, learnValidateOptions());
  if (!read.ok) throw new LearnUnreadable('This draft could not be read.', read.problems);
  const doc = read.doc;
  return { doc, exists, versions, hasUnpublishedChanges: hasUnpublishedChanges(doc, exists) };
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
      // The draft was validated when it was saved, but it may have been
      // written some other way since; www must only ever get validated content.
      const checked = validateLearnContent(base.draft, learnValidateOptions());
      if (!checked.ok) {
        throw new LearnUnreadable(
          'The saved draft has problems, so it cannot be published. Reload the page.',
          checked.problems,
        );
      }
      base = { ...base, draft: checked.content };
    }
    const { doc, version } = planPublish(base, input.actor, now, input.note);
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
    const next = planReplaceDraft(stored, revertTarget(stored, learnValidateOptions()), actor, Date.now());
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

/** A published version's content, validated, for the history preview. */
export async function loadLearnVersion(versionId: unknown): Promise<LearnPageContent> {
  if (!isLearnVersionId(versionId)) throw new LearnVersionMissing();
  const snap = await versionsRef().doc(versionId).get();
  if (!snap.exists) throw new LearnVersionMissing();
  return readVersionContent(snap.get('content'));
}

function readVersionContent(raw: unknown): LearnPageContent {
  const v = validateLearnContent(raw, learnValidateOptions());
  if (!v.ok) {
    throw new LearnUnreadable('That version could not be read, so it cannot be shown or restored. Pick another version.', v.problems);
  }
  return v.content;
}

/** Copy a published version into the draft. Not published until somebody presses Publish. */
export async function restoreLearnVersion(versionId: unknown, actor: string): Promise<LearnPageDoc> {
  if (!isLearnVersionId(versionId)) throw new LearnVersionMissing();
  return db().runTransaction(async (tx) => {
    const [snap, version] = await Promise.all([tx.get(docRef()), tx.get(versionsRef().doc(versionId))]);
    if (!version.exists) throw new LearnVersionMissing();
    const content = readVersionContent(version.get('content'));
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
async function loadSharp(): Promise<Sharp | null> {
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

  const emulator = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? process.env.STORAGE_EMULATOR_HOST)?.replace(/^https?:\/\//, '');
  const origin = emulator ? `http://${emulator}` : 'https://firebasestorage.googleapis.com';
  const src = `${origin}/v0/b/${storageBucketName()}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  return { image: { src, alt: '', width, height }, path, bytes: out.length, resized };
}
