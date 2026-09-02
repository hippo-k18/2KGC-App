import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mintReviewerToken,
  readReviewerToken,
  REVIEWER_TOKEN_TTL_MS,
} from './reviewer-token.js';
import { mintSubmissionToken, SUBMISSION_TOKEN_TTL_MS } from './submission-token.js';

/**
 * The capability token a reviewer holds instead of an account.
 *
 * The higher-value of the two CFA tokens: a submission link reaches one author's
 * own work, this one reaches everybody's, plus the ability to write the scores
 * that decide whether that work is accepted. So the cases here lean on the two
 * properties that bound it — it names exactly one reviewer, and it dies sooner
 * than a submission link does.
 */

const SECRET = 'test-reviewer-secret-not-a-real-one';

/** Save and restore rather than assign, so one test cannot leak into the next. */
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string | undefined) => {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

beforeEach(() => {
  setEnv('WEB_REVIEWER_SECRET', SECRET);
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

describe('mintReviewerToken / readReviewerToken', () => {
  it('round-trips the reviewer it was minted for', () => {
    const read = readReviewerToken(mintReviewerToken('rev_4c81de'));

    expect(read).not.toBeNull();
    expect(read?.rvid).toBe('rev_4c81de');
    expect(read?.t).toBe('rev');
    expect(typeof read?.iat).toBe('number');
  });

  it('carries only the three declared fields — no name, no address, no assignments', () => {
    // A reviewer's identity is the thing a blind-capable review process has to
    // be most careful with (CFA-PLAN §1.1), and a URL leaks to every log,
    // Referer header and forwarded mail it passes through. The assignment list
    // is absent for a second reason: it is re-balanced and withdrawn on a
    // declared conflict, so a copy signed into the URL would be a frozen one.
    expect(Object.keys(decode(mintReviewerToken('rev_4c81de'))).sort()).toEqual([
      'iat',
      'rvid',
      't',
    ]);
  });

  it('does not build a Firestore sentinel for iat', () => {
    // AGENTS.md gotcha 8: a Timestamp minted in @kgc/scripts fails an
    // `instanceof` check inside a store created in apps/web and kills the write.
    const iat = decode(mintReviewerToken('rev_4c81de')).iat;
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
    const token = mintReviewerToken('rev_4c81de');
    const body = bodyOf(token);

    expect(
      readReviewerToken(`${mutate(body)}.${sigOf(token)}`),
    ).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = mintReviewerToken('rev_4c81de');
    const sig = sigOf(token);

    expect(
      readReviewerToken(`${bodyOf(token)}.${mutate(sig)}`),
    ).toBeNull();
  });

  it('will not let reviewer A’s signature unlock reviewer B’s pile', () => {
    // One reviewer editing the id in their own working link to read a
    // colleague's assignments — and, in a single-blind round, to learn who is
    // reviewing what.
    const mine = mintReviewerToken('rev_mine');
    const theirs = b64url(JSON.stringify({ ...decode(mine), rvid: 'rev_theirs' }));

    expect(readReviewerToken(`${theirs}.${sigOf(mine)}`)).toBeNull();
    expect(readReviewerToken(mine)?.rvid).toBe('rev_mine');
  });

  it('rejects a token minted with a different secret', () => {
    const token = mintReviewerToken('rev_4c81de');
    setEnv('WEB_REVIEWER_SECRET', 'a-completely-different-secret-value');

    expect(readReviewerToken(token)).toBeNull();
  });

  it('rejects a submission token even when both families share one secret', () => {
    // Both files fall back to WEB_ORDER_SECRET, so a deployment that sets only
    // that variable signs both families with one key. Without the `t`
    // discriminator an author's own link would be a well-signed body here — and
    // `sid` is not `rvid`, so it would fail on the field name today, but that is
    // an accident of naming and `t` is the part that is meant to hold.
    setEnv('WEB_REVIEWER_SECRET', undefined);
    setEnv('WEB_SUBMISSION_SECRET', undefined);
    setEnv('WEB_ORDER_SECRET', SECRET);

    expect(readReviewerToken(mintSubmissionToken('sub_1'))).toBeNull();
    // Same body, renamed field, live `iat`, right key — still refused, because
    // `t` says 'sub'. This is the assertion that isolates the discriminator.
    expect(
      readReviewerToken(signedWith(SECRET, { t: 'sub', rvid: 'rev_1', iat: Date.now() })),
    ).toBeNull();
  });

  it('returns null rather than throwing on malformed input', () => {
    // `timingSafeEqual` throws on a length mismatch instead of returning false,
    // so a short signature must be length-checked before it is compared.
    for (const bad of ['', '.', 'nodot', 'body.', '.sig', 'body.AAAA', 'not base64!.zzz']) {
      expect(readReviewerToken(bad)).toBeNull();
    }
  });

  it('rejects a body that is correctly signed but the wrong shape', () => {
    // Each body is valid in every respect but one, so each null names one check.
    const now = Date.now();
    expect(readReviewerToken(signedWith(SECRET, { t: 'rev', iat: now }))).toBeNull();
    expect(readReviewerToken(signedWith(SECRET, { t: 'rev', rvid: '', iat: now }))).toBeNull();
    expect(readReviewerToken(signedWith(SECRET, { t: 'rev', rvid: 'ok', iat: 'now' }))).toBeNull();

    // The control: the same hand-signed path with a valid body does verify.
    expect(
      readReviewerToken(signedWith(SECRET, { t: 'rev', rvid: 'rev_ok', iat: Date.now() }))?.rvid,
    ).toBe('rev_ok');
  });
});

describe('expiry', () => {
  it('is still valid the day before it expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
    const token = mintReviewerToken('rev_4c81de');

    vi.setSystemTime(new Date(Date.now() + REVIEWER_TOKEN_TTL_MS - 24 * 60 * 60 * 1000));
    expect(readReviewerToken(token)?.rvid).toBe('rev_4c81de');
  });

  it('is dead a day after it expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
    const token = mintReviewerToken('rev_4c81de');

    vi.setSystemTime(new Date(Date.now() + REVIEWER_TOKEN_TTL_MS + 24 * 60 * 60 * 1000));
    expect(readReviewerToken(token)).toBeNull();
  });

  it('outlives a review round that slips', () => {
    // The failure to avoid is a link that dies at 23:00 on the deadline for the
    // one reviewer who left it late: the cost lands entirely on the volunteer
    // and is invisible to the organizer.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-02-01T09:00:00Z'));
    const token = mintReviewerToken('rev_slow');

    vi.setSystemTime(new Date('2027-04-30T23:00:00Z')); // three months of slippage
    expect(readReviewerToken(token)?.rvid).toBe('rev_slow');
  });

  it('dies sooner than a submission token, because it reaches more people’s work', () => {
    // Deliberate asymmetry, not an oversight. This credential is also the
    // cheaper of the two to replace: every reviewer reminder mints a fresh link.
    expect(REVIEWER_TOKEN_TTL_MS).toBeLessThan(SUBMISSION_TOKEN_TTL_MS);
  });

  it('a re-minted link is live while the old one still is', () => {
    // Which is why there is no revocation here: re-sending costs nothing and
    // does not need the previous link dead. Killing one specific link needs a
    // `tokensValidFrom` date on reviewers/{id}, checked by the caller against
    // `iat` — deliberately not this file's job.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-02-01T09:00:00Z'));
    const first = mintReviewerToken('rev_4c81de');

    vi.setSystemTime(new Date('2027-03-01T09:00:00Z'));
    const second = mintReviewerToken('rev_4c81de');

    expect(readReviewerToken(first)?.rvid).toBe('rev_4c81de');
    expect(readReviewerToken(second)?.rvid).toBe('rev_4c81de');
    expect(first).not.toBe(second);
    // And `iat` is what a future revocation check would compare against.
    expect(readReviewerToken(second)!.iat).toBeGreaterThan(readReviewerToken(first)!.iat);
  });
});

describe('the signing secret', () => {
  it('falls back to WEB_ORDER_SECRET rather than inviting a committee to links that 404', () => {
    setEnv('WEB_REVIEWER_SECRET', undefined);
    setEnv('WEB_ORDER_SECRET', SECRET);

    expect(readReviewerToken(mintReviewerToken('rev_4c81de'))?.rvid).toBe('rev_4c81de');
  });

  it('throws something actionable when neither variable is set', () => {
    setEnv('WEB_REVIEWER_SECRET', undefined);
    setEnv('WEB_ORDER_SECRET', undefined);

    expect(() => mintReviewerToken('rev_4c81de')).toThrow(/WEB_REVIEWER_SECRET/);
    expect(() => mintReviewerToken('rev_4c81de')).toThrow(/openssl rand/);
  });

  it('refuses a secret short enough to brute force', () => {
    setEnv('WEB_REVIEWER_SECRET', 'short');
    expect(() => mintReviewerToken('rev_4c81de')).toThrow(/too short/);
  });
});
