import { describe, expect, it } from 'vitest';
import { codesMatch, decodeSession, encodeSession, hashCode, normaliseEmail } from './session-token';

const S = 'a-test-secret-of-some-length';

describe('session cookie', () => {
  it('round-trips, and refuses a forged, re-signed or expired one', () => {
    const t = encodeSession(S, { email: 'a@b.test', expiresAt: Date.now() + 1000, epoch: 'e1' });
    expect(decodeSession(S, t)?.email).toBe('a@b.test');
    expect(decodeSession('another-secret-entirely', t)).toBeNull();
    const [payload, mac] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ email: 'ed@b.test', expiresAt: Date.now() + 1000, epoch: 'e1' })).toString('base64url');
    expect(decodeSession(S, `${forged}.${mac}`)).toBeNull();
    expect(decodeSession(S, `${payload}.`)).toBeNull();
    const old = encodeSession(S, { email: 'a@b.test', expiresAt: Date.now() - 1, epoch: 'e1' });
    expect(decodeSession(S, old)).toBeNull();
  });
});

describe('sign-in codes', () => {
  it('are bound to the address they were sent to', () => {
    const h = hashCode(S, 'a@b.test', '123456');
    expect(codesMatch(h, hashCode(S, 'a@b.test', '123456'))).toBe(true);
    expect(codesMatch(h, hashCode(S, 'c@b.test', '123456'))).toBe(false);
    expect(codesMatch(h, hashCode(S, 'a@b.test', '123457'))).toBe(false);
  });
  it('normalise addresses, and refuse ones that cannot be a document id', () => {
    expect(normaliseEmail('  Ada@Example.COM ')).toBe('ada@example.com');
    expect(normaliseEmail('a/b@example.com')).toBeNull();
    expect(normaliseEmail('not an email')).toBeNull();
  });
});
