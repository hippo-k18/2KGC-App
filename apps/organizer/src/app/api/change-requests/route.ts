import { NextResponse, type NextRequest } from 'next/server';
import { callerIpFromHeaders } from '@kgc/scripts/src/lib/rate-limit';
import { ScreenshotRejected, changeRequestEmailAllowed, changeRequestIpAllowed, createChangeRequest } from '@/lib/change-requests';
import { handleUpload } from '@/lib/change-requests-upload';
import { recordError } from '@/lib/errors';
import { UploadUnavailable } from '@/lib/uploads';

/**
 * `POST /api/change-requests`: the public change request form (T428).
 *
 * No sign-in, on purpose (owner, 2026-11-18). A route handler rather than a
 * Server Action because three 5 MB screenshots do not fit the 1 MB action
 * body, and left out of the middleware's matcher, with the page, so the
 * middleware never buffers the upload. That makes the checks in
 * `lib/change-requests-upload.ts` the only cap on the body; read its header
 * before reordering anything. Answers are JSON: `{ ok: true }`, or
 * `{ error, fields? }` with words the form shows.
 */
export async function POST(request: NextRequest) {
  const answer = await handleUpload(request, {
    callerIp: callerIpFromHeaders(request.headers),
    ipAllowed: changeRequestIpAllowed,
    emailAllowed: changeRequestEmailAllowed,
    create: createChangeRequest,
    rejectedMessage: (err) => (err instanceof ScreenshotRejected ? err.message : null),
    onError: (err) => recordError(err instanceof UploadUnavailable ? 'change-requests.storage' : 'change-requests.create', err),
  });
  return NextResponse.json(answer.body, {
    status: answer.status,
    // No `Connection: close` on a 411 or 413: closing while Apache is still
    // sending turns the answer into a 502 at Apache. Node discards the rest
    // of an unread body without holding it, so memory stays flat either way.
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
