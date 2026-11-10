/**
 * The speaker photo upload's rules (T379), with no Firestore or Storage in
 * them so they can be tested. The route is `app/api/speaker-photo/route.ts`.
 */
import type { AcceptedImageType } from './upload-limits';

/** What a speaker may send. The browser shrinks big photos first, so this is rarely reached. */
export const SPEAKER_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const SPEAKER_PHOTO_TYPES: readonly AcceptedImageType[] = ['image/jpeg', 'image/png', 'image/webp'];
export const SPEAKER_PHOTO_TYPE_MESSAGE = 'That file is not a JPEG, PNG or WebP image.';

/** Per speaker link and per address, each an hour and a day. */
export const SPEAKER_PHOTO_CAPS = { perSpeaker: [20, 60] as const, perIp: [40, 120] as const };

/**
 * The website pages allowed to send a photo here. The public site, and the
 * address `WEB_PUBLIC_ORIGIN` names when it is set (staging, a local check).
 */
export function allowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const out = new Set(['https://www.knowledgegraph.tech']);
  for (const raw of (env.WEB_PUBLIC_ORIGIN ?? '').split(',')) {
    try {
      if (raw.trim()) out.add(new URL(raw.trim()).origin);
    } catch {}
  }
  return [...out];
}

/** The `Access-Control-Allow-Origin` to send back, or null to send none. */
export function corsOrigin(origin: string | null, allowed: string[]): string | null {
  return origin && allowed.includes(origin) ? origin : null;
}

/**
 * Where the file goes. A new name every time, under the speaker's pending
 * folder: a photo already approved keeps its URL when the speaker tries
 * another, because replacing the object would change its download token.
 */
export function pendingPhotoTarget(speakerId: string, unique: string): { folder: string; name: string } | null {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(speakerId) || speakerId.includes('..')) return null;
  return { folder: `speakers/${speakerId}/pending`, name: `photo-${unique.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}` };
}

/**
 * Whether Speaker Manager shows a photo a speaker sent as a picture rather than
 * only as its address: one from our own bucket (what the upload returns), or
 * from the Storage emulator in a local run. A link to anywhere else stays text,
 * so opening the review does not fetch from a host the speaker chose.
 */
export function isPreviewablePhoto(url: string | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const u = url?.trim();
  if (!u) return false;
  if (/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\//.test(u)) return true;
  const emu = (env.FIREBASE_STORAGE_EMULATOR_HOST ?? env.STORAGE_EMULATOR_HOST)?.replace(/^https?:\/\//, '');
  return Boolean(emu && u.startsWith(`http://${emu}/v0/b/`));
}
