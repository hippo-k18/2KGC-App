import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mintSpeakerToken } from './speaker-token.js';
import {
  EXHIBITOR_TOKEN_TTL_MS,
  exhibitorLinkOpens,
  mintExhibitorToken,
  readExhibitorToken,
} from './exhibitor-token.js';

/**
 * The capability link an exhibitor's booth staff hold instead of an account.
 *
 * Written as the forgeries somebody would actually attempt rather than as
 * coverage of the happy path, for the reason `speaker-token.test.ts` gives: a
 * token that verifies when it should not is silent everywhere, and here it
 * would hand one exhibiting company another company's leads.
 */

const SECRET = 'test-exhibitor-secret-not-a-real-one';

/** Save and restore rather than assign, so one test cannot leak into the next. */
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string | undefined) => {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

beforeEach(() => {
  setEnv('WEB_EXHIBITOR_SECRET', SECRET);
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

const signedWith = (key: string, payload: unknown) => {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
};

describe('mintExhibitorToken / readExhibitorToken', () => {
  it('round-trips the exhibitor it was minted for', () => {
    const read = readExhibitorToken(mintExhibitorToken('graphwise'));

    expect(read?.xid).toBe('graphwise');
    expect(read?.t).toBe('exh');
  });

  it('carries the exhibitor id and nothing else about the company', () => {
    const decoded = JSON.parse(
      Buffer.from(bodyOf(mintExhibitorToken('graphwise')), 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    expect(Object.keys(decoded).sort()).toEqual(['iat', 't', 'xid']);
  });

  it('refuses a body whose exhibitor id was swapped for another', () => {
    const token = mintExhibitorToken('graphwise');
    const forged = `${b64url(JSON.stringify({ t: 'exh', xid: 'ontotext-labs', iat: Date.now() }))}.${sigOf(token)}`;

    expect(readExhibitorToken(forged)).toBeNull();
  });

  it('refuses a token signed with a different key', () => {
    const forged = signedWith('some-other-secret-entirely', {
      t: 'exh',
      xid: 'graphwise',
      iat: Date.now(),
    });

    expect(readExhibitorToken(forged)).toBeNull();
  });

  it('refuses a speaker token replayed under a shared secret', () => {
    // The one failure a shared `WEB_ORDER_SECRET` would otherwise allow: both
    // families verify against the same key, so only `t` separates them.
    setEnv('WEB_EXHIBITOR_SECRET', undefined);
    setEnv('WEB_ORDER_SECRET', SECRET);

    expect(readExhibitorToken(mintSpeakerToken('ada-okonkwo-7f21'))).toBeNull();
  });

  it('refuses an exhibitor token whose family was rewritten', () => {
    const forged = signedWith(SECRET, { t: 'spk', xid: 'graphwise', iat: Date.now() });
    expect(readExhibitorToken(forged)).toBeNull();
  });

  it('refuses malformed input rather than throwing', () => {
    for (const bad of ['', '.', 'nodot', 'a.b', `${b64url('{')}.x`]) {
      expect(readExhibitorToken(bad)).toBeNull();
    }
  });

  it('expires after 120 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    const token = mintExhibitorToken('graphwise');

    vi.setSystemTime(new Date(Date.now() + EXHIBITOR_TOKEN_TTL_MS - 1000));
    expect(readExhibitorToken(token)?.xid).toBe('graphwise');

    vi.setSystemTime(new Date(Date.now() + 2000));
    expect(readExhibitorToken(token)).toBeNull();
  });

  it('falls back to WEB_ORDER_SECRET, and throws when neither is set', () => {
    setEnv('WEB_EXHIBITOR_SECRET', undefined);
    setEnv('WEB_ORDER_SECRET', SECRET);
    expect(readExhibitorToken(mintExhibitorToken('graphwise'))?.xid).toBe('graphwise');

    setEnv('WEB_ORDER_SECRET', undefined);
    expect(() => mintExhibitorToken('graphwise')).toThrow(/WEB_EXHIBITOR_SECRET/);
  });
});

describe('exhibitorLinkOpens', () => {
  const eventId = 'kgc-2027';

  it('opens a fresh link for a confirmed exhibitor', () => {
    expect(
      exhibitorLinkOpens({ iat: Date.now(), eventId, exhibitorEventId: eventId, status: 'confirmed' }),
    ).toBe(true);
  });

  it('treats an absent revocation stamp as nothing revoked', () => {
    expect(exhibitorLinkOpens({ iat: 1_000, eventId })).toBe(true);
  });

  it('refuses every link minted before the revocation instant', () => {
    expect(exhibitorLinkOpens({ iat: 999, leadLinksValidFrom: 1_000, eventId })).toBe(false);
    expect(exhibitorLinkOpens({ iat: 1_000, leadLinksValidFrom: 1_000, eventId })).toBe(true);
  });

  it('refuses a cancelled exhibitor, who has no stand to scan at', () => {
    expect(exhibitorLinkOpens({ iat: Date.now(), eventId, status: 'cancelled' })).toBe(false);
  });

  it('refuses a record belonging to another event', () => {
    expect(
      exhibitorLinkOpens({ iat: Date.now(), eventId, exhibitorEventId: 'kgc-2026' }),
    ).toBe(false);
  });
});
