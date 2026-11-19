/**
 * `POST /api/change-requests` (T428), with its storage and limiter passed in
 * so the order of the checks can be tested. The route only wires it up.
 *
 * ── The order is the defence (T430, gate T429 D1) ───────────────────────────
 *
 * The route sits outside the middleware, which used to be what capped a body,
 * so this handler is the only thing between an anonymous sender and the
 * process's memory. Each step runs before anything costlier:
 *
 *   1. Same origin, from the headers.
 *   2. The per-IP allowance, from the headers. A capped IP is refused before
 *      a single byte of its body is read.
 *   3. A declared length, and one under the cap. No `Content-Length` (a
 *      chunked body) is refused with 411: every browser sends one for a
 *      FormData POST, HTTP/2 included.
 *   4. The body read through a counter that gives up past the cap, so a
 *      length that lies cannot buffer more than the cap either.
 *   5. Then the fields, the per-email allowance, and the magic bytes.
 */
import { HONEYPOT_FIELD, REQUEST_MAX_BYTES, validateSubmission, type CleanSubmission } from './change-requests-core';

export interface UploadDeps {
  callerIp: string | undefined;
  /** One request counted against this IP, or false when it is full. */
  ipAllowed: (ip: string | undefined) => Promise<boolean>;
  /** One request counted against this sender, or false when it is full. */
  emailAllowed: (email: string) => Promise<boolean>;
  create: (value: CleanSubmission, files: File[], ip: string | undefined) => Promise<string>;
  /** Maps a thrown error to a 415 message, or null for any other error. */
  rejectedMessage: (err: unknown) => string | null;
  onError: (err: unknown) => void;
  maxBytes?: number;
}

export type UploadAnswer = { status: number; body: Record<string, unknown> };

const TOO_BIG = {
  error: 'That is too much to send at once. Attach up to 3 screenshots of 5 MB each.',
  fields: { screenshots: 'Each screenshot can be up to 5 MB.' },
};

export class BodyTooLarge extends Error {}

/**
 * The body, read in full only while it stays under `max` bytes. Past that the
 * read is cancelled and `BodyTooLarge` is thrown, so at most `max` plus one
 * chunk is ever held. Pull-based: nothing is read ahead of what is counted.
 */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array(new ArrayBuffer(0));
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel('too large').catch(() => {});
      throw new BodyTooLarge(`body over ${max} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The declared length: a whole number of bytes, or null for none or nonsense. */
export function declaredLength(raw: string | null): number | null {
  if (raw == null || !/^\d{1,12}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

export function sameOrigin(headers: Headers): boolean {
  const origin = headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === headers.get('host');
  } catch {
    return false;
  }
}

export async function handleUpload(request: Request, deps: UploadDeps): Promise<UploadAnswer> {
  const max = deps.maxBytes ?? REQUEST_MAX_BYTES;
  if (!sameOrigin(request.headers)) return { status: 403, body: { error: 'Not allowed.' } };

  if (!(await deps.ipAllowed(deps.callerIp))) {
    return { status: 429, body: { error: 'Several requests have come from your network in the last hour. Try again later, or email contact@knowledgegraph.tech.' } };
  }

  const length = declaredLength(request.headers.get('content-length'));
  if (length === null) return { status: 411, body: { error: 'Your browser sent the request in a way we cannot accept. Try again, or use another browser.' } };
  if (length > max) return { status: 413, body: TOO_BIG };

  let form: FormData;
  try {
    const bytes = await readCapped(request.body, max);
    const type = request.headers.get('content-type') ?? '';
    form = await new Response(bytes, { headers: { 'content-type': type } }).formData();
  } catch (err) {
    if (err instanceof BodyTooLarge) return { status: 413, body: TOO_BIG };
    return { status: 400, body: { error: 'Your request did not arrive whole. Try again.' } };
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
  if (checked.kind === 'trap') return { status: 200, body: { ok: true } };
  if (checked.kind === 'invalid') return { status: 400, body: { error: 'Check the fields marked below.', fields: checked.errors } };

  if (!(await deps.emailAllowed(checked.value.email))) {
    return { status: 429, body: { error: 'You have sent several requests in the last hour. Try again later, or email contact@knowledgegraph.tech.' } };
  }

  try {
    await deps.create(checked.value, files, deps.callerIp);
    return { status: 200, body: { ok: true } };
  } catch (err) {
    const rejected = deps.rejectedMessage(err);
    if (rejected) return { status: 415, body: { error: rejected, fields: { screenshots: rejected } } };
    deps.onError(err);
    return { status: 500, body: { error: 'Your request could not be saved just now. Try again in a minute.' } };
  }
}
