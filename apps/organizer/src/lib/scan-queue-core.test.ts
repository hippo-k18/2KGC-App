import { describe, expect, it } from 'vitest';
import {
  QUEUE_KEY,
  QUEUE_MAX_AGE_MS,
  enqueue,
  flushQueue,
  loadQueue,
  saveQueue,
  whenCheckedIn,
  withTimeout,
  type QueuedScan,
} from './scan-queue-core';

const scan = (id: string, queuedAt = Date.now()): QueuedScan => ({
  listId: 'event-door',
  code: `code-${id}`,
  deviceId: 'dev_1',
  clientScanId: id,
  stationLabel: 'Desk 1',
  source: 'typed',
  queuedAt,
});

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('the offline scan queue (T259 #1)', () => {
  it('keeps a scan once, by its clientScanId', () => {
    const q = enqueue(enqueue([], scan('a')), scan('a'));
    expect(q).toHaveLength(1);
  });

  it('survives a reload, and drops scans older than a day', () => {
    const store = memory();
    saveQueue(store, [scan('old', Date.now() - QUEUE_MAX_AGE_MS - 1), scan('new')]);
    expect(loadQueue(store).map((q) => q.clientScanId)).toEqual(['new']);
  });

  it('reads a corrupt or missing queue as empty', () => {
    const store = memory();
    expect(loadQueue(store)).toEqual([]);
    store.setItem(QUEUE_KEY, '{not json');
    expect(loadQueue(store)).toEqual([]);
    expect(loadQueue(null)).toEqual([]);
  });

  it('resends with the same clientScanId, oldest first, and stops at the first that fails again', async () => {
    const seen: string[] = [];
    const { remaining, sent } = await flushQueue(
      [scan('a'), scan('b'), scan('c')],
      async (q) => {
        seen.push(q.clientScanId);
        if (q.clientScanId === 'b') throw new Error('offline');
        return { ok: true };
      },
      () => ({ retry: false }),
    );
    expect(seen).toEqual(['a', 'b']);
    expect(sent.map((s) => s.scan.clientScanId)).toEqual(['a']);
    expect(remaining.map((q) => q.clientScanId)).toEqual(['b', 'c']);
  });

  it('keeps a scan the server could not finish', async () => {
    const { remaining } = await flushQueue(
      [scan('a')],
      async () => ({ error: 'unavailable', retryable: true }),
      (r) => ({ retry: Boolean(r.retryable) }),
    );
    expect(remaining).toHaveLength(1);
  });

  it('gives up waiting on a request that never answers', async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow('timeout');
    await expect(withTimeout(Promise.resolve(1), 1000)).resolves.toBe(1);
  });
});

describe('the time on an ALREADY CHECKED IN verdict (T259 #12)', () => {
  const tz = 'America/New_York';
  const now = new Date('2027-05-05T14:00:00Z');

  it('is just the time when it was today in New York', () => {
    expect(whenCheckedIn('2027-05-05T12:15:00Z', now, tz)).toBe('8:15 AM');
  });

  it('names the day when it was an earlier day', () => {
    expect(whenCheckedIn('2027-05-04T12:15:00Z', now, tz)).toBe('8:15 AM on Tue, May 4');
  });

  it('uses the venue clock, not UTC, to decide the day', () => {
    // 01:00 UTC on the 5th is 21:00 on the 4th in New York.
    expect(whenCheckedIn('2027-05-05T01:00:00Z', now, tz)).toMatch(/on Tue, May 4$/);
  });
});
