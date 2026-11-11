/**
 * The scanner's offline queue, with no React and no browser globals, so it can
 * be tested.
 *
 * A scan that fails in transit (venue wifi drops, the server is unreachable)
 * used to show nothing, and the previous person's green verdict stayed on
 * screen (T259 #1). Now the scan is kept on the device and sent again with the
 * SAME `clientScanId`. The server writes `scanEvents/{deviceId}_{clientScanId}`
 * with `create()` and keys the check-in by registration, so a resend of a scan
 * that did land is a replay, never a second check-in.
 */

export interface QueuedScan {
  listId: string;
  code: string;
  deviceId: string;
  clientScanId: string;
  stationLabel: string;
  source: 'camera' | 'typed';
  /** When the scan was first tried, ms since epoch. */
  queuedAt: number;
}

export const QUEUE_KEY = 'kgc.console.checkin.queue';

/** A scan older than this is not resent: the person has long since been dealt with by hand. */
export const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isQueuedScan(v: unknown): v is QueuedScan {
  const q = v as QueuedScan;
  return (
    !!q &&
    typeof q.listId === 'string' &&
    typeof q.code === 'string' &&
    typeof q.deviceId === 'string' &&
    typeof q.clientScanId === 'string' &&
    typeof q.queuedAt === 'number'
  );
}

export function loadQueue(storage: StorageLike | null, now = Date.now()): QueuedScan[] {
  try {
    const raw = storage?.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueuedScan).filter((q) => now - q.queuedAt < QUEUE_MAX_AGE_MS);
  } catch {
    return [];
  }
}

export function saveQueue(storage: StorageLike | null, queue: QueuedScan[]): void {
  try {
    storage?.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Private mode or a full disk. The in-memory queue still resends.
  }
}

/** Add a scan, once. Queuing the same `clientScanId` twice is a no-op. */
export function enqueue(queue: QueuedScan[], scan: QueuedScan): QueuedScan[] {
  return queue.some((q) => q.clientScanId === scan.clientScanId) ? queue : [...queue, scan];
}

/** What the server said about a scan, reduced to what the queue needs. */
export interface SendOutcome {
  /** True when the scan did not reach a verdict and should be kept. */
  retry: boolean;
}

/**
 * Send queued scans oldest first, stopping at the first one that fails again:
 * if that one cannot get through, the rest will not either, and order matters
 * for whoever reads the scan log.
 */
export async function flushQueue<R>(
  queue: QueuedScan[],
  send: (scan: QueuedScan) => Promise<R>,
  classify: (result: R) => SendOutcome,
): Promise<{ remaining: QueuedScan[]; sent: { scan: QueuedScan; result: R }[] }> {
  const sent: { scan: QueuedScan; result: R }[] = [];
  let i = 0;
  for (; i < queue.length; i++) {
    let result: R;
    try {
      result = await send(queue[i]);
    } catch {
      break;
    }
    if (classify(result).retry) break;
    sent.push({ scan: queue[i], result });
  }
  return { remaining: queue.slice(i), sent };
}

/** Reject after `ms`, so a request on a wifi that connects but carries nothing does not hang the desk. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * When somebody was first checked in, for the duplicate verdict.
 *
 * Just the time on the same day. On an earlier day the date too, because
 * "Already checked in at 08:15" on day three reads as "somebody used your code
 * this morning" (T259 #12).
 */
export function whenCheckedIn(iso: string | undefined, now: Date, timeZone: string): string {
  if (!iso) return '-';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '-';
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone });
  const clock = at.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  if (day(at) === day(now)) return clock;
  const date = at.toLocaleDateString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' });
  return `${clock} on ${date}`;
}
