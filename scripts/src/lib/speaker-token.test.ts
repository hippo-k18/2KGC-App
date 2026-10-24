import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mintConsentToken } from './consent-token.js';
import { mintSubmissionToken } from './submission-token.js';
import { mintSpeakerToken, readSpeakerToken, SPEAKER_TOKEN_TTL_MS } from './speaker-token.js';

/**
 * The capability link a speaker holds instead of an account.
 *
 * Written as the forgeries somebody would actually attempt rather than as
 * coverage of the happy path, for the reason `submission-token.test.ts` gives:
 * a token that verifies when it should not is silent everywhere, and here it
 * would let one speaker rewrite another's profile.
 *
 * ⚠️ `sid` is also `submission-token.ts`'s field name, and both families fall
 * back to the same secret, so the replay tests below are the load-bearing ones.
 */

const SECRET = 'test-speaker-secret-not-a-real-one';

/** Save and restore rather than assign, so one test cannot leak into the next. */
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string | undefined) => {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

beforeEach(() => {
  setEnv('WEB_SPEAKER_SECRET', SECRET);
  setEnv('WEB_ORDER_SECRET', undefined);
});

afterEach(() => {
  vi.useRealTimers();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const bodyOf = (token: string) => token.slice(0, token.lastIndexOf('.'));
const sigOf = (token: string) => token.slice(token.lastIndexOf('.') + 1);
const decode = (token: string) =>
  JSON.parse(Buffer.from(bodyOf(token), 'base64url').toString('utf8')) as Record<string, unknown>;

const signedWith = (key: string, payload: unknown) => {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
};

describe('mintSpeakerToken / readSpeakerToken', () => {
  it('round-trips the speaker it was minted for', () => {
    const read = readSpeakerToken(mintSpeakerToken('ada-okonkwo-7f21'));

    expect(read?.sid).toBe('ada-okonkwo-7f21');
    expect(read?.t).toBe('spk');
    expect(typeof read?.iat).toBe('number');
  });

  it('carries only the three declared fields — no name, no address', () => {
    // The badge-QR rule from AGENTS.md applied to a URL. A profile link is
    // forwarded to assistants and co-authors, and an address in the URL is an
    // address in every log the request passes through.
    expect(Object.keys(decode(mintSpeakerToken('ada-okonkwo-7f21'))).sort()).toEqual([
      'iat',
      'sid',
      't',
    ]);
  });

  it('does not build a Firestore sentinel for iat', () => {
    // AGENTS.md gotcha 8, and here `iat` is also what revocation compares
    // against, so it has to survive JSON unchanged.
    const iat = decode(mintSpeakerToken('ada-okonkwo-7f21')).iat;
    expect(typeof iat).toBe('number');
    expect(JSON.parse(JSON.stringify(iat))).toBe(iat);
  });
});

describe('forgery', () => {
  // The first character, never the last: base64url's final character carries
  // two bits that decode to nothing, so flipping it yields a different string
  // with the same bytes. `submission-token.test.ts` has the full argument.
  const mutate = (part: string) => `${part[0] === 'A' ? 'B' : 'A'}${part.slice(1)}`;

  it('rejects a tampered payload', () => {
    const token = mintSpeakerToken('ada-okonkwo-7f21');
    expect(readSpeakerToken(`${mutate(bodyOf(token))}.${sigOf(token)}`)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = mintSpeakerToken('ada-okonkwo-7f21');
    expect(readSpeakerToken(`${bodyOf(token)}.${mutate(sigOf(token))}`)).toBeNull();
  });

  it('will not let speaker A’s signature unlock speaker B', () => {
    // The whole point. Speaker ids are derived from the name and company, so a
    // speaker holding their own link can compute a colleague's id exactly; the
    // signature is the only thing standing between that and rewriting their bio.
    const mine = mintSpeakerToken('ada-okonkwo-7f21');
    const theirs = b64url(JSON.stringify({ ...decode(mine), sid: 'lin-zhao-0c48' }));

    expect(readSpeakerToken(`${theirs}.${sigOf(mine)}`)).toBeNull();
    expect(readSpeakerToken(mine)?.sid).toBe('ada-okonkwo-7f21');
  });

  it('rejects a token minted with a different secret', () => {
    const token = mintSpeakerToken('ada-okonkwo-7f21');
    setEnv('WEB_SPEAKER_SECRET', 'a-completely-different-secret-value');

    expect(readSpeakerToken(token)).toBeNull();
  });

  it('rejects a submission token even when both families share one secret', () => {
    // `sid` is the field name in both families and every file here falls back
    // to WEB_ORDER_SECRET, so under a single configured secret the signature
    // verifies and the body parses. `t` is the only thing that refuses it.
    setEnv('WEB_SPEAKER_SECRET', undefined);
    setEnv('WEB_SUBMISSION_SECRET', undefined);
    setEnv('WEB_ORDER_SECRET', SECRET);

    expect(readSpeakerToken(mintSubmissionToken('sub_9f3a21'))).toBeNull();
  });

  it('rejects a consent token even when both families share one secret', () => {
    // The other family a speaker actually holds: they are mailed a release to
    // sign as well, so this is the replay somebody could attempt without
    // forging anything at all.
    setEnv('WEB_SPEAKER_SECRET', undefined);
    setEnv('WEB_CONSENT_SECRET', undefined);
    setEnv('WEB_ORDER_SECRET', SECRET);

    expect(readSpeakerToken(mintConsentToken({ fid: 'form1', sub: 'spk_ada' }))).toBeNull();
  });

  it('returns null rather than throwing on malformed input', () => {
    // `timingSafeEqual` throws on a length mismatch instead of returning false.
    for (const bad of ['', '.', 'nodot', 'body.', '.sig', 'body.AAAA', 'not base64!.zzz']) {
      expect(readSpeakerToken(bad)).toBeNull();
    }
  });

  it('rejects a body that is correctly signed but the wrong shape', () => {
    const now = Date.now();
    expect(readSpeakerToken(signedWith(SECRET, { t: 'spk', iat: now }))).toBeNull();
    expect(readSpeakerToken(signedWith(SECRET, { t: 'spk', sid: '', iat: now }))).toBeNull();
    expect(readSpeakerToken(signedWith(SECRET, { t: 'spk', sid: 'ok', iat: 'now' }))).toBeNull();
    expect(readSpeakerToken(signedWith(SECRET, { t: 'sub', sid: 'ok', iat: now }))).toBeNull();

    // The control, so the four nulls above are the shape checks and not a
    // broken helper.
    expect(readSpeakerToken(signedWith(SECRET, { t: 'spk', sid: 'ok', iat: now }))?.sid).toBe('ok');
  });
});

describe('expiry', () => {
  it('is still valid the day before it expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
    const token = mintSpeakerToken('ada-okonkwo-7f21');

    vi.setSystemTime(new Date(Date.now() + SPEAKER_TOKEN_TTL_MS - 24 * 60 * 60 * 1000));
    expect(readSpeakerToken(token)?.sid).toBe('ada-okonkwo-7f21');
  });

  it('is dead a day after it expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
    const token = mintSpeakerToken('ada-okonkwo-7f21');

    vi.setSystemTime(new Date(Date.now() + SPEAKER_TOKEN_TTL_MS + 24 * 60 * 60 * 1000));
    expect(readSpeakerToken(token)).toBeNull();
  });

  it('outlives the gap between the programme announcement and the conference', () => {
    // The link is sent when the programme is announced and is still being
    // chased the week before the doors open. Anything shorter dies mid-chase.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-01T09:00:00Z'));
    const token = mintSpeakerToken('ada-okonkwo-7f21');

    vi.setSystemTime(new Date('2027-05-01T09:00:00Z'));
    expect(readSpeakerToken(token)?.sid).toBe('ada-okonkwo-7f21');
  });
});

describe('the signing secret', () => {
  it('falls back to WEB_ORDER_SECRET rather than mailing links that 404', () => {
    setEnv('WEB_SPEAKER_SECRET', undefined);
    setEnv('WEB_ORDER_SECRET', SECRET);

    expect(readSpeakerToken(mintSpeakerToken('ada-okonkwo-7f21'))?.sid).toBe('ada-okonkwo-7f21');
  });

  it('throws something actionable when neither variable is set', () => {
    setEnv('WEB_SPEAKER_SECRET', undefined);
    setEnv('WEB_ORDER_SECRET', undefined);

    expect(() => mintSpeakerToken('ada')).toThrow(/WEB_SPEAKER_SECRET/);
    expect(() => mintSpeakerToken('ada')).toThrow(/openssl rand/);
  });

  it('refuses a secret short enough to brute force', () => {
    setEnv('WEB_SPEAKER_SECRET', 'short');
    expect(() => mintSpeakerToken('ada')).toThrow(/too short/);
  });
});
