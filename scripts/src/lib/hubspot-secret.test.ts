import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openToken, sealToken, tokenState } from './hubspot-secret.js';

/** A made-up token in HubSpot's shape. Never a real one. */
/** Built from parts at runtime so no source line looks like a HubSpot token to secret scanners. */
const FAKE_TOKEN = ['pat', 'na1', '00000000', '0000', '4000', '8000', '000000000001'].join('-');

describe('hubspot token at rest', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.WEB_ORDER_SECRET;
    process.env.WEB_ORDER_SECRET = 'unit-test-order-secret-0123456789';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.WEB_ORDER_SECRET;
    else process.env.WEB_ORDER_SECRET = saved;
  });

  const parts = (sealed: string) => sealed.split('.') as [string, string, string, string];
  const b64 = (s: string) => Buffer.from(s, 'base64url');

  it('round trips, and the sealed form does not contain the token', () => {
    const sealed = sealToken(FAKE_TOKEN);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain(FAKE_TOKEN);
    expect(sealed).not.toContain('000000000001');
    expect(openToken(sealed)).toBe(FAKE_TOKEN);
  });

  it('uses a 12-byte nonce and a 16-byte tag', () => {
    const [, iv, tag] = parts(sealToken(FAKE_TOKEN));
    expect(b64(iv)).toHaveLength(12);
    expect(b64(tag)).toHaveLength(16);
  });

  it('seals the same token differently each time', () => {
    expect(sealToken(FAKE_TOKEN)).not.toBe(sealToken(FAKE_TOKEN));
  });

  it('refuses a tampered value', () => {
    const [v, iv, tag, ct] = parts(sealToken(FAKE_TOKEN));
    const flip = (s: string) => {
      const b = b64(s);
      b[0] ^= 1;
      return b.toString('base64url');
    };
    expect(openToken([v, iv, tag, flip(ct)].join('.'))).toBeNull();
    expect(openToken([v, iv, flip(tag), ct].join('.'))).toBeNull();
    expect(openToken([v, flip(iv), tag, ct].join('.'))).toBeNull();
    expect(openToken(['v2', iv, tag, ct].join('.'))).toBeNull();
    expect(openToken([v, iv, tag].join('.'))).toBeNull();
    expect(openToken('')).toBeNull();
    expect(openToken(undefined)).toBeNull();
    expect(openToken(42)).toBeNull();
  });

  // T334 B 2.5: Node accepts a GCM tag as short as 4 bytes unless told the length.
  it('B-2.5: refuses a truncated auth tag of every length from 4 to 15 bytes', () => {
    const [v, iv, tag, ct] = parts(sealToken(FAKE_TOKEN));
    for (let n = 4; n < 16; n++) {
      const short = b64(tag).subarray(0, n).toString('base64url');
      expect(openToken([v, iv, short, ct].join('.'))).toBeNull();
    }
    expect(openToken([v, iv, '', ct].join('.'))).toBeNull();
    // A longer tag is refused too, rather than read loosely.
    expect(openToken([v, iv, Buffer.concat([b64(tag), Buffer.from([0])]).toString('base64url'), ct].join('.'))).toBeNull();
  });

  it('B-2.5: refuses a nonce that is not 12 bytes', () => {
    const [v, iv, tag, ct] = parts(sealToken(FAKE_TOKEN));
    expect(openToken([v, b64(iv).subarray(0, 1).toString('base64url'), tag, ct].join('.'))).toBeNull();
    expect(openToken([v, b64(iv).subarray(0, 11).toString('base64url'), tag, ct].join('.'))).toBeNull();
    expect(openToken([v, Buffer.concat([b64(iv), Buffer.alloc(4)]).toString('base64url'), tag, ct].join('.'))).toBeNull();
  });

  it('cannot open a value sealed under another key', () => {
    const sealed = sealToken(FAKE_TOKEN);
    process.env.WEB_ORDER_SECRET = 'a-different-order-secret-9876543210';
    expect(openToken(sealed)).toBeNull();
  });

  it('refuses to seal without a secret, or with a short one', () => {
    delete process.env.WEB_ORDER_SECRET;
    expect(() => sealToken(FAKE_TOKEN)).toThrow(/WEB_ORDER_SECRET is missing or too short/);
    process.env.WEB_ORDER_SECRET = 'short';
    expect(() => sealToken(FAKE_TOKEN)).toThrow(/WEB_ORDER_SECRET/);
  });

  it('reads nothing without a secret, rather than throwing', () => {
    const sealed = sealToken(FAKE_TOKEN);
    delete process.env.WEB_ORDER_SECRET;
    expect(openToken(sealed)).toBeNull();
  });

  it('never puts the token in the error it throws', () => {
    delete process.env.WEB_ORDER_SECRET;
    expect(() => sealToken(FAKE_TOKEN)).toThrow();
    try {
      sealToken(FAKE_TOKEN);
    } catch (err) {
      expect(String(err)).not.toContain(FAKE_TOKEN);
    }
  });

  describe('tokenState', () => {
    it('says none when nothing is saved', () => {
      expect(tokenState(undefined)).toBe('none');
      expect(tokenState(null)).toBe('none');
    });
    it('says ok for a value this server can open', () => {
      expect(tokenState(sealToken(FAKE_TOKEN))).toBe('ok');
    });
    it('says unreadable, not refused, for a value sealed under another key or damaged', () => {
      const sealed = sealToken(FAKE_TOKEN);
      process.env.WEB_ORDER_SECRET = 'a-rotated-order-secret-0123456789';
      expect(tokenState(sealed)).toBe('unreadable');
      expect(tokenState('garbage')).toBe('unreadable');
      expect(tokenState(FAKE_TOKEN)).toBe('unreadable');
      expect(tokenState(7)).toBe('unreadable');
    });
  });
});
