import { describe, expect, it, vi } from 'vitest';
import { tickCaps, perHourAndDay } from '@kgc/scripts/src/lib/rate-limit';
import { changeRequestBuiltMessage, changeRequestLiveMessage, changeRequestPageLink } from '@kgc/scripts/src/lib/email';
import {
  CHANGE_REQUEST_CAPS,
  DESCRIPTION_MAX,
  SCREENSHOT_MAX_BYTES,
  contentTypeForPath,
  emailForTransition,
  isValidEmail,
  newCountLabel,
  normalisePageUrl,
  screenshotPath,
  screenshotType,
  validateSubmission,
} from './change-requests-core';
import { listAccess } from './change-requests-access';

const ok = { email: 'Ada@Example.com ', description: '  Fix the typo on the speakers page. ', pageUrl: '', honeypot: '', files: [] };

describe('change request validation (T428)', () => {
  it('accepts a plain request and cleans it', () => {
    expect(validateSubmission(ok)).toEqual({
      kind: 'ok',
      value: { email: 'ada@example.com', description: 'Fix the typo on the speakers page.' },
    });
  });

  it('requires an email and a description', () => {
    const r = validateSubmission({ ...ok, email: '', description: '   ' });
    expect(r.kind).toBe('invalid');
    if (r.kind === 'invalid') {
      expect(r.errors.email).toBe('Enter your email address.');
      expect(r.errors.description).toBe('Describe the change you would like.');
    }
  });

  it('refuses addresses that are not addresses', () => {
    for (const bad of ['ada', 'ada@', '@x.com', 'a b@x.com', 'ada@x', 'a@b.c', `${'a'.repeat(250)}@x.com`, 'a<b>@x.com']) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
    for (const good of ['ada@example.com', 'a.b+kgc@sub.example.co.uk']) expect(isValidEmail(good), good).toBe(true);
    expect(validateSubmission({ ...ok, email: 'nope' }).kind).toBe('invalid');
  });

  it('caps the description at 4000 characters', () => {
    expect(validateSubmission({ ...ok, description: 'x'.repeat(DESCRIPTION_MAX) }).kind).toBe('ok');
    const r = validateSubmission({ ...ok, description: 'x'.repeat(DESCRIPTION_MAX + 1) });
    expect(r.kind === 'invalid' && r.errors.description).toMatch(/under 4,000 characters/);
  });

  it('takes only http and https page links', () => {
    expect(normalisePageUrl('www.knowledgegraph.tech/speakers')).toBe('https://www.knowledgegraph.tech/speakers');
    expect(normalisePageUrl('javascript:alert(1)')).toBeNull();
    expect(normalisePageUrl('data:text/html,hi')).toBeNull();
    expect(normalisePageUrl('ftp://x.com/a')).toBeNull();
    expect(normalisePageUrl('localhost')).toBeNull();
    const r = validateSubmission({ ...ok, pageUrl: 'javascript:alert(1)' });
    expect(r.kind === 'invalid' && r.errors.pageUrl).toBeTruthy();
    const good = validateSubmission({ ...ok, pageUrl: 'https://www.knowledgegraph.tech/tickets' });
    expect(good.kind === 'ok' && good.value.pageUrl).toBe('https://www.knowledgegraph.tech/tickets');
  });

  it('takes up to three screenshots of up to 5 MB', () => {
    const f = (size: number) => ({ size });
    expect(validateSubmission({ ...ok, files: [f(1), f(2), f(SCREENSHOT_MAX_BYTES)] }).kind).toBe('ok');
    const four = validateSubmission({ ...ok, files: [f(1), f(1), f(1), f(1)] });
    expect(four.kind === 'invalid' && four.errors.screenshots).toBe('Attach up to 3 screenshots.');
    const big = validateSubmission({ ...ok, files: [f(SCREENSHOT_MAX_BYTES + 1)] });
    expect(big.kind === 'invalid' && big.errors.screenshots).toBe('Each screenshot can be up to 5 MB.');
    // An empty file input posts one zero-byte part; it is not a screenshot.
    expect(validateSubmission({ ...ok, files: [f(0)] }).kind).toBe('ok');
  });
});

describe('the honeypot (T428)', () => {
  it('turns a filled trap into a silent success, whatever else is wrong', () => {
    expect(validateSubmission({ ...ok, honeypot: 'http://spam.example' })).toEqual({ kind: 'trap' });
    expect(validateSubmission({ ...ok, email: '', honeypot: 'x' })).toEqual({ kind: 'trap' });
  });

  it('ignores a trap left empty or holding only spaces', () => {
    expect(validateSubmission({ ...ok, honeypot: '  ' }).kind).toBe('ok');
    expect(validateSubmission({ ...ok, honeypot: null }).kind).toBe('ok');
  });
});

describe('screenshot type by magic bytes (T428)', () => {
  const bytes = (...b: (number | string)[]) =>
    new Uint8Array(b.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])).concat(Array(16).fill(0)));
  const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
  const WEBP = bytes('RIFF', 0, 0, 0, 0, 'WEBP');

  it('reads PNG, JPEG and WebP from the bytes', () => {
    expect(screenshotType(PNG)).toBe('image/png');
    expect(screenshotType(JPEG)).toBe('image/jpeg');
    expect(screenshotType(WEBP)).toBe('image/webp');
  });

  it('refuses GIF, SVG, HTML and a PDF however they are named', () => {
    expect(screenshotType(bytes('GIF89a'))).toBeUndefined();
    expect(screenshotType(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeUndefined();
    expect(screenshotType(bytes('<!doctype html><script>'))).toBeUndefined();
    expect(screenshotType(bytes('%PDF-1.7'))).toBeUndefined();
    expect(screenshotType(new Uint8Array([0x89, 0x50]))).toBeUndefined();
  });

  it('stores under change-requests/{id}/ with the extension from the bytes, and serves only image types', () => {
    const path = screenshotPath('abcDEF1234567890wxyz', 0, 'image/jpeg');
    expect(path).toBe('change-requests/abcDEF1234567890wxyz/shot-1.jpg');
    expect(contentTypeForPath(path)).toBe('image/jpeg');
    expect(contentTypeForPath('change-requests/abcDEF1234567890wxyz/shot-2.webp')).toBe('image/webp');
    expect(contentTypeForPath('change-requests/abcDEF1234567890wxyz/shot-1.html')).toBeNull();
    expect(contentTypeForPath('speakers/x/photo.png')).toBeNull();
    expect(contentTypeForPath('change-requests/../secret/shot-1.png')).toBeNull();
    expect(() => screenshotPath('../x', 0, 'image/png')).toThrow();
  });
});

describe('the rate limit (T428)', () => {
  it('lets five through in an hour and refuses the sixth', () => {
    const caps = perHourAndDay(CHANGE_REQUEST_CAPS.perHour, CHANGE_REQUEST_CAPS.perDay);
    const t0 = new Date('2026-11-18T10:00:00Z');
    let doc = undefined as ReturnType<typeof tickCaps> | undefined;
    for (let i = 0; i < 5; i++) {
      doc = tickCaps(doc ?? undefined, 'change-request-ip', new Date(t0.getTime() + i * 60_000), caps);
      expect(doc, `request ${i + 1}`).not.toBeNull();
    }
    expect(tickCaps(doc!, 'change-request-ip', new Date(t0.getTime() + 10 * 60_000), caps)).toBeNull();
    // An hour later the hourly window has rolled over.
    expect(tickCaps(doc!, 'change-request-ip', new Date(t0.getTime() + 61 * 60_000), caps)).not.toBeNull();
  });
});

describe('status emails (T428)', () => {
  it('sends built and live once each, only on the move into them', () => {
    expect(emailForTransition('new', 'built', undefined)).toBe('built');
    expect(emailForTransition('building', 'built', {})).toBe('built');
    expect(emailForTransition('built', 'live', { built: 1 })).toBe('live');
    expect(emailForTransition('built', 'built', undefined)).toBeNull();
    expect(emailForTransition('building', 'built', { built: 1 })).toBeNull();
    expect(emailForTransition('built', 'live', { live: 1 })).toBeNull();
    expect(emailForTransition('new', 'building', undefined)).toBeNull();
    expect(emailForTransition('new', 'declined', undefined)).toBeNull();
    // Straight to live skips the built email: the sender hears it is live.
    expect(emailForTransition('new', 'live', undefined)).toBe('live');
  });

  it('says what the owner asked for, with no em dashes', () => {
    const built = changeRequestBuiltMessage({ description: 'Fix <b>this</b>' });
    expect(built.subject).toBe('Your change has been built and is being tested');
    expect(built.html).toContain('Fix &lt;b&gt;this&lt;/b&gt;');
    const live = changeRequestLiveMessage({ description: 'x', pageUrl: 'https://www.knowledgegraph.tech/speakers' });
    expect(live.subject).toBe('Your change is live');
    expect(live.html).toContain('href="https://www.knowledgegraph.tech/speakers"');
    expect(live.text).toContain('See the page: https://www.knowledgegraph.tech/speakers');
    for (const m of [built, live]) expect(`${m.subject}${m.text}`).not.toMatch(/—/);
  });

  it('links only pages on our own site', () => {
    expect(changeRequestPageLink('https://www.knowledgegraph.tech/a')).toBe('https://www.knowledgegraph.tech/a');
    expect(changeRequestPageLink('https://knowledgegraph.tech/')).toBe('https://knowledgegraph.tech/');
    expect(changeRequestPageLink('https://evil.example/knowledgegraph.tech')).toBeNull();
    expect(changeRequestPageLink('https://knowledgegraph.tech.evil.example/')).toBeNull();
    expect(changeRequestPageLink('http://www.knowledgegraph.tech/a')).toBeNull();
    const live = changeRequestLiveMessage({ description: 'x', pageUrl: 'https://evil.example/' });
    expect(live.html).not.toContain('evil.example');
    expect(live.text).not.toContain('evil.example');
  });
});

describe('who may open the list and the screenshots (T428)', () => {
  it('answers 401 signed out, 403 to a team role, 200 to an owner', () => {
    expect(listAccess(null)).toBe(401);
    for (const role of ['finance', 'agenda', 'sponsors', 'checkin', 'reviews', 'learn'] as const) {
      expect(listAccess([role]), role).toBe(403);
    }
    expect(listAccess(['owner'])).toBe(200);
  });

  it('labels the rail count', () => {
    expect(newCountLabel(0)).toBeUndefined();
    expect(newCountLabel(3)).toBe('3 new');
    expect(newCountLabel(250)).toBe('99+ new');
  });
});

/*
 * The store's half of "exactly once": the claim is written in the same
 * transaction as the status, so repeated moves into built send one email.
 * Firestore is a small in-memory fake; `send` is injected.
 */
const store = new Map<string, Record<string, unknown>>();
vi.mock('./firestore', () => ({
  db: () => ({
    collection: () => ({
      doc: (id: string) => ({ id }),
    }),
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>) =>
      fn({
        get: async (ref: { id: string }) => ({ exists: store.has(ref.id), data: () => store.get(ref.id) }),
        update: (ref: { id: string }, patch: Record<string, unknown>) => {
          const doc = { ...store.get(ref.id)! };
          for (const [k, v] of Object.entries(patch)) {
            if (k.includes('.')) {
              const [a, b] = k.split('.');
              doc[a] = { ...((doc[a] as object) ?? {}), [b]: v ?? true };
            } else doc[k] = v;
          }
          store.set(ref.id, doc);
        },
      }),
  }),
}));

describe('setChangeRequestStatus (T428)', () => {
  it('emails built once and live once across any number of moves', async () => {
    const { setChangeRequestStatus } = await import('./change-requests');
    store.set('req1234567890', { email: 'ada@example.com', description: 'Fix it', status: 'new', screenshots: [] });
    const built = vi.fn(async () => 'sent' as const);
    const live = vi.fn(async () => 'sent' as const);
    const send = { built, live };

    const moves = ['building', 'built', 'built', 'building', 'built', 'live', 'built', 'live'] as const;
    const results = [];
    for (const m of moves) results.push(await setChangeRequestStatus('req1234567890', m, 'owner@example.com', send));

    expect(built).toHaveBeenCalledTimes(1);
    expect(live).toHaveBeenCalledTimes(1);
    expect((built.mock.calls[0] as unknown[])[1]).toMatchObject({ to: 'ada@example.com', description: 'Fix it', actor: 'owner@example.com' });
    expect(results.filter((r) => r.email).map((r) => r.email)).toEqual([
      { kind: 'built', outcome: 'sent' },
      { kind: 'live', outcome: 'sent' },
    ]);
    expect(store.get('req1234567890')!.status).toBe('live');
  });

  it('keeps the status when the email fails, and does not try again', async () => {
    const { setChangeRequestStatus } = await import('./change-requests');
    store.set('req0987654321', { email: 'b@example.com', description: 'x', status: 'building', screenshots: [] });
    const built = vi.fn(async () => 'failed' as const);
    const send = { built, live: vi.fn(async () => 'sent' as const) };
    const first = await setChangeRequestStatus('req0987654321', 'built', 'o@example.com', send);
    expect(first).toEqual({ ok: true, email: { kind: 'built', outcome: 'failed' } });
    expect(store.get('req0987654321')!.status).toBe('built');
    await setChangeRequestStatus('req0987654321', 'building', 'o@example.com', send);
    await setChangeRequestStatus('req0987654321', 'built', 'o@example.com', send);
    expect(built).toHaveBeenCalledTimes(1);
  });

  it('refuses a request that does not exist', async () => {
    const { setChangeRequestStatus } = await import('./change-requests');
    const r = await setChangeRequestStatus('missing123456', 'built', 'o@example.com', { built: vi.fn(), live: vi.fn() });
    expect(r).toEqual({ ok: false, error: 'That request no longer exists.' });
  });
});
