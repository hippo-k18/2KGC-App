import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { callerIpFromHeaders } from '@kgc/scripts/src/lib/rate-limit';
import { recordError } from '@/lib/errors';
import { photoUploadAllowed, speakerForPhotoUpload } from '@/lib/speaker-photo';
import {
  allowedOrigins,
  corsOrigin,
  pendingPhotoTarget,
  SPEAKER_PHOTO_MAX_BYTES,
  SPEAKER_PHOTO_TYPE_MESSAGE,
  SPEAKER_PHOTO_TYPES,
} from '@/lib/speaker-photo-core';
import { UploadRejected, uploadImage } from '@/lib/uploads';

/**
 * `POST /api/speaker-photo` — a speaker's headshot from their profile link on
 * the website (T379).
 *
 * ── Why the website posts here ──────────────────────────────────────────────
 *
 * `lib/uploads.ts` is the one writer for the storage bucket, and the website
 * holds no credential for it on purpose (see `/speaker/{token}`'s header). So
 * the speaker's browser sends the file here, across origins, with the token
 * from their link. That token is the only authority: it is checked exactly as
 * the website checks it before a save, and the speaker it names decides the
 * folder. Nothing in the request can choose a path.
 *
 * ── Nothing is published here ───────────────────────────────────────────────
 *
 * The file lands in `speakers/{id}/pending/` and its URL goes back to the
 * page, which puts it in the photo box. It reaches the speaker's record only
 * when they press Send and an organizer approves the profile on Speaker
 * Manager, which is the path every other field takes. Until then the URL is
 * written down nowhere but the speaker's own form.
 *
 * Answers are JSON, `{ url }` or `{ error }` with a sentence to show.
 */

function withCors(request: NextRequest, res: NextResponse): NextResponse {
  const origin = corsOrigin(request.headers.get('origin'), allowedOrigins());
  if (origin) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
  }
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

const fail = (request: NextRequest, status: number, error: string) =>
  withCors(request, NextResponse.json({ error }, { status }));

export function OPTIONS(request: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  res.headers.set('Access-Control-Allow-Methods', 'POST');
  res.headers.set('Access-Control-Max-Age', '600');
  return withCors(request, res);
}

export async function POST(request: NextRequest) {
  // A browser on another site can still post a form here; it just cannot read
  // the answer. The token is what stops it, and this stops it earlier.
  const origin = request.headers.get('origin');
  if (origin && !corsOrigin(origin, allowedOrigins())) return fail(request, 403, 'Not allowed.');

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > SPEAKER_PHOTO_MAX_BYTES + 64 * 1024) {
    return fail(request, 413, 'That image is over 10 MB. Pick a smaller one.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(request, 400, 'That upload did not arrive whole. Try again.');
  }

  const speakerId = await speakerForPhotoUpload(String(form.get('token') ?? ''));
  if (!speakerId) return fail(request, 404, 'This link no longer works. Email us the photo instead.');

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return fail(request, 400, 'Choose a photo first.');
  if (file.size > SPEAKER_PHOTO_MAX_BYTES) return fail(request, 413, 'That image is over 10 MB. Pick a smaller one.');

  if (!(await photoUploadAllowed(speakerId, callerIpFromHeaders(request.headers)))) {
    return fail(request, 429, 'Too many photos from this link for now. Try again in an hour.');
  }

  const target = pendingPhotoTarget(speakerId, randomUUID());
  if (!target) return fail(request, 404, 'This link no longer works. Email us the photo instead.');

  try {
    const uploaded = await uploadImage(file, target, {
      maxBytes: SPEAKER_PHOTO_MAX_BYTES,
      types: SPEAKER_PHOTO_TYPES,
      typeMessage: SPEAKER_PHOTO_TYPE_MESSAGE,
    });
    return withCors(request, NextResponse.json({ url: uploaded.url }));
  } catch (err) {
    // Size and emptiness are checked above, so what is left is the file's type.
    if (err instanceof UploadRejected) return fail(request, 415, err.message);
    recordError('speaker-photo', err);
    return fail(request, 500, 'That photo did not upload. Try again, or email it to us.');
  }
}
