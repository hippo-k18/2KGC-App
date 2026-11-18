import { NextResponse, type NextRequest } from 'next/server';
import { callerIpFromHeaders } from '@kgc/scripts/src/lib/rate-limit';
import { HONEYPOT_FIELD, REQUEST_MAX_BYTES, validateSubmission, type FieldName } from '@/lib/change-requests-core';
import { ScreenshotRejected, changeRequestAllowed, createChangeRequest } from '@/lib/change-requests';
import { recordError } from '@/lib/errors';
import { UploadUnavailable } from '@/lib/uploads';

/**
 * `POST /api/change-requests`: the public change request form (T428).
 *
 * No sign-in, on purpose (owner, 2026-11-18). It is a route handler rather
 * than a Server Action because three 5 MB screenshots do not fit the 1 MB
 * action body, and it is left out of the middleware's matcher, with the page,
 * so the middleware never buffers the upload.
 *
 * What stands in for a sign-in: the honeypot, a cap per sender address and
 * per IP, a same-origin check, a size cap before the body is read, and every
 * field checked again here whatever the page already said. Answers are JSON:
 * `{ ok: true }`, or `{ error, fields? }` with words the form shows.
 */

const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return json(403, { error: 'Not allowed.' });

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > REQUEST_MAX_BYTES) {
    return json(413, { error: 'That is too much to send at once. Attach up to 3 screenshots of 5 MB each.', fields: { screenshots: 'Each screenshot can be up to 5 MB.' } });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: 'Your request did not arrive whole. Try again.' });
  }

  const files = form.getAll('screenshots').filter((f): f is File => f instanceof File && f.size > 0);
  const checked = validateSubmission({
    email: form.get('email'),
    description: form.get('description'),
    pageUrl: form.get('pageUrl'),
    honeypot: form.get(HONEYPOT_FIELD),
    files,
  });

  // A filled honeypot is a bot. It is told it worked, so it learns nothing.
  if (checked.kind === 'trap') return json(200, { ok: true });
  if (checked.kind === 'invalid') {
    return json(400, { error: 'Check the fields marked below.', fields: checked.errors satisfies Partial<Record<FieldName, string>> });
  }

  if (!(await changeRequestAllowed(checked.value.email, callerIpFromHeaders(request.headers)))) {
    return json(429, { error: 'You have sent several requests in the last hour. Try again later, or email contact@knowledgegraph.tech.' });
  }

  try {
    await createChangeRequest(checked.value, files, callerIpFromHeaders(request.headers));
    return json(200, { ok: true });
  } catch (err) {
    if (err instanceof ScreenshotRejected) {
      return json(415, { error: err.message, fields: { screenshots: err.message } });
    }
    recordError(err instanceof UploadUnavailable ? 'change-requests.storage' : 'change-requests.create', err);
    return json(500, { error: 'Your request could not be saved just now. Try again in a minute.' });
  }
}
