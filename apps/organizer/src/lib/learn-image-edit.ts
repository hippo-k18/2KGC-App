import 'server-only';

import { randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import { LEARN_PAGE_MEDIA, type LearnMediaItem, type PageImage } from '@kgc/shared';
import { db } from './firestore';
import { editedFileName, planLearnImageEdit, type LearnImageOp } from './learn-image-edit-core';
import { usingStorageEmulator } from './learn-page';
import { LEARN_LIMITS, isAllowedLearnImageSrc } from './learn-page-core';
import { UploadRejected, UploadUnavailable, storageBucketName } from './uploads';

/**
 * Crop, rotate, flip, resize or convert a Learn page image on the server (T316).
 *
 * The edited picture is always a new file with a new name: the original may be
 * on the published page or in an older version, and the page files are cached
 * as immutable for a year, so overwriting one would change it under readers who
 * would never see the change. The copy gets its own row in the media library.
 *
 * The plan (`learn-image-edit-core.ts`) is checked here again whatever the
 * browser already checked, because the sizes it measures against come from
 * the stored bytes, not from the client.
 */

type Sharp = typeof import('sharp');
type SharpImage = import('sharp').Sharp;
type RawInfo = { width: number; height: number; channels: 1 | 2 | 3 | 4 };

/** Same lazy load as `uploadLearnImage`, so a host without the binary refuses clearly. */
async function loadSharp(): Promise<Sharp | null> {
  try {
    const mod = (await import('sharp')) as unknown as { default?: Sharp } & Sharp;
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

const OUTPUT: Record<'jpeg' | 'png' | 'webp', { type: string; ext: string }> = {
  jpeg: { type: 'image/jpeg', ext: 'jpg' },
  png: { type: 'image/png', ext: 'png' },
  webp: { type: 'image/webp', ext: 'webp' },
};

/** The object path inside our bucket, or a refusal an organizer can act on. */
function objectPathFrom(src: string): string {
  if (src.startsWith('/kgc/')) {
    throw new UploadRejected(
      'That image is part of the website itself, so it cannot be edited here. Upload a copy, then edit the copy.',
    );
  }
  if (!isAllowedLearnImageSrc(src, { allowEmulator: usingStorageEmulator() })) {
    throw new UploadRejected('Only images uploaded to the Learn page can be edited.');
  }
  // The format was just checked, so this matches.
  const url = new URL(src);
  const match = /^\/v0\/b\/([a-z0-9._-]+)\/o\/([^/]+)$/.exec(url.pathname)!;
  if (match[1] !== storageBucketName()) {
    throw new UploadRejected('That image is stored somewhere else, so it cannot be edited here. Upload it again first.');
  }
  return decodeURIComponent(match[2]);
}

/**
 * Apply one op and hand back raw pixels.
 *
 * Each op is its own pipeline because `sharp` runs a pipeline's operations in
 * a fixed order of its own (rotate before extract, resize before either, one
 * rotate only), whatever order they were called in. A crop drawn after a
 * rotate would otherwise cut the wrong part of the picture. Raw pixels between
 * steps keep it lossless: only the final encode compresses.
 */
async function applyOp(sharp: Sharp, data: Buffer, info: RawInfo, op: LearnImageOp): Promise<{ data: Buffer; info: RawInfo }> {
  let img: SharpImage = sharp(data, { raw: info });
  switch (op.op) {
    case 'crop':
      img = img.extract({ left: op.x, top: op.y, width: op.width, height: op.height });
      break;
    case 'rotate':
      img = img.rotate(op.degrees);
      break;
    case 'flip':
      img = op.direction === 'vertical' ? img.flip() : img.flop();
      break;
    case 'resize':
      img = img.resize({ width: op.width });
      break;
  }
  return toRaw(img);
}

async function toRaw(img: SharpImage): Promise<{ data: Buffer; info: RawInfo }> {
  const out = await img.raw().toBuffer({ resolveWithObject: true });
  return {
    data: out.data,
    info: { width: out.info.width, height: out.info.height, channels: out.info.channels as RawInfo['channels'] },
  };
}

export async function editLearnImage(input: {
  src: string;
  edit: unknown;
  actor: string;
  alt?: string;
}): Promise<{ image: PageImage; mediaId: string; path: string; bytes: number }> {
  if (process.env.FIRESTORE_EMULATOR_HOST && !usingStorageEmulator()) {
    throw new UploadUnavailable(
      'Firestore is pointed at the emulator but Storage is not, so this edit would go to the live bucket. ' +
        'Set FIREBASE_STORAGE_EMULATOR_HOST.',
    );
  }
  const src = typeof input.src === 'string' ? input.src : '';
  const sourcePath = objectPathFrom(src);

  const sharp = await loadSharp();
  if (!sharp) throw new UploadUnavailable('Image processing is not installed on this server, so images cannot be edited. Tell the site admin.');

  db(); // initialises the Admin app, as `uploads.ts` does
  const bucket = getStorage().bucket(storageBucketName());
  let original: Buffer;
  try {
    [original] = await bucket.file(sourcePath).download();
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 404) {
      throw new UploadRejected('That image is no longer in storage. Upload it again, then edit the new copy.');
    }
    throw err;
  }
  if (original.length > LEARN_LIMITS.imageMaxBytes) {
    throw new UploadRejected('That image is too large to edit here. Upload a smaller copy first.');
  }

  let meta: import('sharp').Metadata;
  try {
    meta = await sharp(original, { animated: true }).metadata();
  } catch {
    throw new UploadRejected('That file could not be read as an image.');
  }
  if ((meta.pages ?? 1) > 1) {
    throw new UploadRejected('That GIF is animated. Editing it would keep only the first frame, so it has to be edited before upload.');
  }
  const sourceFormat = meta.format;
  if (sourceFormat !== 'jpeg' && sourceFormat !== 'png' && sourceFormat !== 'webp' && sourceFormat !== 'gif') {
    throw new UploadRejected('Only JPEG, PNG, WebP and GIF images can be edited.');
  }

  // Plan against the displayed size: EXIF orientations 5 to 8 swap the sides.
  const rotated = (meta.orientation ?? 1) >= 5;
  const w0 = meta.width ?? 0;
  const h0 = meta.height ?? 0;
  const plan = planLearnImageEdit(input.edit, rotated ? h0 : w0, rotated ? w0 : h0);
  if (!plan.ok) throw new UploadRejected(plan.error);

  // A non-animated GIF is saved as PNG: lossless, and sharp's GIF encoder
  // would quantise the colours again on every edit.
  const outFormat: keyof typeof OUTPUT =
    plan.format === 'webp' ? 'webp' : sourceFormat === 'gif' ? 'png' : sourceFormat;

  let step = await toRaw(sharp(original).rotate());
  for (const op of plan.ops) step = await applyOp(sharp, step.data, step.info, op);

  // Re-encoding from raw pixels is what drops EXIF, GPS and the rest.
  const encoder = sharp(step.data, { raw: step.info });
  const out = await (outFormat === 'webp' ? encoder.webp({ quality: 82 }) : encoder.toFormat(outFormat)).toBuffer();
  const after = await sharp(out).metadata();
  const width = after.width ?? plan.width;
  const height = after.height ?? plan.height;

  const { type: contentType, ext } = OUTPUT[outFormat];
  const path = `pageLayouts/learn/${randomUUID()}.${ext}`;
  const token = randomUUID();
  try {
    await bucket.file(path).save(out, {
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
  const newSrc = `${origin}/v0/b/${storageBucketName()}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  const alt = typeof input.alt === 'string' ? input.alt.slice(0, LEARN_LIMITS.alt) : '';
  const image: PageImage = { src: newSrc, alt, width, height };

  // Name the copy after the original's library row, or its file name when the
  // image was uploaded before the library existed.
  const media = db().collection(LEARN_PAGE_MEDIA);
  const prior = await media.where('image.src', '==', src).limit(1).get();
  const priorName = prior.empty ? undefined : (prior.docs[0].data() as Partial<LearnMediaItem>).fileName;
  const item: LearnMediaItem = {
    image,
    fileName: editedFileName(typeof priorName === 'string' ? priorName : sourcePath.split('/').pop(), ext),
    bytes: out.length,
    uploadedAt: Date.now(),
    uploadedBy: input.actor,
  };
  const row = await media.add(item);

  return { image, mediaId: row.id, path, bytes: out.length };
}
