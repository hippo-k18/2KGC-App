import 'server-only';

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Images uploaded in the editor: covers, pictures in a post, and profile photos.
 *
 * Kept on the server's disk, in `BLOG_MEDIA_DIR` (on the droplet,
 * `/opt/kgc/shared/blog-media`, outside the release folders so a deploy does
 * not lose them), and served by `app/blog-media/[file]/route.ts`. Named by the
 * hash of their bytes, so the same picture uploaded twice is stored once and a
 * name can be cached forever.
 *
 * The browser shrinks a photo before sending it (see `image-upload.ts`); this
 * side trusts none of that and checks the bytes are really an image.
 */

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

const TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
} as const;
export type MediaExt = keyof typeof TYPES;

export const mediaDir = () => process.env.BLOG_MEDIA_DIR || join(process.cwd(), '.blog-media');

/** What the first bytes say the file is, or null for anything that is not one of four image types. */
export function sniff(buf: Buffer): MediaExt | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'gif';
  return null;
}

export async function saveUpload(buf: Buffer): Promise<string> {
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error('That image is over 6 MB.');
  const ext = sniff(buf);
  if (!ext) throw new Error('Upload a JPEG, PNG, WebP or GIF.');
  const name = `${createHash('sha256').update(buf).digest('hex').slice(0, 32)}.${ext}`;
  await mkdir(mediaDir(), { recursive: true });
  await writeFile(join(mediaDir(), name), buf, { flag: 'w' });
  return `/blog-media/${name}`;
}

export async function readUpload(name: string): Promise<{ body: Buffer; type: string } | null> {
  const m = /^([a-f0-9]{32})\.(jpg|png|webp|gif)$/.exec(name);
  if (!m) return null;
  try {
    return { body: await readFile(join(mediaDir(), name)), type: TYPES[m[2] as MediaExt] };
  } catch {
    return null;
  }
}
