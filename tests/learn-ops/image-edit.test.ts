/**
 * Editing a Learn page image on the server (T316), against the Firestore and
 * Storage emulators: the edited copy is a new file, the original survives, the
 * ops run in the order the organizer made them, and a media row is written.
 *
 * Run with: npm run test:learn-ops
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LEARN_PAGE_MEDIA, type LearnMediaItem } from '@kgc/shared';
import { db } from '@/lib/firestore';
import { editLearnImage } from '@/lib/learn-image-edit';
import { uploadLearnImage } from '@/lib/learn-page';
import { isAllowedLearnImageSrc } from '@/lib/learn-page-core';
import { UploadRejected } from '@/lib/uploads';

// `sharp` is installed for the dashboard only, so load it from there.
const organizerRequire = createRequire(path.resolve(import.meta.dirname, '../../apps/organizer/package.json'));
const sharp = organizerRequire('sharp') as typeof import('sharp');
// Same for the Admin SDK: the app `db()` initialises lives in the dashboard's copy.
const { getStorage } = organizerRequire('firebase-admin/storage') as typeof import('firebase-admin/storage');

const ACTOR = 'editor@kgc.test';
const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };

const media = () => db().collection(LEARN_PAGE_MEDIA);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with: npm run test:learn-ops');
  if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Run with: npm run test:learn-ops');
});

beforeEach(async () => {
  await db().recursiveDelete(media());
});

function file(bytes: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** Left half red, right half blue, so a flip or rotate shows up in one pixel. */
async function twoColour(width: number, height: number, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const half = Math.floor(width / 2);
  const left = await sharp({ create: { width: half, height, channels: 3, background: RED } }).png().toBuffer();
  const right = await sharp({ create: { width: width - half, height, channels: 3, background: BLUE } }).png().toBuffer();
  const img = sharp({ create: { width, height, channels: 3, background: RED } }).composite([
    { input: left, left: 0, top: 0 },
    { input: right, left: half, top: 0 },
  ]);
  return format === 'png' ? img.png().toBuffer() : img.jpeg({ quality: 95 }).toBuffer();
}

async function fetchStored(src: string): Promise<{ type: string | null; bytes: Buffer }> {
  const res = await fetch(src);
  expect(res.status).toBe(200);
  return { type: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) };
}

/** RGB of one pixel of an encoded image. */
async function pixel(bytes: Buffer, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

function isRed(p: { r: number; g: number; b: number }) {
  return p.r > 200 && p.b < 60;
}
function isBlue(p: { r: number; g: number; b: number }) {
  return p.b > 200 && p.r < 60;
}

async function upload(bytes: Buffer, name: string, type: string) {
  return uploadLearnImage(file(bytes, name, type));
}

describe('editLearnImage', () => {
  it('rotates 400 x 200 to 200 x 400 into a new file and keeps the original', async () => {
    const up = await upload(await twoColour(400, 200), 'banner.png', 'image/png');
    const out = await editLearnImage({ src: up.image.src, edit: { ops: [{ op: 'rotate', degrees: 90 }] }, actor: ACTOR });

    expect(out.path).not.toBe(up.path);
    expect(out.path).toMatch(/^pageLayouts\/learn\/[0-9a-f-]+\.png$/);
    expect(out.image).toMatchObject({ width: 200, height: 400, alt: '' });
    expect(isAllowedLearnImageSrc(out.image.src, { allowEmulator: true })).toBe(true);

    const got = await fetchStored(out.image.src);
    expect(got.type).toBe('image/png');
    expect(got.bytes.length).toBe(out.bytes);
    const meta = await sharp(got.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([200, 400]);
    // Clockwise: the red left half ends up on top.
    expect(isRed(await pixel(got.bytes, 100, 50))).toBe(true);
    expect(isBlue(await pixel(got.bytes, 100, 350))).toBe(true);

    const originalBytes = (await fetchStored(up.image.src)).bytes;
    expect((await sharp(originalBytes).metadata()).width).toBe(400);
  });

  it('flips horizontally and vertically', async () => {
    const up = await upload(await twoColour(100, 50), 'flag.png', 'image/png');
    const h = await editLearnImage({ src: up.image.src, edit: { ops: [{ op: 'flip', direction: 'horizontal' }] }, actor: ACTOR });
    const hb = (await fetchStored(h.image.src)).bytes;
    expect(isBlue(await pixel(hb, 10, 25))).toBe(true);
    expect(isRed(await pixel(hb, 90, 25))).toBe(true);

    // A vertical flip of a left/right split changes nothing visible; rotate
    // first so it does: after 90 red is on top, after the flip it is at the bottom.
    const v = await editLearnImage({
      src: up.image.src,
      edit: { ops: [{ op: 'rotate', degrees: 90 }, { op: 'flip', direction: 'vertical' }] },
      actor: ACTOR,
    });
    const vb = (await fetchStored(v.image.src)).bytes;
    expect([v.image.width, v.image.height]).toEqual([50, 100]);
    expect(isBlue(await pixel(vb, 25, 10))).toBe(true);
    expect(isRed(await pixel(vb, 25, 90))).toBe(true);
  });

  it('honours the order: a crop then a rotate is not a rotate then a crop', async () => {
    const up = await upload(await twoColour(400, 200), 'order.png', 'image/png');
    // Crop the right (blue) 100 x 200 strip, then rotate: 200 x 100, all blue.
    const cropFirst = await editLearnImage({
      src: up.image.src,
      edit: { ops: [{ op: 'crop', x: 300, y: 0, width: 100, height: 200 }, { op: 'rotate', degrees: 90 }] },
      actor: ACTOR,
    });
    expect([cropFirst.image.width, cropFirst.image.height]).toEqual([200, 100]);
    const a = (await fetchStored(cropFirst.image.src)).bytes;
    expect(isBlue(await pixel(a, 10, 10))).toBe(true);
    expect(isBlue(await pixel(a, 190, 90))).toBe(true);

    // Rotate first (200 x 400, red on top), then crop the top 200 x 100: all red.
    const rotateFirst = await editLearnImage({
      src: up.image.src,
      edit: { ops: [{ op: 'rotate', degrees: 90 }, { op: 'crop', x: 0, y: 0, width: 200, height: 100 }] },
      actor: ACTOR,
    });
    expect([rotateFirst.image.width, rotateFirst.image.height]).toEqual([200, 100]);
    const b = (await fetchStored(rotateFirst.image.src)).bytes;
    expect(isRed(await pixel(b, 10, 10))).toBe(true);
    expect(isRed(await pixel(b, 190, 90))).toBe(true);
  });

  it('resizes and converts to WebP, dropping metadata', async () => {
    const jpeg = await sharp(await twoColour(800, 400, 'jpeg')).withMetadata({ orientation: 1 }).jpeg().toBuffer();
    const up = await upload(jpeg, 'photo.jpg', 'image/jpeg');
    const out = await editLearnImage({
      src: up.image.src,
      edit: { ops: [{ op: 'resize', width: 200 }], format: 'webp' },
      actor: ACTOR,
      alt: 'A red and blue flag',
    });
    expect(out.path).toMatch(/\.webp$/);
    expect(out.image).toMatchObject({ width: 200, height: 100, alt: 'A red and blue flag' });
    const got = await fetchStored(out.image.src);
    expect(got.type).toBe('image/webp');
    const meta = await sharp(got.bytes).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([200, 100]);
    expect(meta.exif).toBeUndefined();
  });

  it('keeps a JPEG a JPEG and plans on the EXIF-rotated size', async () => {
    // Stored 300 x 600 with orientation 6: shown as 600 x 300.
    const raw = await sharp({ create: { width: 300, height: 600, channels: 3, background: RED } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    // `uploadLearnImage` already applies EXIF, so write this one straight to
    // the bucket to prove the edit path reads an orientation tag too.
    const objectPath = `pageLayouts/learn/${randomUUID()}.jpg`;
    db();
    await getStorage()
      .bucket(process.env.FIREBASE_STORAGE_BUCKET!)
      .file(objectPath)
      .save(raw, { contentType: 'image/jpeg', metadata: { metadata: { firebaseStorageDownloadTokens: 'tok' } } });
    const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST!.replace(/^https?:\/\//, '');
    const up = {
      image: {
        src: `http://${host}/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=tok`,
      },
    };
    const out = await editLearnImage({
      src: up.image.src,
      edit: { ops: [{ op: 'crop', x: 0, y: 0, width: 600, height: 100 }] },
      actor: ACTOR,
    });
    expect(out.path).toMatch(/\.jpg$/);
    expect([out.image.width, out.image.height]).toEqual([600, 100]);
    expect((await fetchStored(out.image.src)).type).toBe('image/jpeg');
  });

  it('writes a media row named after the original row', async () => {
    const up = await upload(await twoColour(100, 100), 'team.png', 'image/png');
    await media().add({
      image: up.image,
      fileName: 'team photo.png',
      bytes: up.bytes,
      uploadedAt: 1,
      uploadedBy: 'someone@kgc.test',
    } satisfies LearnMediaItem);

    const out = await editLearnImage({ src: up.image.src, edit: { format: 'webp' }, actor: ACTOR });
    const row = await media().doc(out.mediaId).get();
    const data = row.data() as LearnMediaItem;
    expect(Object.keys(data).sort()).toEqual(['bytes', 'fileName', 'image', 'uploadedAt', 'uploadedBy']);
    expect(data).toMatchObject({ fileName: 'team photo (edited).webp', bytes: out.bytes, uploadedBy: ACTOR, image: out.image });
    expect(data.uploadedAt).toBeGreaterThan(1);
  });

  it('falls back to the stored file name when there is no media row', async () => {
    const up = await upload(await twoColour(100, 100), 'x.png', 'image/png');
    const out = await editLearnImage({ src: up.image.src, edit: { ops: [{ op: 'rotate', degrees: 180 }] }, actor: ACTOR });
    const data = (await media().doc(out.mediaId).get()).data() as LearnMediaItem;
    const base = up.path.split('/').pop()!.replace(/\.png$/, '');
    expect(data.fileName).toBe(`${base} (edited).png`);
  });

  it('saves a still GIF as PNG and refuses an animated one', async () => {
    const still = await sharp({ create: { width: 64, height: 32, channels: 3, background: BLUE } }).gif().toBuffer();
    const up = await upload(still, 'still.gif', 'image/gif');
    const out = await editLearnImage({ src: up.image.src, edit: { ops: [{ op: 'rotate', degrees: 90 }] }, actor: ACTOR });
    expect(out.path).toMatch(/\.png$/);
    expect([out.image.width, out.image.height]).toEqual([32, 64]);

    const frame = (bg: typeof RED) => sharp({ create: { width: 20, height: 20, channels: 3, background: bg } }).png().toBuffer();
    const animated = await sharp([await frame(RED), await frame(BLUE)], { join: { animated: true } })
      .gif({ delay: [100, 100] })
      .toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
    const anim = await upload(animated, 'anim.gif', 'image/gif');
    const err = await editLearnImage({ src: anim.image.src, edit: { format: 'webp' }, actor: ACTOR }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadRejected);
    expect((err as Error).message).toMatch(/animated/);
  });

  it('refuses a /kgc/ site image, another folder, another bucket and a missing file', async () => {
    const kgc = await editLearnImage({ src: '/kgc/learn/hero.jpg', edit: { format: 'webp' }, actor: ACTOR }).catch((e: unknown) => e);
    expect(kgc).toBeInstanceOf(UploadRejected);
    expect((kgc as Error).message).toMatch(/part of the website/);

    const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST!.replace(/^https?:\/\//, '');
    const bucket = process.env.FIREBASE_STORAGE_BUCKET!;
    const url = (b: string, p: string) => `http://${host}/v0/b/${b}/o/${encodeURIComponent(p)}?alt=media&token=t`;

    const foreign = await editLearnImage({ src: url(bucket, 'speakers/a.png'), edit: { format: 'webp' }, actor: ACTOR }).catch(
      (e: unknown) => e,
    );
    expect(foreign).toBeInstanceOf(UploadRejected);
    expect((foreign as Error).message).toMatch(/Only images uploaded to the Learn page/);

    const otherBucket = await editLearnImage({
      src: url('someone-else.appspot.com', 'pageLayouts/learn/a.png'),
      edit: { format: 'webp' },
      actor: ACTOR,
    }).catch((e: unknown) => e);
    expect(otherBucket).toBeInstanceOf(UploadRejected);
    expect((otherBucket as Error).message).toMatch(/stored somewhere else/);

    const missing = await editLearnImage({
      src: url(bucket, 'pageLayouts/learn/00000000-0000-0000-0000-000000000000.png'),
      edit: { format: 'webp' },
      actor: ACTOR,
    }).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(UploadRejected);
    expect((missing as Error).message).toMatch(/no longer in storage/);
  });

  it('refuses a bad edit with the planner message and writes nothing', async () => {
    const up = await upload(await twoColour(100, 100), 'small.png', 'image/png');
    const err = await editLearnImage({
      src: up.image.src,
      edit: { ops: [{ op: 'crop', x: 50, y: 0, width: 60, height: 10 }] },
      actor: ACTOR,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadRejected);
    expect((err as Error).message).toMatch(/outside the image/);
    expect((await media().count().get()).data().count).toBe(0);
  });
});
