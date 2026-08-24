import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';
import fixture from './fixture.json';

/**
 * A tiny in-memory Firestore, so the dashboard runs with no database at all.
 *
 * Deployed to Netlify there is no emulator to reach and no service-account
 * credential to reach the real project with, so every screen died on its first
 * read. The options were an empty dashboard, a pile of per-screen mocks, or
 * this: implement the small slice of the Firestore API that `lib/data.ts` and
 * `lib/checkin.ts` actually use, and let every screen run its *real* query
 * logic against fixture data.
 *
 * The third is worth the extra work for one reason — the demo then exercises
 * the same code as production. The Session Manager's day bucketing, the
 * check-in list's default-by-id selection, the collection-group query behind
 * push targeting: all of it runs for real. A screen that works here works
 * against Firestore, because it is the same function.
 *
 * `fixture.json` is the seeded emulator exported verbatim: 72 sessions, 45
 * speakers, 50 attendees, 50 registrations. It was invented by
 * `scripts/src/seed-demo.ts` and reads as real prose on purpose; none of it is
 * real, and the dashboard says so on screen.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 *
 * Writes mutate this process's memory and nothing else. Netlify runs functions
 * across instances that do not share state and are recycled without warning, so
 * a check-in made here may be visible on the next request or may not, and is
 * certainly gone tomorrow. That is a genuinely bad property to hide, so
 * `isDemoMode()` is surfaced in the UI rather than left to be discovered.
 *
 * It is also not a Firestore implementation. It supports the operators these
 * two modules use — `==`, `in`, `array-contains` — plus `orderBy`, `limit`,
 * `count`, `collectionGroup` and subcollections. Anything else throws loudly,
 * because silently returning the wrong rows would be far worse than a stack
 * trace naming the unsupported call.
 */

type Row = { id: string; data: Record<string, unknown> };
interface Fixture {
  __sub: Record<string, Row[]>;
  [collection: string]: Row[] | Record<string, Row[]>;
}

const RAW = fixture as unknown as Fixture;

/** `{ __ts }` markers become something with the Timestamp methods we call. */
function reviveTimestamps(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(reviveTimestamps);
  const o = v as Record<string, unknown>;
  if (typeof o.__ts === 'string') {
    const d = new Date(o.__ts);
    return {
      toDate: () => d,
      toMillis: () => d.getTime(),
      // `seconds` appears in a couple of sort comparators.
      seconds: Math.floor(d.getTime() / 1000),
      isEqual: (other: { toMillis?: () => number }) => other?.toMillis?.() === d.getTime(),
    };
  }
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, reviveTimestamps(x)]));
}

/**
 * The mutable store, seeded once per process from the fixture.
 *
 * Module scope on purpose: within one warm function instance a check-in made on
 * one request is visible on the next, which is what makes the demo feel real
 * for the minute somebody is clicking through it.
 */
const store = new Map<string, Map<string, Record<string, unknown>>>();

function seed(): void {
  if (store.size > 0) return;
  for (const [name, rows] of Object.entries(RAW)) {
    if (name === '__sub' || !Array.isArray(rows)) continue;
    const m = new Map<string, Record<string, unknown>>();
    for (const r of rows) m.set(r.id, reviveTimestamps(r.data) as Record<string, unknown>);
    store.set(name, m);
  }
  for (const [path, rows] of Object.entries(RAW.__sub)) {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of rows) m.set(r.id, reviveTimestamps(r.data) as Record<string, unknown>);
    store.set(path, m);
  }
}

function coll(path: string): Map<string, Record<string, unknown>> {
  seed();
  let m = store.get(path);
  if (!m) {
    m = new Map();
    store.set(path, m);
  }
  return m;
}

type Filter = { field: string; op: string; value: unknown };

function get(data: Record<string, unknown>, field: string): unknown {
  return field.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], data);
}

function matches(data: Record<string, unknown>, f: Filter): boolean {
  const actual = get(data, f.field);
  switch (f.op) {
    case '==':
      return actual === f.value;
    case '!=':
      return actual !== f.value;
    case 'in':
      return Array.isArray(f.value) && (f.value as unknown[]).includes(actual);
    case 'array-contains':
      return Array.isArray(actual) && actual.includes(f.value);
    default:
      throw new Error(`demo store: unsupported query operator "${f.op}"`);
  }
}

function snapshotDoc(path: string, id: string, data: Record<string, unknown> | undefined) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
    ref: makeDocRef(path, id),
  };
}

function makeQuery(rows: () => { id: string; data: Record<string, unknown>; path: string }[]) {
  const filters: Filter[] = [];
  let order: { field: string; dir: 'asc' | 'desc' } | null = null;
  let cap: number | null = null;

  const run = () => {
    let out = rows().filter((r) => filters.every((f) => matches(r.data, f)));
    if (order) {
      const { field, dir } = order;
      out = [...out].sort((a, b) => {
        const x = get(a.data, field);
        const y = get(b.data, field);
        const xv = typeof (x as { toMillis?: () => number })?.toMillis === 'function'
          ? (x as { toMillis: () => number }).toMillis()
          : (x as number | string);
        const yv = typeof (y as { toMillis?: () => number })?.toMillis === 'function'
          ? (y as { toMillis: () => number }).toMillis()
          : (y as number | string);
        if (xv === yv) return 0;
        const cmp = xv > yv ? 1 : -1;
        return dir === 'desc' ? -cmp : cmp;
      });
    }
    if (cap !== null) out = out.slice(0, cap);
    return out;
  };

  const api = {
    where(field: string, op: string, value: unknown) {
      filters.push({ field, op, value });
      return api;
    },
    orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
      order = { field, dir };
      return api;
    },
    limit(n: number) {
      cap = n;
      return api;
    },
    count() {
      return { get: async () => ({ data: () => ({ count: run().length }) }) };
    },
    async get() {
      const found = run();
      return {
        empty: found.length === 0,
        size: found.length,
        docs: found.map((r) => snapshotDoc(r.path, r.id, r.data)),
      };
    },
  };
  return api;
}

function makeDocRef(collPath: string, id: string) {
  return {
    id,
    path: `${collPath}/${id}`,
    // `savedSessions` targeting walks up two levels to find the user.
    get parent() {
      return {
        id: collPath.split('/').pop(),
        get parent() {
          const parts = collPath.split('/');
          return parts.length >= 2 ? { id: parts[parts.length - 2] } : null;
        },
      };
    },
    collection: (sub: string) => makeCollection(`${collPath}/${id}/${sub}`),
    async get() {
      return snapshotDoc(collPath, id, coll(collPath).get(id));
    },
    async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
      const m = coll(collPath);
      m.set(id, opts?.merge ? { ...(m.get(id) ?? {}), ...data } : data);
    },
    async create(data: Record<string, unknown>) {
      const m = coll(collPath);
      if (m.has(id)) {
        // The idempotency contract the real check-in path depends on: a second
        // create must fail with this code, because that failure *is* the
        // duplicate detection.
        const err = new Error('already exists') as Error & { code: number | string };
        err.code = 6;
        throw err;
      }
      m.set(id, { ...data, __createdAt: new Date() });
    },
    async update(data: Record<string, unknown>) {
      const m = coll(collPath);
      m.set(id, { ...(m.get(id) ?? {}), ...data });
    },
    async delete() {
      coll(collPath).delete(id);
    },
  };
}

function makeCollection(path: string) {
  const q = makeQuery(() =>
    [...coll(path).entries()].map(([id, data]) => ({ id, data, path })),
  );
  return {
    ...q,
    doc: (id?: string) => makeDocRef(path, id ?? `demo_${Math.random().toString(36).slice(2, 12)}`),
    async add(data: Record<string, unknown>) {
      const id = `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      coll(path).set(id, data);
      return makeDocRef(path, id);
    },
  };
}

/** Firestore's `FieldValue.serverTimestamp()` lands here as an opaque object. */
function stamp(): Date {
  return new Date();
}

export function demoFirestore(): Firestore {
  seed();
  const api = {
    collection: (name: string) => makeCollection(name),
    collectionGroup: (name: string) =>
      makeQuery(() => {
        const out: { id: string; data: Record<string, unknown>; path: string }[] = [];
        for (const [path, m] of store.entries()) {
          if (!path.endsWith(`/${name}`)) continue;
          for (const [id, data] of m.entries()) out.push({ id, data, path });
        }
        return out;
      }),
    settings: () => undefined,
    batch: () => ({
      set: () => undefined,
      update: () => undefined,
      delete: () => undefined,
      commit: async () => [stamp()],
    }),
  };
  return api as unknown as Firestore;
}

/**
 * True when this process has no way to reach a real Firestore.
 *
 * Not a feature flag anyone sets — it is derived, so the demo turns itself off
 * the moment credentials appear rather than needing to be remembered.
 */
export function isDemoMode(): boolean {
  if (process.env.FIRESTORE_EMULATOR_HOST) return false;
  return !(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT);
}
