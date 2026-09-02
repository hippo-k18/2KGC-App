/**
 * The two halves of "a bulk send is legally sendable".
 *
 * **The capability token** that the public unsubscribe link carries, and
 * **the suppression rule** that decides who a campaign reaches and what the log
 * says about everybody it did not. Together they are the claim a conference has
 * to be able to defend: a reader can stop the mail without asking anybody, and
 * afterwards the mail actually stops.
 *
 * ── Why this lives in `tests/programme` ─────────────────────────────────────
 *
 * Because that is the runner, not because unsubscribing is programme work.
 * `tests/programme` is the suite for pure logic that needs no emulator, and
 * `feature-search.test.ts` already sits here testing `apps/organizer/src/lib`
 * for the same reason. `npm test` and `npm run test:programme` both include it;
 * a new directory would be included by neither until somebody edited the root
 * `package.json`, and an unrun test is worse than no test.
 *
 * ── Why the token module can be imported and `campaigns.ts` cannot ──────────
 *
 * `campaigns.ts` carries `server-only`, which throws outside a React Server
 * Component, so Vitest cannot load it at all. The suppression rule therefore
 * lives in `campaigns-core.ts` — the same split `conflicts-core.ts` uses, and
 * the reason it exists.
 *
 * Run with: npm run test:programme
 */
import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  campaignSkipRows,
  partitionAudience,
  skipReasonText,
  suppressionReasonFor,
  type Suppressible,
} from '../../apps/organizer/src/lib/campaigns-core';

/*
 * The token module reads its secret inside `secret()` on every call rather than
 * at import time, so a test can set, swap and unset the environment between
 * cases. That laziness is load-bearing here and is worth one test of its own.
 */
import {
  mintUnsubscribeToken,
  readUnsubscribeToken,
} from '../../scripts/src/lib/unsubscribe-token';

const SECRET = 'test-unsubscribe-secret-long-enough';
const OTHER_SECRET = 'a-completely-different-secret-value';

const CID = 'contact_0123456789abcdef0123456789abcdef';

let savedUnsub: string | undefined;
let savedOrder: string | undefined;

beforeEach(() => {
  savedUnsub = process.env.WEB_UNSUBSCRIBE_SECRET;
  savedOrder = process.env.WEB_ORDER_SECRET;
  process.env.WEB_UNSUBSCRIBE_SECRET = SECRET;
  delete process.env.WEB_ORDER_SECRET;
});

afterEach(() => {
  vi.useRealTimers();
  if (savedUnsub === undefined) delete process.env.WEB_UNSUBSCRIBE_SECRET;
  else process.env.WEB_UNSUBSCRIBE_SECRET = savedUnsub;
  if (savedOrder === undefined) delete process.env.WEB_ORDER_SECRET;
  else process.env.WEB_ORDER_SECRET = savedOrder;
});

// ---------------------------------------------------------------------------
// The capability token
// ---------------------------------------------------------------------------

describe('the unsubscribe token round-trips', () => {
  it('reads back the contact id it was minted for', () => {
    expect(readUnsubscribeToken(mintUnsubscribeToken(CID))?.cid).toBe(CID);
  });

  it('survives URL encoding, which is how it reaches the route', () => {
    const token = mintUnsubscribeToken(CID);
    expect(readUnsubscribeToken(decodeURIComponent(encodeURIComponent(token)))?.cid).toBe(CID);
  });

  it('produces a different token each time, because `iat` moves', () => {
    // Not a security property — it is the reason a test cannot assert on a
    // literal token string, and asserting it here stops somebody adding one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    const first = mintUnsubscribeToken(CID);
    vi.setSystemTime(new Date('2027-01-01T00:00:01Z'));
    expect(mintUnsubscribeToken(CID)).not.toBe(first);
  });
});

describe('the unsubscribe token rejects what it should', () => {
  it('rejects a flipped signature', () => {
    const token = mintUnsubscribeToken(CID);
    const dot = token.lastIndexOf('.');
    const sig = token.slice(dot + 1);
    const tampered = `${token.slice(0, dot)}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
    expect(readUnsubscribeToken(tampered)).toBeNull();
  });

  it('rejects a body swapped for another contact id', () => {
    // The attack the HMAC exists to stop: `contacts/{id}` is a hash of the
    // address, so anybody holding an address can compute the id they would
    // want to substitute. Only the signature stops them using it.
    const mine = mintUnsubscribeToken(CID);
    const theirs = mintUnsubscribeToken('contact_ffffffffffffffffffffffffffffffff');
    const forged = `${theirs.slice(0, theirs.lastIndexOf('.'))}.${mine.slice(mine.lastIndexOf('.') + 1)}`;
    expect(readUnsubscribeToken(forged)).toBeNull();
  });

  it('rejects a token with no signature at all', () => {
    expect(readUnsubscribeToken('nodothere')).toBeNull();
    expect(readUnsubscribeToken('')).toBeNull();
    expect(readUnsubscribeToken('.onlyasignature')).toBeNull();
  });

  it('rejects a correctly signed body that is not a valid payload', () => {
    /*
     * Signed with the real secret, so this gets past the HMAC and exercises the
     * parse. Not an attack — an attacker has no secret — but the shape a bug in
     * some future minting path would produce, and the case that decides whether
     * a malformed payload is a null or an unhandled throw inside a route.
     *
     * The signing is duplicated here on purpose: it pins the encoding as well
     * as the parse, so changing how the body is encoded fails a test rather
     * than silently invalidating every link already in somebody's inbox.
     */
    const signed = (raw: string) => {
      const body = Buffer.from(raw, 'utf8').toString('base64url');
      return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
    };

    expect(readUnsubscribeToken(signed('not json at all'))).toBeNull();
    expect(readUnsubscribeToken(signed('{"iat":1}'))).toBeNull(); // no cid
    expect(readUnsubscribeToken(signed('{"cid":"","iat":1}'))).toBeNull(); // empty cid
    expect(readUnsubscribeToken(signed('{"cid":42,"iat":1}'))).toBeNull(); // cid not a string

    // …and the same construction with a real payload does verify, which is what
    // makes the four assertions above mean something.
    expect(readUnsubscribeToken(signed(`{"cid":"${CID}","iat":1}`))?.cid).toBe(CID);
  });

  it('rejects a token signed with a different secret', () => {
    const token = mintUnsubscribeToken(CID);
    process.env.WEB_UNSUBSCRIBE_SECRET = OTHER_SECRET;
    expect(readUnsubscribeToken(token)).toBeNull();
  });
});

describe('the unsubscribe token never expires, and that is deliberate', () => {
  it('still verifies a token minted years earlier', () => {
    /*
     * The order token expires at six months because the page it unlocks shows
     * a claim code. This one authorises stopping mail and nothing else, so an
     * expired unsubscribe link is a legal problem rather than a security
     * improvement — somebody who finds a 2027 newsletter in 2032 and presses
     * unsubscribe must be unsubscribed.
     */
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-05-03T09:00:00Z'));
    const token = mintUnsubscribeToken(CID);

    vi.setSystemTime(new Date('2032-11-20T09:00:00Z'));
    expect(readUnsubscribeToken(token)?.cid).toBe(CID);
  });
});

describe('the unsubscribe token and its secret', () => {
  it('falls back to WEB_ORDER_SECRET when the dedicated one is unset', () => {
    /*
     * The fallback is not tidiness. A deployment missing one environment
     * variable would otherwise send a bulk campaign with no unsubscribe link in
     * it at all, which is the exact failure the link exists to prevent.
     */
    delete process.env.WEB_UNSUBSCRIBE_SECRET;
    process.env.WEB_ORDER_SECRET = OTHER_SECRET;
    expect(readUnsubscribeToken(mintUnsubscribeToken(CID))?.cid).toBe(CID);
  });

  it('prefers the dedicated secret when both are set', () => {
    process.env.WEB_ORDER_SECRET = OTHER_SECRET;
    const token = mintUnsubscribeToken(CID);

    // Rotating the order secret alone must not invalidate outstanding
    // unsubscribe links — that is the whole reason the two are separable.
    process.env.WEB_ORDER_SECRET = 'yet-another-order-secret-value';
    expect(readUnsubscribeToken(token)?.cid).toBe(CID);
  });

  it('throws rather than signing with nothing when neither is set', () => {
    delete process.env.WEB_UNSUBSCRIBE_SECRET;
    delete process.env.WEB_ORDER_SECRET;
    expect(() => mintUnsubscribeToken(CID)).toThrow(/WEB_UNSUBSCRIBE_SECRET/);
  });

  it('throws on a secret too short to be one', () => {
    process.env.WEB_UNSUBSCRIBE_SECRET = 'short';
    expect(() => mintUnsubscribeToken(CID)).toThrow();
  });
});

describe('the unsubscribe token discloses nothing on its own', () => {
  it('carries the contact id and never the address', () => {
    /*
     * URLs end up in server logs, in `Referer` headers and in browser history.
     * The id is a hash, so a leaked link is not a leaked address — and this is
     * the assertion that would fail the day somebody "helpfully" put the email
     * in the payload to save a document read.
     */
    const token = mintUnsubscribeToken(CID);
    const body = Buffer.from(token.slice(0, token.lastIndexOf('.')), 'base64url').toString('utf8');

    expect(body).not.toMatch(/@/);
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['cid', 'iat']);
  });
});

// ---------------------------------------------------------------------------
// The suppression rule
// ---------------------------------------------------------------------------

const AT = '2027-03-01T10:00:00.000Z';

const mailable: Suppressible = { email: 'ada@example.com' };
const unsubscribed: Suppressible = { email: 'grace@example.com', unsubscribedAt: AT };
const bounced: Suppressible = { email: 'alan@example.com', bouncedAt: AT };
const both: Suppressible = { email: 'edsger@example.com', unsubscribedAt: AT, bouncedAt: AT };

describe('who may be emailed', () => {
  it('lets a clean contact through', () => {
    expect(suppressionReasonFor(mailable)).toBeNull();
  });

  it('stops an unsubscribed contact', () => {
    expect(suppressionReasonFor(unsubscribed)).toBe('unsubscribed');
  });

  it('stops a bounced contact', () => {
    expect(suppressionReasonFor(bounced)).toBe('bounced');
  });

  it('names both when both are true rather than picking a winner', () => {
    // A precedence rule between the two would be arbitrary and would then have
    // to be remembered everywhere. A third reason costs one union member.
    expect(suppressionReasonFor(both)).toBe('unsubscribed and bounced');
  });

  it('treats an empty-string timestamp as absent, not as suppressed', () => {
    // `iso()` in `campaigns.ts` returns undefined on a malformed timestamp, but
    // a row built from a partial document could carry ''. Suppressing on a
    // falsy value would silently un-mail somebody who never opted out.
    expect(suppressionReasonFor({ email: 'x@example.com', unsubscribedAt: '' })).toBeNull();
  });
});

describe('splitting an audience', () => {
  const list = [mailable, unsubscribed, bounced, both];

  it('never puts a suppressed contact in the recipients', () => {
    // The one guarantee this whole file exists for.
    const { recipients } = partitionAudience(list);
    expect(recipients.every((c) => suppressionReasonFor(c) === null)).toBe(true);
  });

  it('accounts for everybody exactly once', () => {
    // Nobody dropped and nobody duplicated: a contact who fell out of both
    // halves would be silently un-mailed with no skipped row to explain it,
    // which is the failure mode this split replaced.
    const { recipients, excluded } = partitionAudience(list);
    const seen = [...recipients.map((c) => c.email), ...excluded.map((e) => e.contact.email)];

    expect(seen.slice().sort()).toEqual(list.map((c) => c.email).slice().sort());
    expect(new Set(seen).size).toBe(list.length);
  });

  it('keeps input order in both halves', () => {
    // The recipient table shows the first 200 addresses so an organizer can
    // check the people they meant are in it; a reordered split makes that
    // check meaningless.
    const many = [mailable, unsubscribed, { email: 'b@example.com' }, bounced, { email: 'a@example.com' }];
    const { recipients, excluded } = partitionAudience(many);
    expect(recipients.map((c) => c.email)).toEqual(['ada@example.com', 'b@example.com', 'a@example.com']);
    expect(excluded.map((e) => e.contact.email)).toEqual(['grace@example.com', 'alan@example.com']);
  });

  it('handles a list with nobody on it', () => {
    expect(partitionAudience([])).toEqual({ recipients: [], excluded: [] });
  });

  it('handles a list where everybody is suppressed', () => {
    const { recipients, excluded } = partitionAudience([unsubscribed, bounced, both]);
    expect(recipients).toEqual([]);
    expect(excluded.map((e) => e.reason)).toEqual([
      'unsubscribed',
      'bounced',
      'unsubscribed and bounced',
    ]);
  });
});

describe('the skipped rows a send writes to emailLog', () => {
  it('writes one row per excluded contact and none for a recipient', () => {
    /*
     * The arithmetic that makes a campaign reconcile: sent + failed + skipped
     * equals the size of the list, not the size of the audience. Before these
     * rows existed the log said "938 sent" and the other 62 people were simply
     * absent from the record — indistinguishable from never having been on the
     * list at all.
     */
    const { excluded } = partitionAudience([mailable, unsubscribed, bounced, both]);
    const rows = campaignSkipRows(excluded);

    expect(rows.map((r) => r.to)).toEqual([
      'grace@example.com',
      'alan@example.com',
      'edsger@example.com',
    ]);
    expect(rows.some((r) => r.to === 'ada@example.com')).toBe(false);
  });

  it('says why, in a sentence a human reading a transaction log can use', () => {
    const rows = campaignSkipRows(partitionAudience([unsubscribed]).excluded);
    expect(rows[0].reason).toBe(skipReasonText('unsubscribed'));
    expect(rows[0].reason).toMatch(/unsubscribed/);
    // It must not read as a transient failure somebody would retry by hand.
    expect(rows[0].reason).toMatch(/suppressed/i);
  });

  it('gives every reason its own text', () => {
    const texts = (['unsubscribed', 'bounced', 'unsubscribed and bounced'] as const).map(
      skipReasonText,
    );
    expect(new Set(texts).size).toBe(3);
  });

  it('de-duplicates an address that appears twice', () => {
    // `audienceFor('*')` unions every named list. Two rows for one person would
    // double-count in `listCampaigns`, which is the number the screen prints.
    const rows = campaignSkipRows(partitionAudience([unsubscribed, { ...unsubscribed }]).excluded);
    expect(rows.length).toBe(1);
  });

  it('writes nothing when nobody was excluded', () => {
    expect(campaignSkipRows(partitionAudience([mailable]).excluded)).toEqual([]);
  });
});
