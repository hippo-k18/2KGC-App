import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mintReviewerToken } from './reviewer-token.js';
import {
  mintSubmissionToken,
  readSubmissionToken,
  SUBMISSION_TOKEN_TTL_MS,
} from './submission-token.js';

/**
 * The capability token an author holds instead of an account.
 *
 * Every failure here is silent in the direction that matters: a token that
 * verifies when it should not hands somebody else's unpublished abstract to a
 * stranger, and nothing on any screen says so. So the cases are written as the
 * forgeries somebody would actually attempt — swap the submission id, keep the
 * signature; sign with your own key; replay a token from the neighbouring
 * family — rather than as coverage of the happy path.
 */

const SECRET = 'test-submission-secret-not-a-real-one';

/** Save and restore rather than assign, so one test cannot leak into the next. */
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string | undefined) => {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

beforeEach(() => {
  setEnv('WEB_SUBMISSION_SECRET', SECRET);
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

/** A token forged by hand, so a body the minter would never produce can be tested. */
const signedWith = (key: string, payload: unknown) => {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
};

describe('mintSubmissionToken / readSubmissionToken', () => {
  it('round-trips the submission it was minted for', () => {
    const read = readSubmissionToken(mintSubmissionToken('sub_9f3a21'));

    expect(read).not.toBeNull();
    expect(read?.sid).toBe('sub_9f3a21');
    expect(read?.t).toBe('sub');
    expect(typeof read?.iat).toBe('number');
  });

  it('carries only the three declared fields — no address, no name, no call id', () => {
    // The badge-QR rule from AGENTS.md, applied to a URL: an id that leaves the
    // building is opaque or it is an oracle. This test is the guard against
    // somebody adding `email` here later "just for the confirmation screen" —
    // the URL ends up in server logs, Referer headers and forwarded mail.
    expect(Object.keys(decode(mintSubmissionToken('sub_9f3a21'))).sort()).toEqual([
      'iat',
      'sid',
      't',
    ]);
  });

  it('does not build a Firestore sentinel for iat', () => {
    // AGENTS.md gotcha 8. `@kgc/scripts` resolves its own firebase-admin, so a
    // Timestamp minted here fails an `instanceof` check inside a store created
    // in apps/web and takes the entire write down. A plain number survives JSON.
    const iat = decode(mintSubmissionToken('sub_9f3a21')).iat;
    expect(typeof iat).toBe('number');
    expect(JSON.parse(JSON.stringify(iat))).toBe(iat);
  });
});

describe('forgery', () => {
  /*
   * The mutation is applied to the FIRST character of each part, never the
   * last, and that is load-bearing rather than arbitrary.
   *
   * An HMAC-SHA256 signature is 32 bytes, which base64url encodes in 43
   * characters — 258 bits of alphabet for 256 bits of data. The final character
   * therefore carries two bits that decode to nothing, and `Buffer.from(s,
   * 'base64url')` silently discards them. Flipping the last character of a
   * signature from 'A' to 'B' produces a different *string* that decodes to the
   * *same* 32 bytes, so the verifier correctly accepts it and the test reads as
   * a forgery being let through.
   *
   * That is exactly how this test failed on its first run against a verifier
   * that was doing its job. The first character encodes bits 0-5 of byte 0 and
   * has no slack, so mutating it always changes the decoded bytes.
   */
  const mutate = (part: string) => `${part[0] === 'A' ? 'B' : 'A'}${part.slice(1)}`;

  it('rejects a tampered payload', () => {
    const token = mintSubmissionToken('sub_9f3a21');
    const flipped = `${mutate(bodyOf(token))}.${sigOf(token)}`;

    expect(readSubmissionToken(flipped)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = mintSubmissionToken('sub_9f3a21');
    const sig = sigOf(token);

    expect(
      readSubmissionToken(`${bodyOf(token)}.${mutate(sig)}`),
    ).toBeNull();
  });

  it('will not let submission A’s signature unlock submission B', () => {
    // The whole point of the scheme. Somebody who holds their own valid link
    // edits the id in the URL and keeps the signature; the abstract they are
    // reaching for is not theirs.
    const mine = mintSubmissionToken('sub_mine');
    const theirs = b64url(JSON.stringify({ ...decode(mine), sid: 'sub_theirs' }));

    expect(readSubmissionToken(`${theirs}.${sigOf(mine)}`)).toBeNull();
    // And the real token still only ever names its own submission.
    expect(readSubmissionToken(mine)?.sid).toBe('sub_mine');
  });

  it('rejects a token minted with a different secret', () => {
    const token = mintSubmissionToken('sub_9f3a21');
    setEnv('WEB_SUBMISSION_SECRET', 'a-completely-different-secret-value');

    expect(readSubmissionToken(token)).toBeNull();
  });

  it('rejects a reviewer token even when both families share one secret', () => {
    // Every token file here falls back to WEB_ORDER_SECRET, so a deployment
    // that sets only that one signs all four families with the same key and the
    // signature alone cannot say which family a body belongs to. The `t`
    // discriminator is what stops a reviewer's link opening an author's portal.
    setEnv('WEB_SUBMISSION_SECRET', undefined);
    setEnv('WEB_REVIEWER_SECRET', undefined);
    setEnv('WEB_ORDER_SECRET', SECRET);

    expect(readSubmissionToken(mintReviewerToken('rev_1'))).toBeNull();
  });

  it('returns null rather than throwing on malformed input', () => {
    // `timingSafeEqual` throws on a length mismatch instead of returning false,
    // so a short signature must be length-checked before it is compared.
    for (const bad of ['', '.', 'nodot', 'body.', '.sig', 'body.AAAA', 'not base64!.zzz']) {
      expect(readSubmissionToken(bad)).toBeNull();
    }
  });

  it('rejects a body that is correctly signed but the wrong shape', () => {
    // Somebody with the signing key — a future version of this file, most
    // likely — still cannot mint a token that resolves to nothing. The reader
    // checks the shape after the signature, not instead of it.
    // Each body is valid in every respect but one, so each null names one check.
    const now = Date.now();
    expect(readSubmissionToken(signedWith(SECRET, { t: 'sub', iat: now }))).toBeNull();
    expect(readSubmissionToken(signedWith(SECRET, { t: 'sub', sid: '', iat: now }))).toBeNull();
    expect(readSubmissionToken(signedWith(SECRET, { t: 'sub', sid: 'ok', iat: 'now' }))).toBeNull();
    // The one that isolates the discriminator: a correct `sid`, a live `iat`,
    // the right key — and still refused, because it says it is a reviewer's.
    expect(readSubmissionToken(signedWith(SECRET, { t: 'rev', sid: 'ok', iat: now }))).toBeNull();

    // The control: the same hand-signed path with a valid body does verify, so
    // the four nulls above are the shape checks and not a broken helper.
    expect(
      readSubmissionToken(signedWith(SECRET, { t: 'sub', sid: 'sub_ok', iat: Date.now() }))?.sid,
    ).toBe('sub_ok');
  });
});

describe('expiry', () => {
  it('is still valid the day before it expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
    const token = mintSubmissionToken('sub_9f3a21');

    vi.setSystemTime(new Date(Date.now() + SUBMISSION_TOKEN_TTL_MS - 24 * 60 * 60 * 1000));
    expect(readSubmissionToken(token)?.sid).toBe('sub_9f3a21');
  });

  it('is dead a day after it expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
    const token = mintSubmissionToken('sub_9f3a21');

    vi.setSystemTime(new Date(Date.now() + SUBMISSION_TOKEN_TTL_MS + 24 * 60 * 60 * 1000));
    expect(readSubmissionToken(token)).toBeNull();
  });

  it('outlives a whole call cycle, which is why six months was not enough', () => {
    // Submitted the day the call opened in August; the decision is made the
    // following March. A six-month token dies before its own author is told
    // whether they were accepted — the worst possible moment to fail.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T09:00:00Z'));
    const token = mintSubmissionToken('sub_first_in');

    vi.setSystemTime(new Date('2027-03-15T09:00:00Z'));
    expect(readSubmissionToken(token)?.sid).toBe('sub_first_in');
    expect(SUBMISSION_TOKEN_TTL_MS).toBeGreaterThan(180 * 24 * 60 * 60 * 1000);
  });

  it('does not expire while the call is closing — the deadline is the caller’s job', () => {
    // CFA-PLAN §1: "Deadline enforcement is server-side or it is nothing." The
    // token keeps verifying after the call closes on purpose, because the author
    // still has to read their submission and later their decision. The server
    // action refuses the *write*. Nothing here does.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
    const token = mintSubmissionToken('sub_9f3a21');

    vi.setSystemTime(new Date('2027-01-31T23:59:00Z')); // the call has closed
    expect(readSubmissionToken(token)).not.toBeNull();
  });
});

describe('the signing secret', () => {
  it('falls back to WEB_ORDER_SECRET rather than mailing links that 404', () => {
    setEnv('WEB_SUBMISSION_SECRET', undefined);
    setEnv('WEB_ORDER_SECRET', SECRET);

    expect(readSubmissionToken(mintSubmissionToken('sub_9f3a21'))?.sid).toBe('sub_9f3a21');
  });

  it('throws something actionable when neither variable is set', () => {
    setEnv('WEB_SUBMISSION_SECRET', undefined);
    setEnv('WEB_ORDER_SECRET', undefined);

    expect(() => mintSubmissionToken('sub_9f3a21')).toThrow(/WEB_SUBMISSION_SECRET/);
    expect(() => mintSubmissionToken('sub_9f3a21')).toThrow(/openssl rand/);
  });

  it('refuses a secret short enough to brute force', () => {
    setEnv('WEB_SUBMISSION_SECRET', 'short');
    expect(() => mintSubmissionToken('sub_9f3a21')).toThrow(/too short/);
  });
});
