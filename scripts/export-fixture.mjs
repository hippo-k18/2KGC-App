/**
 * Export a seeded emulator into `apps/organizer/src/lib/demo/fixture.json`.
 *
 * ── Why this script exists ──────────────────────────────────────────────────
 *
 * The fixture is what the dashboard serves when it is deployed with no database
 * to reach — see `apps/organizer/src/lib/demo/store.ts`. It was produced by hand
 * once and then went stale: by August 2026 it held 17 collections while the seed
 * wrote 26, so nine screens rendered their empty state on the deployed site
 * while working perfectly against the emulator. That is the worst possible
 * shape of stale, because it looks like the screen is broken rather than like
 * the data is missing.
 *
 * Run it with the emulator up and seeded:
 *
 *   npm run dev:emulators          # in one terminal
 *   npm run seed                   # in another
 *   node scripts/export-fixture.mjs
 *
 * ── The Timestamp encoding is the only subtle part ──────────────────────────
 *
 * `store.ts` revives `{ __ts: "..." }` into an object with `toDate()`,
 * `toMillis()` and `seconds`, because that is the slice of the Timestamp API
 * the dashboard's read paths actually call. So every Firestore Timestamp has to
 * be written in exactly that shape — a bare ISO string would reach a
 * `.toDate()` call and throw.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'kgc-database';

process.env.FIRESTORE_EMULATOR_HOST = HOST;

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');

initializeApp({ projectId: PROJECT });
const db = getFirestore();

/**
 * Firestore values → JSON the fixture can hold.
 *
 * Timestamps become `{ __ts }`; everything else passes through. `DocumentRef`
 * and `GeoPoint` are not used anywhere in this data model, so hitting one is a
 * genuine surprise rather than something to silently stringify.
 */
function encode(value) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Timestamp) return { __ts: value.toDate().toISOString() };
  if (value instanceof Date) return { __ts: value.toISOString() };
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  }
  return value;
}

const out = { __sub: {} };
let docCount = 0;
let subCount = 0;

/**
 * Subcollections are keyed by their full path, exactly as `store.ts` looks them
 * up — `sessions/{id}/questions`, not `questions`. Two sessions' questions must
 * not share a bucket, and a collection-group query in the dashboard walks these
 * keys by suffix.
 */
async function exportSubcollections(docRef) {
  for (const sub of await docRef.listCollections()) {
    const path = `${docRef.path}/${sub.id}`;
    const snap = await sub.get();
    if (snap.empty) continue;

    out.__sub[path] = snap.docs.map((d) => ({ id: d.id, data: encode(d.data()) }));
    subCount += snap.size;

    // One level deeper is real here: sessions/{id}/polls/{id}/votes.
    for (const d of snap.docs) await exportSubcollections(d.ref);
  }
}

const collections = await db.listCollections();
collections.sort((a, b) => a.id.localeCompare(b.id));

for (const c of collections) {
  const snap = await c.get();
  if (snap.empty) continue;

  out[c.id] = snap.docs.map((d) => ({ id: d.id, data: encode(d.data()) }));
  docCount += snap.size;

  for (const d of snap.docs) await exportSubcollections(d.ref);
}

const target = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'organizer',
  'src',
  'lib',
  'demo',
  'fixture.json',
);

if (docCount === 0) {
  // Writing an empty fixture would replace a working demo with a blank one, and
  // the commonest cause is running this against an emulator nobody seeded.
  console.error(
    'Nothing was exported — the emulator at ' +
      HOST +
      ' is empty. Run `npm run seed` first; refusing to overwrite the fixture.',
  );
  process.exit(1);
}

writeFileSync(target, JSON.stringify(out, null, 2) + '\n');

const names = Object.keys(out).filter((k) => k !== '__sub');
console.log(`${names.length} collections, ${docCount} documents, ${subCount} in subcollections`);
console.log(names.join(', '));
console.log(`→ ${target}`);
