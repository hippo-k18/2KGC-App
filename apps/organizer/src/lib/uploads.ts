import 'server-only';

import { randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import { db } from './firestore';
import { IMAGE_EXTENSIONS, MAX_UPLOAD_BYTES, type AcceptedImageType } from './upload-limits';

/**
 * The one path by which a file enters this project.
 *
 * ── Why this is server-side, and not the browser SDK ────────────────────────
 *
 * Every other Firebase product in this dashboard is reached with the Admin SDK,
 * which bypasses the security rules entirely — that is the whole security model
 * (`lib/firestore.ts`), and `storage.rules` says the same thing out loud by
 * setting `allow write: if false` on every organizer-owned prefix. A browser
 * upload would need those rules loosened, which would mean a second, weaker
 * authority over the same bytes, gated on a Firebase Auth identity the
 * dashboard does not even mint (it signs in with an email and a passphrase, not
 * a Firebase account). So the file travels inside the Server Action's FormData
 * and is written here, by the credential that already writes `exhibitors`.
 *
 * The consequence worth knowing: a Server Action body is capped at 1 MB by
 * default in Next 15. That is not a limitation to work around, it is the reason
 * the client component downsizes the image before it is ever submitted — see
 * `components/image-field.tsx`.
 *
 * ── The image-processing decision: downscale in the browser, store as-is here ─
 *
 * Three options were on the table (audit F §3.2.4). This takes the first:
 *
 *   1. Resize in the browser with a `<canvas>` before upload. Free, no infra,
 *      no dependency, and it produces the preview as a by-product.
 *   2. The Firebase "Resize Images" extension. Deploys a thirteenth Cloud
 *      Function, another image lineage in Artifact Registry — which is the one
 *      thing in this project that bills *at idle* — for a resize this product
 *      does once per logo.
 *   3. `sharp` in the Next server. A native binary, a platform-specific
 *      install, and a real risk on a serverless host; roughly 30 MB of
 *      node_modules to make a 200 KB logo into a 40 KB one.
 *
 * (2) and (3) both cost money or weight to solve a problem a conference does
 * not have: this is a few hundred logos and headshots, not a photo product. So
 * the server stores the bytes it is handed and does not re-encode them, and
 * everything it *does* do is the part a client cannot be trusted with —
 * checking the real magic bytes, capping the size, and choosing the path.
 *
 * If a genuine image pipeline is ever needed (thumbnails at three sizes, EXIF
 * stripping, HEIC), revisit (3) — but it is a decision, not a detail, because
 * `sharp` is the largest dependency in the tree the moment it lands.
 *
 * ── The bucket does not exist yet ───────────────────────────────────────────
 *
 * Verified 2026-08-30 by probing the anonymous GCS API: both
 * `kgc-conference-app-and-website.firebasestorage.app` and `…appspot.com`
 * return 404 "The specified bucket does not exist". The value in `.env.local`
 * is the SDK config string the Firebase console hands out, not evidence that
 * anything was provisioned. So the failure this code is most likely to hit in
 * its first year is a missing bucket, and it says so in words that name the fix
 * rather than surfacing a bare `404` from `@google-cloud/storage`.
 * `docs/storage-uploads.md` has the provisioning steps.
 */

/**
 * The limits themselves live in `upload-limits.ts`, because the file picker has
 * to know them too and cannot import a `server-only` module. Re-exported here so
 * a server call site has one import rather than two.
 */
export { ACCEPTED_IMAGE_TYPES, IMAGE_ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES } from './upload-limits';
export type { AcceptedImageType } from './upload-limits';

export interface UploadedImage {
  /** A stable, public download URL, safe to store on a document. */
  url: string;
  /** The object's path inside the bucket, e.g. `exhibitors/acme/logo.png`. */
  path: string;
  bytes: number;
  contentType: AcceptedImageType;
}

/**
 * Where an object lives. Split rather than one string so the folder can be
 * swept for the previous file when the format changes — see `uploadImage`.
 */
export interface UploadTarget {
  /** e.g. `exhibitors/acme-analytics`. No leading or trailing slash. */
  folder: string;
  /** e.g. `logo`. The extension is chosen from the bytes, never supplied. */
  name: string;
}

/** Thrown for anything an organizer can fix by choosing a different file. */
export class UploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRejected';
  }
}

/** Thrown when the storage backend itself is not usable yet. */
export class UploadUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadUnavailable';
  }
}

function projectId(): string {
  return process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website';
}

/**
 * The default bucket's name.
 *
 * Firebase projects created since October 2024 get `{project}.firebasestorage.app`
 * rather than the older `{project}.appspot.com`, and this one is that vintage.
 * `FIREBASE_STORAGE_BUCKET` overrides it so a second environment does not need
 * a code change — but note that the no-cost tier applies to the **default**
 * bucket only, so pointing this at a bucket you created by hand starts billing
 * from the first byte.
 */
export function storageBucketName(): string {
  return process.env.FIREBASE_STORAGE_BUCKET ?? `${projectId()}.firebasestorage.app`;
}

/** `localhost:9199` when the Storage emulator is running, otherwise undefined. */
function emulatorHost(): string | undefined {
  const raw = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? process.env.STORAGE_EMULATOR_HOST;
  return raw?.replace(/^https?:\/\//, '') || undefined;
}

/**
 * Refuse early, where a write cannot possibly land.
 *
 * Each of these otherwise fails deep inside `@google-cloud/storage` with an
 * error about credentials or a 404 on a URL nobody recognises, minutes after
 * the organizer picked the file.
 */
function assertStorageReachable(): void {
  if (process.env.FIRESTORE_EMULATOR_HOST && !emulatorHost()) {
    throw new UploadUnavailable(
      'Firestore is pointed at the emulator but Storage is not, so this upload would ' +
        'go to the live bucket with no credentials and fail. Start the Storage emulator ' +
        '(`firebase emulators:start`, port 9199 in firebase.json) and set ' +
        'FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199.',
    );
  }
}

/**
 * The message the owner will most likely see first, so it carries the fix.
 *
 * Kept as prose rather than a link because the two commands are exact and the
 * location choice inside step 1 is permanent.
 */
function bucketMissing(bucket: string): UploadUnavailable {
  return new UploadUnavailable(
    `The Firebase Storage bucket "${bucket}" does not exist, so there is nowhere to ` +
      'put this file. It has to be created once, by hand:\n' +
      '  1. Firebase console → Build → Storage → Get started. Choose location ' +
      'us-central1 — it matches the nam5 Firestore database and CANNOT be changed later.\n' +
      `  2. node scripts/ops/deploy-rules.mjs storage.rules firebase.storage/${bucket}\n` +
      'See docs/storage-uploads.md.',
  );
}

/** Firebase's own 404 wording, plus the GCS status code, plus the ADC case. */
function looksLikeMissingBucket(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 404) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /bucket does not exist|specified bucket|notFound/i.test(message);
}

/**
 * What the file really is, from its first bytes rather than its label.
 *
 * `File.type` is whatever the browser guessed from the extension and is
 * trivially spoofed. This decides the stored content type — which is also the
 * content type Firebase serves the object back with — so it must come from the
 * bytes.
 */
function sniffImageType(bytes: Uint8Array): AcceptedImageType | undefined {
  const at = (i: number) => bytes[i];
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));

  if (
    bytes.length > 8 &&
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length > 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (bytes.length > 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  if (bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

/** Rejects traversal and anything that would make a Firestore path unreadable. */
function assertSafeTarget(target: UploadTarget): void {
  const ok = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
  if (!ok.test(target.folder) || target.folder.includes('..') || target.folder.endsWith('/')) {
    throw new UploadRejected(`"${target.folder}" is not a usable storage folder.`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(target.name)) {
    throw new UploadRejected(`"${target.name}" is not a usable file name.`);
  }
}

function bucket() {
  // `db()` is the only place in this app that calls `initializeApp`, and the
  // Admin SDK needs an app before it will hand over a Storage client. Calling
  // it for its side effect is cheaper and less brittle than a second
  // initialisation path that could disagree with the first about credentials.
  db();
  return getStorage().bucket(storageBucketName());
}

/**
 * A download URL that keeps working, and that the rest of the system recognises.
 *
 * Not `makePublic()` + `storage.googleapis.com`: a bucket with uniform
 * bucket-level access — the default for new buckets — rejects per-object ACLs
 * outright. Not a signed URL either: those expire, and this string is written
 * onto a Firestore document that outlives any expiry worth setting.
 *
 * The download token is the same mechanism `getDownloadURL()` uses in the
 * client SDK, which is what makes the resulting host `firebasestorage.googleapis.com`
 * — and *that* matters beyond aesthetics. `firestore.rules`' `isFirebaseStorageUrl()`
 * and `mirror-directory.ts`'s copy of the same check both require exactly that
 * host, so a URL built any other way would be silently dropped from the
 * attendee directory. Revoking access later means clearing the token, which
 * invalidates the URL without deleting the object.
 */
function downloadUrl(path: string, token: string): string {
  const encoded = encodeURIComponent(path);
  const emulator = emulatorHost();
  const origin = emulator ? `http://${emulator}` : 'https://firebasestorage.googleapis.com';
  return `${origin}/v0/b/${storageBucketName()}/o/${encoded}?alt=media&token=${token}`;
}

/**
 * Store one image and return a URL that can be written onto a document.
 *
 * The path is deterministic — `{folder}/{name}.{ext}` — so re-uploading
 * replaces rather than accumulates. The one case that would still accumulate is
 * a format change (`logo.png` → `logo.webp`), so siblings sharing the base name
 * are swept afterwards. That sweep is best-effort: an orphaned object costs a
 * few kilobytes, and failing the whole save because a *previous* file could not
 * be deleted would be the worse trade.
 */
export async function uploadImage(file: File, target: UploadTarget): Promise<UploadedImage> {
  assertSafeTarget(target);
  assertStorageReachable();

  if (file.size === 0) throw new UploadRejected('That file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadRejected(
      `That image is ${Math.round(file.size / 1024)} KB. The limit is ` +
        `${Math.round(MAX_UPLOAD_BYTES / 1024)} KB — pick a smaller one, or let the ` +
        'picker resize it for you.',
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    throw new UploadRejected(
      'That file is not a PNG, JPEG, WebP or GIF image. (SVG is not accepted: it can ' +
        'carry scripts.)',
    );
  }

  const extension = IMAGE_EXTENSIONS[contentType];
  const path = `${target.folder}/${target.name}.${extension}`;
  const token = randomUUID();
  const b = bucket();

  try {
    await b.file(path).save(Buffer.from(bytes), {
      contentType,
      metadata: {
        // Long, because the URL changes whenever the object does: the path is
        // stable but a replacement mints a new token, so a stale cache can
        // never show yesterday's logo.
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
  } catch (err) {
    if (looksLikeMissingBucket(err)) throw bucketMissing(storageBucketName());
    throw err;
  }

  try {
    const [siblings] = await b.getFiles({ prefix: `${target.folder}/${target.name}.` });
    await Promise.all(siblings.filter((f) => f.name !== path).map((f) => f.delete()));
  } catch {
    // See the docblock: an orphan is cheaper than a failed save.
  }

  return { url: downloadUrl(path, token), path, bytes: bytes.length, contentType };
}

/**
 * Delete every stored format of one image, for "remove this logo".
 *
 * Deliberately tolerant of a bucket that does not exist: the caller is clearing
 * a field, and refusing to do so because there is nothing to delete would be
 * absurd.
 */
export async function removeImage(target: UploadTarget): Promise<void> {
  assertSafeTarget(target);

  try {
    const [files] = await bucket().getFiles({ prefix: `${target.folder}/${target.name}.` });
    await Promise.all(files.map((f) => f.delete()));
  } catch (err) {
    if (looksLikeMissingBucket(err)) return;
    throw err;
  }
}

/** True for a URL this project produced, as opposed to one somebody pasted. */
export function isUploadedImageUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && hostname === 'firebasestorage.googleapis.com';
  } catch {
    return false;
  }
}
