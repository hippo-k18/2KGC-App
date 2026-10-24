import { describe, expect, it } from 'vitest';

import {
  DAY_MS,
  FAILED_GUESS_DAILY,
  FAILED_GUESS_HOURLY,
  FAILED_GUESS_LOCK_MS,
  HOUR_MS,
  callerIpFromHeaders,
  limitId,
  perHourAndDay,
  tickCaps,
  tickFailure,
  toMillis,
  type CapsCounterDoc,
} from './rate-limit';

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });

describe('callerIpFromHeaders (T264)', () => {
  it('takes the hop Apache appended, not the one the client wrote', () => {
    expect(callerIpFromHeaders(h({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('ignores the Netlify header, which any client can now send', () => {
    expect(
      callerIpFromHeaders(h({ 'x-nf-client-connection-ip': '9.9.9.9', 'x-forwarded-for': '203.0.113.9' })),
    ).toBe('203.0.113.9');
    expect(callerIpFromHeaders(h({ 'x-nf-client-connection-ip': '9.9.9.9' }))).toBeUndefined();
  });

  it('reads an honest single hop, and nothing when there is no proxy', () => {
    expect(callerIpFromHeaders(h({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(callerIpFromHeaders(h({}))).toBeUndefined();
  });
});

describe('tickCaps', () => {
  const caps = perHourAndDay(2, 3);
  const t0 = new Date('2026-10-14T10:00:00Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);

  it('allows up to the hourly cap, then refuses', () => {
    let doc = tickCaps(undefined, 'k', t0, caps)!;
    doc = tickCaps(doc, 'k', at(1000), caps)!;
    expect(doc.windows[String(HOUR_MS)].count).toBe(2);
    expect(tickCaps(doc, 'k', at(2000), caps)).toBeNull();
  });

  it('a new hour opens the hourly cap but the daily cap still binds', () => {
    let doc = tickCaps(undefined, 'k', t0, caps)!;
    doc = tickCaps(doc, 'k', at(1000), caps)!;
    doc = tickCaps(doc, 'k', at(HOUR_MS + 1), caps)!;
    expect(doc).not.toBeNull();
    expect(tickCaps(doc, 'k', at(HOUR_MS + 2), caps)).toBeNull();
    expect(tickCaps(doc, 'k', at(DAY_MS + 1), caps)).not.toBeNull();
  });

  it('refuses while locked', () => {
    const locked = { ...tickCaps(undefined, 'k', t0, caps)!, lockedUntil: at(60_000) };
    expect(tickCaps(locked, 'k', at(1000), caps)).toBeNull();
    expect(tickCaps(locked, 'k', at(61_000), caps)).not.toBeNull();
  });

  it('writes Dates, never a Timestamp (AGENTS.md gotcha 8)', () => {
    const doc = tickCaps(undefined, 'k', t0, caps)!;
    expect(doc.updatedAt).toBeInstanceOf(Date);
    expect(doc.expiresAt).toBeInstanceOf(Date);
    expect(toMillis(doc.expiresAt)).toBe(t0.getTime() + DAY_MS);
  });
});

describe('tickFailure', () => {
  const t0 = new Date('2026-10-14T10:00:00Z');
  const lockedAt = (d: CapsCounterDoc, now: Date) => Boolean(d.lockedUntil && toMillis(d.lockedUntil) > now.getTime());

  it(`locks for 15 minutes on the ${FAILED_GUESS_HOURLY}th wrong code in an hour`, () => {
    let doc: CapsCounterDoc | undefined;
    for (let i = 0; i < FAILED_GUESS_HOURLY - 1; i += 1) doc = tickFailure(doc, new Date(t0.getTime() + i * 1000));
    expect(lockedAt(doc!, t0)).toBe(false);
    const now = new Date(t0.getTime() + 60_000);
    doc = tickFailure(doc, now);
    expect(toMillis(doc.lockedUntil!)).toBe(now.getTime() + FAILED_GUESS_LOCK_MS);
    expect(lockedAt(doc, new Date(now.getTime() + FAILED_GUESS_LOCK_MS + 1))).toBe(false);
  });

  it(`locks until the day window ends on the ${FAILED_GUESS_DAILY}th wrong code in a day`, () => {
    let doc: CapsCounterDoc | undefined;
    let now = t0;
    for (let i = 0; i < FAILED_GUESS_DAILY; i += 1) {
      now = new Date(t0.getTime() + i * 20 * 60_000);
      doc = tickFailure(doc, now);
    }
    expect(toMillis(doc!.lockedUntil!)).toBe(t0.getTime() + DAY_MS);
  });
});

describe('limitId', () => {
  it('hashes the value and folds case, so no raw address is stored', () => {
    expect(limitId('blog', 'email', 'Ed@Example.com')).toBe(limitId('blog', 'email', 'ed@example.com'));
    expect(limitId('blog', 'email', 'ed@example.com')).not.toContain('example');
    expect(limitId('blog', 'email', 'a@b.co')).not.toBe(limitId('ticket-pass', 'email', 'a@b.co'));
  });
});
