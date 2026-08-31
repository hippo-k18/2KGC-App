/**
 * Tests for the denormalisation fan-out — the writer that keeps `SessionDoc`'s
 * display caches in step with the speaker, track and room documents they were
 * copied from.
 *
 * These run against the **Firestore emulator with the Admin SDK**, in the same
 * shape as `tests/commerce/fulfilment.test.ts`. A fake store would not do: the
 * things most likely to be wrong here are a batch that silently exceeds its
 * limit, an `update()` on a missing document, an `array-contains` query that
 * needs an index nobody deployed, and a `FieldValue.delete()` that clears a
 * field. All four are properties of Firestore, not of the code around it.
 *
 * ⚠️ Note `sentinels` being passed in on every call. The module builds its
 * sentinels from `apps/organizer`'s own `firebase-admin`; this suite's store
 * comes from the *root* copy, and Firestore validates sentinels with
 * `instanceof`, so the two do not mix. That is the August 2026 outage, and this
 * suite is the reason there is a seam for it — see `AGENTS.md` gotcha 8.
 *
 * Each test is named after the guarantee it protects.
 *
 * Run with: npm run test:denormalise
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type SessionDoc } from '@kgc/shared';

import {
  fanOutRoomRename,
  fanOutSpeakerRename,
  fanOutTrackChange,
  reconcileSessionCaches,
  summariseFanOut,
  type WriteSentinels,
} from '../../apps/organizer/src/lib/denormalise';

/**
 * Refuse to run against anything real. These tests rewrite the agenda's caches
 * and then assert on them; pointed at the live project by a stray environment
 * variable they would rewrite the actual programme.
 */
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

let db: Firestore;

/** The root copy's sentinels, matching the store built below. See the docblock. */
const sentinels: WriteSentinels = {
  serverTimestamp: () => FieldValue.serverTimestamp(),
  delete: () => FieldValue.delete(),
};

beforeAll(() => {
  if (!EMULATOR) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. These tests write real documents and must ' +
        'never run against the live project. Use: npm run test:denormalise',
    );
  }
  if (!getApps().length) initializeApp({ projectId: 'kgc-conference-app-and-website' });
  db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
});

async function clear(collection: string) {
  const snap = await db.collection(collection).where('eventId', '==', EVENT_ID).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  await Promise.all([
    clear(COLLECTIONS.sessions),
    clear(COLLECTIONS.speakers),
    clear(COLLECTIONS.tracks),
    clear(COLLECTIONS.rooms),
  ]);
});

// ---------------------------------------------------------------------------
// Fixtures — shaped exactly like `seed-demo.ts` writes them, because "a fresh
// seed is a no-op" is one of the guarantees under test.
// ---------------------------------------------------------------------------

const base = () => ({ eventId: EVENT_ID, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });

async function putSession(id: string, over: Partial<SessionDoc> = {}) {
  await db
    .collection(COLLECTIONS.sessions)
    .doc(id)
    .set({
      ...base(),
      title: id,
      timeZone: 'America/New_York',
      startsAtLocal: '2027-05-05T09:00',
      endsAtLocal: '2027-05-05T10:00',
      startsAt: Timestamp.fromDate(new Date('2027-05-05T13:00:00Z')),
      endsAt: Timestamp.fromDate(new Date('2027-05-05T14:00:00Z')),
      day: '2027-05-05',
      trackIds: [],
      format: 'talk',
      speakerIds: [],
      tags: [],
      status: 'published',
      sequence: 0,
      stableGuid: `guid-${id}`,
      qaEnabled: true,
      pollsEnabled: false,
      ...over,
    });
}

const putSpeaker = (id: string, name: string) =>
  db.collection(COLLECTIONS.speakers).doc(id).set({ ...base(), name, sessionIds: [] });

const putTrack = (id: string, name: string, color?: string) =>
  db.collection(COLLECTIONS.tracks).doc(id).set({ ...base(), name, color });

const putRoom = (id: string, name: string) =>
  db.collection(COLLECTIONS.rooms).doc(id).set({ ...base(), name });

async function read(id: string): Promise<SessionDoc> {
  const doc = await db.collection(COLLECTIONS.sessions).doc(id).get();
  return doc.data() as SessionDoc;
}

// ---------------------------------------------------------------------------

describe('fanOutSpeakerRename', () => {
  it('rewrites the cached name on every session the speaker is on', async () => {
    await putSpeaker('sp1', 'Ada Nakamura');
    await putSession('s1', { speakerIds: ['sp1'], speakerNames: ['Ada Nakamura'] });
    await putSession('s2', { speakerIds: ['sp1'], speakerNames: ['Ada Nakamura'] });
    await putSession('s3', { speakerIds: ['sp2'], speakerNames: ['Someone Else'] });

    const result = await fanOutSpeakerRename(db, 'sp1', 'Ada Nakamura-Reyes', { sentinels });

    expect(result.ok).toBe(true);
    expect(result.scanned).toBe(2);
    expect(result.updated.sort()).toEqual(['s1', 's2']);
    expect((await read('s1')).speakerNames).toEqual(['Ada Nakamura-Reyes']);
    expect((await read('s2')).speakerNames).toEqual(['Ada Nakamura-Reyes']);
    // Untouched, and specifically not scanned — the query, not a filter, is what
    // keeps a rename off unrelated sessions.
    expect((await read('s3')).speakerNames).toEqual(['Someone Else']);
  });

  it('replaces in place, so the billing order survives a rename', async () => {
    await putSession('s1', {
      speakerIds: ['sp1', 'sp2', 'sp3'],
      speakerNames: ['First Author', 'Middle Author', 'Last Author'],
    });

    await fanOutSpeakerRename(db, 'sp2', 'Renamed Middle', { sentinels });

    // The whole point: not sorted, not deduped, not rebuilt — index 1 and only
    // index 1. `speakerNames[i]` must still describe `speakerIds[i]`.
    expect((await read('s1')).speakerNames).toEqual(['First Author', 'Renamed Middle', 'Last Author']);
  });

  it('rewrites every position when the same speaker is billed twice', async () => {
    await putSession('s1', {
      speakerIds: ['sp1', 'sp2', 'sp1'],
      speakerNames: ['Old', 'Other', 'Old'],
    });

    await fanOutSpeakerRename(db, 'sp1', 'New', { sentinels });

    expect((await read('s1')).speakerNames).toEqual(['New', 'Other', 'New']);
  });

  it('leaves a namesake alone — it matches on id, never on the cached name', async () => {
    await putSession('s1', { speakerIds: ['sp1', 'sp2'], speakerNames: ['Jan Novak', 'Jan Novak'] });

    await fanOutSpeakerRename(db, 'sp1', 'Jan Novak (Charles University)', { sentinels });

    expect((await read('s1')).speakerNames).toEqual(['Jan Novak (Charles University)', 'Jan Novak']);
  });

  it('is idempotent: the second run writes nothing at all', async () => {
    await putSession('s1', { speakerIds: ['sp1'], speakerNames: ['Old Name'] });

    const first = await fanOutSpeakerRename(db, 'sp1', 'New Name', { sentinels });
    const before = (await read('s1')).updatedAt;

    const second = await fanOutSpeakerRename(db, 'sp1', 'New Name', { sentinels });

    expect(first.updated).toEqual(['s1']);
    expect(second.updated).toEqual([]);
    expect(second.unchanged).toEqual(['s1']);
    // No write at all, not merely a write with the same value: `updatedAt` is
    // what would move if this were re-writing an identical patch every time.
    expect((await read('s1')).updatedAt.isEqual(before)).toBe(true);
  });

  it('refuses to guess when the two arrays are misaligned, and says so', async () => {
    // The seed's `.filter(Boolean)` produces exactly this if a speaker document
    // is missing: three ids, two names, no way to know which one is whose.
    await putSession('s1', { speakerIds: ['sp1', 'sp2', 'sp3'], speakerNames: ['A', 'B'] });

    const result = await fanOutSpeakerRename(db, 'sp2', 'Renamed', { sentinels });

    expect(result.needsReconcile).toEqual(['s1']);
    expect(result.updated).toEqual([]);
    expect((await read('s1')).speakerNames).toEqual(['A', 'B']);
    expect(summariseFanOut(result)).toContain('need a reconcile');
  });

  it('dry-run reports the blast radius without touching anything', async () => {
    await putSession('s1', { speakerIds: ['sp1'], speakerNames: ['Old'] });

    const result = await fanOutSpeakerRename(db, 'sp1', 'New', { sentinels, dryRun: true });

    expect(result.updated).toEqual(['s1']);
    expect((await read('s1')).speakerNames).toEqual(['Old']);
  });
});

describe('fanOutTrackChange', () => {
  it('rewrites name and colour on the sessions whose primary track it is', async () => {
    await putSession('s1', {
      trackIds: ['t1'],
      primaryTrackName: 'SEO',
      primaryTrackColor: '#ca8a04',
    });

    const result = await fanOutTrackChange(db, 't1', { name: 'Search', color: '#111111' }, { sentinels });

    expect(result.updated).toEqual(['s1']);
    const s1 = await read('s1');
    expect(s1.primaryTrackName).toBe('Search');
    expect(s1.primaryTrackColor).toBe('#111111');
  });

  it('leaves a cross-listed session alone, because only the primary track is cached', async () => {
    // `trackIds[0]` is the primary track — both the seed and the importer agree.
    await putSession('s1', {
      trackIds: ['t9', 't1'],
      primaryTrackName: 'Ontologies',
      primaryTrackColor: '#dc2626',
    });

    const result = await fanOutTrackChange(db, 't1', { name: 'Search', color: '#111111' }, { sentinels });

    expect(result.scanned).toBe(1);
    expect(result.updated).toEqual([]);
    expect(result.unchanged).toEqual(['s1']);
    expect((await read('s1')).primaryTrackName).toBe('Ontologies');
  });

  it('clears the cached colour when the track loses its colour', async () => {
    await putSession('s1', { trackIds: ['t1'], primaryTrackName: 'SEO', primaryTrackColor: '#ca8a04' });

    await fanOutTrackChange(db, 't1', { name: 'SEO' }, { sentinels });

    const s1 = await read('s1');
    // Deleted, not left behind and not written as null — an absent optional
    // field is the shape every reader already falls back on.
    expect('primaryTrackColor' in s1).toBe(false);
    expect(s1.primaryTrackName).toBe('SEO');
  });

  it('is idempotent, including the colour deletion', async () => {
    await putSession('s1', { trackIds: ['t1'], primaryTrackName: 'SEO', primaryTrackColor: '#ca8a04' });

    await fanOutTrackChange(db, 't1', { name: 'SEO' }, { sentinels });
    const second = await fanOutTrackChange(db, 't1', { name: 'SEO' }, { sentinels });

    expect(second.updated).toEqual([]);
    expect(second.unchanged).toEqual(['s1']);
  });
});

describe('fanOutRoomRename', () => {
  it('rewrites the room name an attendee walks to', async () => {
    await putSession('s1', { roomId: 'r1', roomName: 'Tata Innovation Center 131' });
    await putSession('s2', { roomId: 'r2', roomName: 'Bloomberg 165' });

    const result = await fanOutRoomRename(db, 'r1', 'Verizon Executive Education Center', { sentinels });

    expect(result.updated).toEqual(['s1']);
    expect((await read('s1')).roomName).toBe('Verizon Executive Education Center');
    expect((await read('s2')).roomName).toBe('Bloomberg 165');
  });

  it('is idempotent', async () => {
    await putSession('s1', { roomId: 'r1', roomName: 'Old Hall' });

    await fanOutRoomRename(db, 'r1', 'New Hall', { sentinels });
    const second = await fanOutRoomRename(db, 'r1', 'New Hall', { sentinels });

    expect(second.unchanged).toEqual(['s1']);
    expect(second.updated).toEqual([]);
  });
});

/** 600 sessions in one room. More than one batch by design — see below. */
async function seedBulk(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `bulk-${String(i).padStart(3, '0')}`);
  for (let i = 0; i < ids.length; i += 400) {
    const batch = db.batch();
    for (const id of ids.slice(i, i + 400)) {
      batch.set(db.collection(COLLECTIONS.sessions).doc(id), {
        ...base(),
        title: id,
        timeZone: 'America/New_York',
        startsAtLocal: '2027-05-05T09:00',
        endsAtLocal: '2027-05-05T10:00',
        startsAt: Timestamp.now(),
        endsAt: Timestamp.now(),
        day: '2027-05-05',
        roomId: 'r1',
        roomName: 'Old Hall',
        trackIds: [],
        format: 'talk',
        speakerIds: [],
        tags: [],
        status: 'published',
        sequence: 0,
        stableGuid: id,
        qaEnabled: true,
        pollsEnabled: false,
      });
    }
    await batch.commit();
  }
  return ids;
}

/**
 * The real store with `batch()` wrapped so chosen commits throw.
 *
 * There is no way to make the emulator fail a commit on demand, and the
 * behaviour under test is entirely on this side of the wire: what the fan-out
 * *records* when one chunk of a multi-chunk write does not land.
 */
function withFailingBatch(real: Firestore, failOn: (n: number) => boolean): Firestore {
  let n = 0;
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'batch') {
        return () => {
          const inner = target.batch();
          const index = n++;
          return new Proxy(inner, {
            get(bt, bp) {
              if (bp === 'commit') {
                return async () => {
                  if (failOn(index)) throw new Error(`emulated commit failure on batch ${index}`);
                  return bt.commit();
                };
              }
              const v = Reflect.get(bt, bp) as unknown;
              return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(bt) : v;
            },
          });
        };
      }
      const v = Reflect.get(target, prop, receiver) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as Firestore;
}

describe('chunking and partial failure', () => {
  it('writes past a single batch — 600 sessions is more than Firestore allows in one commit', async () => {
    // The bug this catches is the one that "worked with 60 sessions and failed
    // at 600". 600 > the 500-write batch ceiling, so an unchunked commit throws.
    await seedBulk(600);

    const result = await fanOutRoomRename(db, 'r1', 'New Hall', { sentinels });

    expect(result.ok).toBe(true);
    expect(result.updated.length).toBe(600);
    expect((await read('bulk-000')).roomName).toBe('New Hall');
    expect((await read('bulk-599')).roomName).toBe('New Hall');
  }, 60_000);

  it('names every session a failed batch left stale, and still commits the rest', async () => {
    // A half-applied rename is the failure mode this whole module exists to
    // avoid. It cannot always be avoided — a batch can fail — so the next best
    // thing is that it is never silent: `ok` is false, the stale ids are listed
    // by name, and the batches after the failure are attempted anyway rather
    // than abandoning 200 sessions because of the 400 before them.
    await seedBulk(600);

    const result = await fanOutRoomRename(withFailingBatch(db, (n) => n === 0), 'r1', 'New Hall', {
      sentinels,
    });

    expect(result.ok).toBe(false);
    expect(result.failed.length).toBe(400);
    expect(result.updated.length).toBe(200);
    expect(result.errors).toEqual(['emulated commit failure on batch 0']);
    expect(summariseFanOut(result)).toContain('FAILED');
    expect((await read('bulk-000')).roomName).toBe('Old Hall');
    expect((await read('bulk-599')).roomName).toBe('New Hall');
  }, 60_000);
});

describe('reconcileSessionCaches', () => {
  it('is a no-op on data written the way the seed writes it', async () => {
    // The guarantee that makes reconcile safe to run at any time, and the test
    // that catches this module and `seed-demo.ts` drifting apart.
    await putSpeaker('sp1', 'Ada Nakamura');
    await putSpeaker('sp2', 'Jan Novak');
    await putTrack('t1', 'Graph Data Science', '#059669');
    await putRoom('r1', 'Tata Innovation Center 131');
    await putSession('s1', {
      speakerIds: ['sp1', 'sp2'],
      speakerNames: ['Ada Nakamura', 'Jan Novak'],
      trackIds: ['t1'],
      primaryTrackName: 'Graph Data Science',
      primaryTrackColor: '#059669',
      roomId: 'r1',
      roomName: 'Tata Innovation Center 131',
    });

    const result = await reconcileSessionCaches(db, { sentinels });

    expect(result.updated).toEqual([]);
    expect(result.unchanged).toEqual(['s1']);
    expect(result.dangling).toEqual([]);
  });

  it('rebuilds all four caches when every one of them has drifted', async () => {
    await putSpeaker('sp1', 'Ada Nakamura-Reyes');
    await putTrack('t1', 'Graph Data Science', '#059669');
    await putRoom('r1', 'Verizon Executive Education Center');
    await putSession('s1', {
      speakerIds: ['sp1'],
      speakerNames: ['Ada Nakamura'],
      trackIds: ['t1'],
      primaryTrackName: 'Graphs',
      primaryTrackColor: '#000000',
      roomId: 'r1',
      roomName: 'Tata Innovation Center 131',
    });

    const result = await reconcileSessionCaches(db, { sentinels });

    expect(result.updated).toEqual(['s1']);
    const s1 = await read('s1');
    expect(s1.speakerNames).toEqual(['Ada Nakamura-Reyes']);
    expect(s1.primaryTrackName).toBe('Graph Data Science');
    expect(s1.primaryTrackColor).toBe('#059669');
    expect(s1.roomName).toBe('Verizon Executive Education Center');
  });

  it('repairs the misalignment the fan-out refuses to touch, in speakerIds order', async () => {
    await putSpeaker('sp1', 'First');
    await putSpeaker('sp2', 'Second');
    await putSpeaker('sp3', 'Third');
    await putSession('s1', { speakerIds: ['sp1', 'sp2', 'sp3'], speakerNames: ['stale', 'junk'] });

    await reconcileSessionCaches(db, { sentinels });

    expect((await read('s1')).speakerNames).toEqual(['First', 'Second', 'Third']);
  });

  it('keeps a room name it cannot re-resolve, because it is the app\'s only wayfinding data', async () => {
    // No `rooms` block exists in firestore.rules, so the attendee app cannot read
    // the room document. Blanking the cache turns a stale room name into no room
    // name — strictly worse for somebody trying to find the talk.
    await putSession('s1', { roomId: 'deleted-room', roomName: 'Tata Innovation Center 131' });

    const result = await reconcileSessionCaches(db, { sentinels });

    expect((await read('s1')).roomName).toBe('Tata Innovation Center 131');
    expect(result.dangling).toEqual([`s1 → ${COLLECTIONS.rooms}/deleted-room`]);
    expect(result.updated).toEqual([]);
  });

  it('clears a room name when the session genuinely has no room', async () => {
    // The other half of the rule: an existing source is authoritative in what it
    // omits. No `roomId` at all is an answer, not an absence of one.
    await putSession('s1', { roomName: 'Tata Innovation Center 131' });

    await reconcileSessionCaches(db, { sentinels });

    expect('roomName' in (await read('s1'))).toBe(false);
  });

  it('clears a track colour the track no longer has, but not one it cannot look up', async () => {
    await putTrack('t1', 'SEO');
    await putSession('s1', { trackIds: ['t1'], primaryTrackName: 'SEO', primaryTrackColor: '#ca8a04' });
    await putSession('s2', { trackIds: ['gone'], primaryTrackName: 'Ghost', primaryTrackColor: '#123456' });

    const result = await reconcileSessionCaches(db, { sentinels });

    expect('primaryTrackColor' in (await read('s1'))).toBe(false);
    expect((await read('s2')).primaryTrackColor).toBe('#123456');
    expect(result.dangling).toEqual([`s2 → ${COLLECTIONS.tracks}/gone`]);
  });

  it('keeps the last known name of a speaker whose document is gone, and reports it', async () => {
    await putSpeaker('sp1', 'Ada Nakamura');
    await putSession('s1', { speakerIds: ['sp1', 'sp-gone'], speakerNames: ['Ada Nakamura', 'Jan Novak'] });

    const result = await reconcileSessionCaches(db, { sentinels });

    expect((await read('s1')).speakerNames).toEqual(['Ada Nakamura', 'Jan Novak']);
    expect(result.dangling).toEqual([`s1 → ${COLLECTIONS.speakers}/sp-gone`]);
  });

  it('is idempotent — a repair run twice repairs nothing the second time', async () => {
    await putSpeaker('sp1', 'Correct Name');
    await putRoom('r1', 'Correct Room');
    await putSession('s1', {
      speakerIds: ['sp1'],
      speakerNames: ['Wrong Name'],
      roomId: 'r1',
      roomName: 'Wrong Room',
    });

    const first = await reconcileSessionCaches(db, { sentinels });
    const stamp = (await read('s1')).updatedAt;
    const second = await reconcileSessionCaches(db, { sentinels });

    expect(first.updated).toEqual(['s1']);
    expect(second.updated).toEqual([]);
    expect(second.unchanged).toEqual(['s1']);
    expect((await read('s1')).updatedAt.isEqual(stamp)).toBe(true);
  });

  it('ignores another event\'s sessions', async () => {
    await db.collection(COLLECTIONS.sessions).doc('other').set({
      ...base(),
      eventId: 'some-other-event',
      title: 'Not ours',
      timeZone: 'America/New_York',
      startsAtLocal: '2027-05-05T09:00',
      endsAtLocal: '2027-05-05T10:00',
      startsAt: Timestamp.now(),
      endsAt: Timestamp.now(),
      day: '2027-05-05',
      trackIds: [],
      format: 'talk',
      speakerIds: [],
      speakerNames: ['stale'],
      tags: [],
      status: 'published',
      sequence: 0,
      stableGuid: 'other',
      qaEnabled: true,
      pollsEnabled: false,
    });

    const result = await reconcileSessionCaches(db, { sentinels });

    expect(result.scanned).toBe(0);
    const doc = await db.collection(COLLECTIONS.sessions).doc('other').get();
    expect((doc.data() as SessionDoc).speakerNames).toEqual(['stale']);
    await doc.ref.delete();
  });
});

describe('the three copies of firebase-admin', () => {
  it('rejects a sentinel built by a different copy — the seam is load-bearing, not decoration', async () => {
    await putSession('s1', { roomId: 'r1', roomName: 'Old Hall' });

    // No `sentinels`, so the module falls back to `apps/organizer`'s own
    // `firebase-admin`. This suite's store came from the root copy, and
    // Firestore validates sentinels with `instanceof`. This is exactly the
    // failure that took the purchase flow down in August 2026, reproduced.
    const result = await fanOutRoomRename(db, 'r1', 'New Hall');

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/not a valid Firestore|serialize/i);
    expect((await read('s1')).roomName).toBe('Old Hall');
  });
});

if (getApps().length) {
  // Vitest keeps the process alive on an open gRPC channel otherwise.
  process.on('beforeExit', () => {
    void Promise.all(getApps().map((a) => deleteApp(a)));
  });
}
