import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { SHOT_CSP, SHOT_ROUTE_SOURCE, capKey } from './change-requests-core';
import { BodyTooLarge, declaredLength, handleUpload, readCapped, type UploadDeps } from './change-requests-upload';

/**
 * The upload route's order of checks (T430, gate T429 D1): a body is never
 * read for a capped IP or a request with no length, and never held past the
 * cap even when its length lies.
 */

const MB = 1024 * 1024;
const ORIGIN = 'https://dashboard.knowledgegraph.tech';

/** A body that makes its chunks only when asked, and counts what it handed out. */
function meteredBody(totalBytes: number, chunk = 64 * 1024) {
  const meter = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (meter.pulled >= totalBytes) return controller.close();
      const n = Math.min(chunk, totalBytes - meter.pulled);
      meter.pulled += n;
      controller.enqueue(new Uint8Array(n));
    },
  });
  return { stream, meter };
}

function deps(over: Partial<UploadDeps> = {}): UploadDeps {
  return {
    callerIp: '203.0.113.7',
    ipAllowed: vi.fn(async () => true),
    emailAllowed: vi.fn(async () => true),
    create: vi.fn(async () => 'id1234567890'),
    rejectedMessage: () => null,
    onError: () => {},
    ...over,
  };
}

function request(body: BodyInit | ReadableStream<Uint8Array> | null, headers: Record<string, string>) {
  return new Request(`${ORIGIN}/api/change-requests`, {
    method: 'POST',
    body,
    headers: { host: 'dashboard.knowledgegraph.tech', origin: ORIGIN, ...headers },
    // A stream body needs this in Node's fetch.
    duplex: 'half',
  } as RequestInit);
}

function formOf(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

/** A real multipart body with its type and length, as a browser sends it. */
async function encoded(fd: FormData) {
  const res = new Response(fd);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, type: res.headers.get('content-type')!, length: String(bytes.byteLength) };
}

describe('readCapped (T430)', () => {
  it('stops a chunked body just past the cap, never reading the rest', async () => {
    const { stream, meter } = meteredBody(400 * MB);
    await expect(readCapped(stream, 15 * MB)).rejects.toBeInstanceOf(BodyTooLarge);
    // At most the cap plus one chunk plus what the stream queued ahead.
    expect(meter.pulled).toBeLessThan(15 * MB + 256 * 1024);
  });

  it('returns a body under the cap whole', async () => {
    const { stream } = meteredBody(3 * MB);
    expect((await readCapped(stream, 15 * MB)).byteLength).toBe(3 * MB);
  });

  it('reads only whole numbers as a declared length', () => {
    expect(declaredLength('15728640')).toBe(15728640);
    expect(declaredLength(null)).toBeNull();
    expect(declaredLength('')).toBeNull();
    expect(declaredLength('-1')).toBeNull();
    expect(declaredLength('1e9')).toBeNull();
    expect(declaredLength('12, 12')).toBeNull();
  });
});

describe('handleUpload order (T430)', () => {
  it('refuses a chunked body with no length with 411, without reading it', async () => {
    const { stream, meter } = meteredBody(400 * MB);
    const d = deps();
    const a = await handleUpload(request(stream, { 'content-type': 'multipart/form-data; boundary=x' }), d);
    expect(a.status).toBe(411);
    expect(meter.pulled).toBeLessThanOrEqual(64 * 1024);
    expect(d.create).not.toHaveBeenCalled();
  });

  it('refuses a capped IP with 429 before reading a byte', async () => {
    const { stream, meter } = meteredBody(15 * MB);
    const d = deps({ ipAllowed: vi.fn(async () => false) });
    const a = await handleUpload(request(stream, { 'content-length': String(15 * MB), 'content-type': 'multipart/form-data; boundary=x' }), d);
    expect(a.status).toBe(429);
    expect(meter.pulled).toBeLessThanOrEqual(64 * 1024);
    expect(d.emailAllowed).not.toHaveBeenCalled();
  });

  it('refuses a declared length over the cap with 413, without reading it', async () => {
    const { stream, meter } = meteredBody(200 * MB);
    const a = await handleUpload(request(stream, { 'content-length': String(200 * MB), 'content-type': 'multipart/form-data; boundary=x' }), deps());
    expect(a.status).toBe(413);
    expect(meter.pulled).toBeLessThanOrEqual(64 * 1024);
  });

  it('stops a body longer than its declared length at the cap', async () => {
    const { stream, meter } = meteredBody(300 * MB);
    const a = await handleUpload(request(stream, { 'content-length': '1000', 'content-type': 'multipart/form-data; boundary=x' }), deps({ maxBytes: 2 * MB }));
    expect(a.status).toBe(413);
    expect(meter.pulled).toBeLessThan(2 * MB + 256 * 1024);
  });

  it('refuses another origin before anything else, even the IP count', async () => {
    const d = deps();
    const a = await handleUpload(request(null, { origin: 'https://evil.example', 'content-length': '0' }), d);
    expect(a.status).toBe(403);
    expect(d.ipAllowed).not.toHaveBeenCalled();
  });

  it('saves a real browser-shaped request, counting the IP first and the email after', async () => {
    const calls: string[] = [];
    const d = deps({
      ipAllowed: vi.fn(async () => (calls.push('ip'), true)),
      emailAllowed: vi.fn(async () => (calls.push('email'), true)),
      create: vi.fn(async () => (calls.push('create'), 'id1234567890')),
    });
    const body = await encoded(formOf({ email: 'ada@example.com', description: 'Fix the typo.', pageUrl: '', website: '' }));
    const a = await handleUpload(request(body.bytes, { 'content-type': body.type, 'content-length': body.length }), d);
    expect(a).toEqual({ status: 200, body: { ok: true } });
    expect(calls).toEqual(['ip', 'email', 'create']);
  });

  it('answers a filled honeypot with 200 and stores nothing', async () => {
    const d = deps();
    const body = await encoded(formOf({ email: 'bot@x.com', description: 'spam', website: 'http://spam' }));
    const a = await handleUpload(request(body.bytes, { 'content-type': body.type, 'content-length': body.length }), d);
    expect(a.status).toBe(200);
    expect(d.create).not.toHaveBeenCalled();
  });

  it('answers a capped sender with 429 after the fields are checked', async () => {
    const d = deps({ emailAllowed: vi.fn(async () => false) });
    const body = await encoded(formOf({ email: 'ada@example.com', description: 'again' }));
    const a = await handleUpload(request(body.bytes, { 'content-type': body.type, 'content-length': body.length }), d);
    expect(a.status).toBe(429);
    expect(d.create).not.toHaveBeenCalled();
  });
});

describe('plus-addressing and the per-email cap (T430)', () => {
  it('counts a+tag@y as a@y, case folded', () => {
    expect(capKey('Ada+1@Example.com')).toBe('ada@example.com');
    expect(capKey('ada+spam+more@example.com')).toBe('ada@example.com');
    expect(capKey('ada@example.com')).toBe('ada@example.com');
    expect(capKey('+x@example.com')).toBe('+x@example.com');
  });
});

describe('the screenshot CSP in next.config (T430)', () => {
  it('names the same path and policy as the route', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const config = readFileSync(path.join(here, '../../next.config.ts'), 'utf8');
    expect(config).toContain(`source: '${SHOT_ROUTE_SOURCE}'`);
    expect(config).toContain(`value: "${SHOT_CSP}"`);
    // After the global rule, so it is the one that wins.
    expect(config.indexOf(SHOT_ROUTE_SOURCE)).toBeGreaterThan(config.indexOf("source: '/:path*'"));
  });
});
