import { describe, expect, it } from 'vitest';
import {
  KEEP_SIGNED_IN_MS,
  REFRESH_AFTER_MS,
  cookieMaxAge,
  cookieOptions,
  decodeSession,
  encodeSession,
  judgeSession,
  newSession,
  refreshSession,
} from './session-core';
import { CHECKIN_SESSION_TTL_MS, SESSION_TTL_MS } from './team-core';

const SECRET = 'a-test-secret-of-enough-length';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 21, 9, 0, 0);

const member = (over: Partial<{ status: string; roles: ('agenda' | 'checkin')[]; sessionEpoch: string }> = {}) => ({
  email: 'crew@example.com',
  status: 'active',
  roles: ['agenda' as const],
  sessionEpoch: 'epoch-1',
  ...over,
});

describe('how long a sign-in lasts', () => {
  it('keeps a remembered owner or member signed in for 30 days', () => {
    for (const roles of [['owner'], ['agenda'], ['checkin']] as const) {
      const s = newSession({ email: 'a@b.co', epoch: 'e', roles, keep: true, now: T0 });
      expect(s.expiresAt - T0).toBe(KEEP_SIGNED_IN_MS);
      expect(KEEP_SIGNED_IN_MS).toBe(30 * DAY);
      expect(cookieMaxAge(s, T0)).toBe(30 * 24 * 60 * 60);
    }
  });

  it('gives an unticked box a browser-session cookie that also expires after 8 hours', () => {
    const s = newSession({ email: 'a@b.co', epoch: 'e', roles: ['owner'], keep: false, now: T0 });
    expect(s.expiresAt - T0).toBe(SESSION_TTL_MS);
    expect(SESSION_TTL_MS).toBe(8 * HOUR);
    // No Max-Age, so the browser drops it on close.
    expect(cookieMaxAge(s, T0)).toBeUndefined();
    expect(cookieOptions(s, T0).maxAge).toBeUndefined();
    expect(decodeSession(SECRET, encodeSession(SECRET, s), T0 + 8 * HOUR + 1)).toBeNull();
  });

  it('keeps the door crew at 14 hours when the box is unticked', () => {
    const s = newSession({ email: 'a@b.co', epoch: 'e', roles: ['checkin'], keep: false, now: T0 });
    expect(s.expiresAt - T0).toBe(CHECKIN_SESSION_TTL_MS);
  });

  it('keeps the cookie httpOnly, sameSite lax and on every path', () => {
    const s = newSession({ email: 'a@b.co', epoch: 'e', roles: ['owner'], keep: true, now: T0 });
    expect(cookieOptions(s, T0)).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
  });
});

describe('rolling renewal', () => {
  const kept = newSession({ email: 'a@b.co', epoch: 'e', roles: ['agenda'], keep: true, now: T0 });

  it('does not renew within a day of the last renewal', () => {
    expect(refreshSession(kept, T0 + REFRESH_AFTER_MS - 1)).toBeNull();
  });

  it('renews for a full 30 days from a visit a day or more later', () => {
    const at = T0 + 3 * DAY;
    const renewed = refreshSession(kept, at)!;
    expect(renewed.expiresAt).toBe(at + KEEP_SIGNED_IN_MS);
    expect(renewed.refreshedAt).toBe(at);
    expect(renewed.epoch).toBe('e');
    // And the next renewal waits another day from there.
    expect(refreshSession(renewed, at + DAY - 1)).toBeNull();
    expect(refreshSession(renewed, at + DAY)!.expiresAt).toBe(at + DAY + KEEP_SIGNED_IN_MS);
  });

  it('signs somebody out after 30 days without a visit', () => {
    const late = T0 + KEEP_SIGNED_IN_MS + 1;
    expect(refreshSession(kept, late)).toBeNull();
    expect(decodeSession(SECRET, encodeSession(SECRET, kept), late)).toBeNull();
  });

  it('a visit every few weeks keeps it alive well past 30 days', () => {
    let s = kept;
    for (let week = 3; week <= 12; week += 3) {
      const at = T0 + week * 7 * DAY;
      expect(decodeSession(SECRET, encodeSession(SECRET, s), at)).not.toBeNull();
      s = refreshSession(s, at)!;
    }
    expect(s.expiresAt).toBe(T0 + 12 * 7 * DAY + KEEP_SIGNED_IN_MS);
  });

  it('never renews an unticked session or one minted before T312', () => {
    const short = newSession({ email: 'a@b.co', epoch: 'e', roles: ['agenda'], keep: false, now: T0 });
    expect(refreshSession(short, T0 + 2 * HOUR)).toBeNull();
    const legacy = { email: 'a@b.co', expiresAt: T0 + 8 * HOUR, epoch: 'e' };
    expect(refreshSession(legacy, T0 + 2 * HOUR)).toBeNull();
  });
});

describe('the signed cookie', () => {
  const s = newSession({ email: 'a@b.co', epoch: 'e', roles: ['owner'], keep: true, now: T0 });

  it('round-trips', () => {
    expect(decodeSession(SECRET, encodeSession(SECRET, s), T0)).toEqual(s);
  });

  it('refuses a tampered payload or another secret', () => {
    const [payload, mac] = encodeSession(SECRET, s).split('.');
    const longer = Buffer.from(JSON.stringify({ ...s, expiresAt: s.expiresAt + DAY })).toString('base64url');
    expect(decodeSession(SECRET, `${longer}.${mac}`, T0)).toBeNull();
    expect(decodeSession('another-secret-of-length', `${payload}.${mac}`, T0)).toBeNull();
    expect(decodeSession(SECRET, 'junk', T0)).toBeNull();
    expect(decodeSession(SECRET, undefined, T0)).toBeNull();
  });
});

describe('a long session is still revocable at once', () => {
  const kept = newSession({ email: 'crew@example.com', epoch: 'epoch-1', roles: ['agenda'], keep: true, now: T0 });
  const renewed = refreshSession(kept, T0 + 5 * DAY)!;

  it('lets an active member in with a matching epoch', () => {
    expect(judgeSession(renewed, { owner: false, member: member() })).toEqual({
      email: 'crew@example.com',
      roles: ['agenda'],
    });
  });

  it('locks out a removed member, even with a freshly renewed 30-day cookie', () => {
    expect(judgeSession(renewed, { owner: false, member: null })).toBeNull();
  });

  it('locks out a member whose epoch moved on (sign out on all devices)', () => {
    expect(judgeSession(renewed, { owner: false, member: member({ sessionEpoch: 'epoch-2' }) })).toBeNull();
  });

  it('locks out an inactive or roleless member', () => {
    expect(judgeSession(renewed, { owner: false, member: member({ status: 'invited' }) })).toBeNull();
    expect(judgeSession(renewed, { owner: false, member: member({ roles: [] }) })).toBeNull();
  });

  it('locks out an owner once their epoch is bumped, and a cookie with no epoch', () => {
    const owner = newSession({ email: 'o@b.co', epoch: 'own-1', roles: ['owner'], keep: true, now: T0 });
    expect(judgeSession(owner, { owner: true, epoch: 'own-1' })).toEqual({ email: 'o@b.co', roles: ['owner'] });
    expect(judgeSession(owner, { owner: true, epoch: 'own-2' })).toBeNull();
    expect(judgeSession({ ...owner, epoch: undefined }, { owner: true, epoch: undefined })).toBeNull();
  });
});
