/**
 * Replaces the invented roster and agenda with the real KGC speakers.
 *
 *   npm run rebuild:programme                    # dry run — prints, writes nothing
 *   npm run rebuild:programme -- --confirm-live  # actually does it
 *
 * ## What this does, in order
 *
 *   1. Deletes all 45 seeded speakers and their generated avatars in Storage.
 *   2. Deletes all 72 seeded sessions.
 *   3. Writes the 11 real KGC tracks, replacing the invented ones.
 *   4. Imports the 137 real KGC 2026 speakers from `speakers-2026.ts`.
 *   5. Uploads their 124 real portraits to Storage and sets `photoURL`.
 *   6. Writes a fabricated five-day programme built on the real timetable, and
 *      joins every speaker to at least one session.
 *
 * ## Why it is one command and not six
 *
 * Steps 1 and 2 cannot be separated from 4 and 6, and that is the whole reason
 * this script exists rather than a sequence of smaller ones. Every seeded
 * session points at seeded speakers through `speakerIds`, and every seeded
 * speaker points back through `sessionIds`. Delete either side alone and the
 * agenda renders sessions presented by nobody, or a speaker profile claims
 * talks that no longer exist — and the app has no cascade and no referential
 * integrity to catch it. `import-speakers-2026.ts` declines to prune for
 * exactly this reason; it is a safe import *because* it leaves the wreckage
 * alone. This command owns both sides of the join at once, which is the only
 * way the swap is atomic in any sense that matters.
 *
 * ## ⚠️ What is real and what is invented
 *
 * The 137 speakers, their employers, their job titles and their photographs are
 * **real** — scraped from Whova's public speaker API for the actual Knowledge
 * Graph Conference 2026. The eleven tracks and the five-day timetable are
 * **real**, scraped from knowledgegraph.tech. The session titles, the
 * abstracts, and the question of who presents what are **fabricated**, at the
 * owner's explicit instruction.
 *
 * That means this writes real people's names onto talks they never gave. Every
 * session it creates carries `provenance: 'fabricated'` so that fact stays
 * discoverable; `programme-2026.ts` holds the full argument and the one
 * restriction that follows from it — this is demo data behind a sign-in, not
 * something to publish to the open web as a real programme.
 *
 * ## Re-running it
 *
 * Idempotent. Speaker ids come from `speakerId(name, company)` and session ids
 * from `sessionId(title, startsAtLocal)`, both derived, so a second run updates
 * the same documents. The deletes in steps 1 and 2 are scoped to *seeded*
 * documents — matched by id against what `fixtures.ts` would generate — so
 * re-running after a successful run deletes nothing and rewrites everything.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { COLLECTIONS, EVENT_ID, TIME_ZONE } from '@kgc/shared';
import { getStorage } from 'firebase-admin/storage';

import { commitAll, db, targetDescription, type PendingWrite } from './lib/firestore.js';
import { makeSessions, makeSpeakers, ROOMS } from './lib/fixtures.js';
import { roomId, sessionId, speakerId, trackId } from './lib/ids.js';
import {
  assertEveryoneScheduled,
  buildProgramme,
  KGC_TRACKS,
} from './lib/programme-2026.js';
import { SPEAKERS_2026 } from './lib/speakers-2026.js';
import { deriveTimes } from './lib/time.js';

const args = process.argv.slice(2);
const live = args.includes('--confirm-live');

/** Matches `SPEAKER_COUNT` in `seed-demo.ts` — the roster being removed. */
const SEEDED_SPEAKER_COUNT = 45;

/**
 * Where the 124 real portraits already live on disk.
 *
 * They were downloaded when the roster was scraped and checked into the
 * website's `public/`, which is why nothing here fetches from an upstream host:
 * two of the original URLs were expired LinkedIn CDN links that already 403'd
 * at scrape time, and re-fetching would reintroduce that failure.
 */
const PORTRAIT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/web/public/kgc/speakers',
);

function bucketName(): string {
  const projectId = process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website';
  return process.env.FIREBASE_STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`;
}

/**
 * The host in this URL is load-bearing, not cosmetic.
 *
 * `firestore.rules`' `isFirebaseStorageUrl()` and `mirror-directory.ts` both
 * require `firebasestorage.googleapis.com` exactly, and a URL built any other
 * way is silently dropped from the attendee directory. Same construction as
 * `apps/organizer/src/lib/uploads.ts`, which cannot be imported from here.
 */
function downloadUrl(objectPath: string, token: string): string {
  const emulator = (
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? process.env.STORAGE_EMULATOR_HOST
  )?.replace(/^https?:\/\//, '');
  const origin = emulator ? `http://${emulator}` : 'https://firebasestorage.googleapis.com';
  return `${origin}/v0/b/${bucketName()}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

const now = () => new Date();
const base = () => ({ eventId: EVENT_ID, createdAt: now(), updatedAt: now() });

async function main() {
  console.log(`Target: ${targetDescription()}`);
  console.log(`Bucket: ${bucketName()}\n`);

  const store = db();

  // ── 1. Work out what has to go ─────────────────────────────────────────────
  //
  // Identified by regenerating the seed's own ids rather than by reading a flag,
  // because the seeded documents carry no marker distinguishing them from a
  // speaker an organizer typed in by hand. Regenerating means a document an
  // organizer added survives this, which is the behaviour that matters if this
  // is ever run against a database somebody has been editing.
  const seeded = makeSpeakers(SEEDED_SPEAKER_COUNT);
  const seededSpeakerIds = new Set(seeded.map((s) => speakerId(s.name, s.company)));

  const speakerSnap = await store.collection(COLLECTIONS.speakers).get();
  const toDeleteSpeakers = speakerSnap.docs.filter((d) => seededSpeakerIds.has(d.id));
  const survivingSpeakers = speakerSnap.size - toDeleteSpeakers.length;

  /*
   * Sessions are matched by regenerated id, the same way the speakers above
   * are, rather than by "has no speaker left standing".
   *
   * The predicate that suggests itself — delete any session whose `speakerIds`
   * are all being removed — is wrong in one specific and recoverable-looking
   * way: a session with *no* speakers at all satisfies "all of them are
   * seeded" vacuously. That is every break, every lunch, the reception, and
   * anything an organizer added to the agenda that is not a talk. They would
   * be deleted as collateral, and because this script rewrites its own
   * reception immediately afterwards the count would still look right.
   */
  const seededSessionIds = new Set(
    makeSessions(SEEDED_SPEAKER_COUNT).map((s) => sessionId(s.title, s.startsAtLocal)),
  );
  const sessionSnap = await store.collection(COLLECTIONS.sessions).get();
  const toDeleteSessions = sessionSnap.docs.filter((d) => seededSessionIds.has(d.id));

  // ── 2. Build what replaces it ──────────────────────────────────────────────
  const programme = buildProgramme(SPEAKERS_2026.length);
  assertEveryoneScheduled(programme, SPEAKERS_2026.length);

  const realSpeakerIds = SPEAKERS_2026.map((s) => speakerId(s.name, s.company));
  const withPortrait = SPEAKERS_2026.filter((s) => s.photo).length;

  console.log('Plan');
  console.log(`  delete   ${toDeleteSpeakers.length} seeded speakers (${survivingSpeakers} others untouched)`);
  console.log(`  delete   ${toDeleteSessions.length} of ${sessionSnap.size} sessions`);
  console.log(`  write    ${KGC_TRACKS.length} real KGC tracks`);
  console.log(`  write    ${SPEAKERS_2026.length} real speakers`);
  console.log(`  upload   ${withPortrait} real portraits to Storage`);
  console.log(`  write    ${programme.length} sessions across 5 days`);
  console.log(`  formats  ${summarise(programme.map((s) => s.format))}`);

  if (!live) {
    console.log('\nDry run. Nothing was written. Re-run with --confirm-live.');
    return;
  }

  // ── 3. Delete the invented roster and agenda ───────────────────────────────
  console.log('\nDeleting seeded speakers and sessions…');
  await deleteDocs(toDeleteSpeakers.map((d) => d.ref.path));
  await deleteDocs(toDeleteSessions.map((d) => d.ref.path));

  // The generated DiceBear avatars go with the speakers they were made for.
  // Leaving them would cost nothing but a few kilobytes; deleting them means
  // the bucket does not accumulate a folder per roster the demo ever had.
  const bucket = getStorage().bucket(bucketName());
  let removedAvatars = 0;
  for (const doc of toDeleteSpeakers) {
    const [files] = await bucket.getFiles({ prefix: `${COLLECTIONS.speakers}/${doc.id}/` });
    for (const f of files) {
      await f.delete().catch(() => undefined);
      removedAvatars++;
    }
  }
  console.log(`  removed ${removedAvatars} generated avatars from Storage`);

  // ── 4. Tracks and rooms ────────────────────────────────────────────────────
  const writes: PendingWrite[] = [];
  const trackIdByName = new Map<string, string>();
  for (const t of KGC_TRACKS) {
    const id = trackId(t.name);
    trackIdByName.set(t.name, id);
    writes.push({ collection: COLLECTIONS.tracks, id, data: { ...base(), name: t.name, color: t.color } });
  }

  /*
   * Delete the invented tracks that the real ones do not replace.
   *
   * `trackId` is a slug of the name, so the three names both sets share
   * (`Business Use Cases`, `Data Architecture`, `Content Knowledge Graphs`)
   * are overwritten by the loop above — and the other eight are not. Writing
   * without this step leaves 19 tracks in the collection: eleven real ones and
   * eight orphans, including `SEO`, `Libraries` and `EU Projects`, none of
   * which KGC runs. Nothing points at them any more, so they are invisible in
   * the data and highly visible in the UI, where the agenda's track filter
   * lists every track document it can read.
   */
  const keepTracks = new Set(KGC_TRACKS.map((t) => trackId(t.name)));
  const trackSnap = await store.collection(COLLECTIONS.tracks).get();
  const staleTracks = trackSnap.docs.filter((d) => !keepTracks.has(d.id));
  if (staleTracks.length) {
    console.log(`  removing ${staleTracks.length} tracks the real programme does not use`);
    await deleteDocs(staleTracks.map((d) => d.ref.path));
  }

  const roomIdByName = new Map<string, string>();
  for (const r of ROOMS) {
    const id = roomId(r.name);
    roomIdByName.set(r.name, id);
    writes.push({
      collection: COLLECTIONS.rooms,
      id,
      data: { ...base(), name: r.name, building: r.building, capacity: r.capacity },
    });
  }

  // ── 5. The real speakers, with their real portraits ────────────────────────
  console.log('\nUploading portraits and writing speakers…');
  let uploaded = 0;

  for (const [i, s] of SPEAKERS_2026.entries()) {
    const id = realSpeakerIds[i];
    const doc: Record<string, unknown> = {
      ...base(),
      name: s.name,
      displayOrder: i,
      sessionIds: [],
      ...(s.company ? { company: s.company } : {}),
      ...(s.role ? { title: s.role } : {}),
      ...(s.featured ? { featured: true } : {}),
    };

    if (s.photo) {
      /*
       * The checked-in path is `/kgc/speakers/<file>` — a URL relative to the
       * website's document root, which is meaningless both on disk and to the
       * native app's `<Image source={{ uri }}>`. So the basename is resolved
       * against `PORTRAIT_DIR` here, and what lands on the document is the
       * absolute Storage URL the app can actually fetch.
       */
      const file = path.join(PORTRAIT_DIR, path.basename(s.photo));
      const bytes = await readFile(file);
      const objectPath = `${COLLECTIONS.speakers}/${id}/photo.jpg`;
      const token = randomUUID();

      await bucket.file(objectPath).save(bytes, {
        contentType: 'image/jpeg',
        metadata: {
          metadata: { firebaseStorageDownloadTokens: token },
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });

      doc.photoURL = downloadUrl(objectPath, token);
      if (s.width) doc.photoWidth = s.width;
      if (s.height) doc.photoHeight = s.height;
      uploaded++;
      if (uploaded % 20 === 0) console.log(`  ${uploaded}/${withPortrait} portraits`);
    }

    writes.push({ collection: COLLECTIONS.speakers, id, data: doc });
  }
  console.log(`  ${uploaded}/${withPortrait} portraits uploaded`);

  // ── 6. The programme, and the join back to the speakers ────────────────────
  const sessionIdsBySpeaker = new Map<string, string[]>();

  for (const s of programme) {
    const times = deriveTimes(s.startsAtLocal, s.endsAtLocal, TIME_ZONE);
    const id = sessionId(s.title, s.startsAtLocal);
    const sids = s.speakers.map((idx) => realSpeakerIds[idx]);
    for (const sid of sids) {
      sessionIdsBySpeaker.set(sid, [...(sessionIdsBySpeaker.get(sid) ?? []), id]);
    }

    const primary = KGC_TRACKS.find((t) => t.name === s.tracks[0]);

    writes.push({
      collection: COLLECTIONS.sessions,
      id,
      data: {
        ...base(),
        ...times,
        title: s.title,
        description: s.description,
        format: s.format,
        status: 'published',
        // See `SessionDoc.provenance` — this is the marker that keeps the
        // invented half of this programme findable.
        provenance: 'fabricated',
        roomId: roomIdByName.get(s.room),
        roomName: s.room,
        trackIds: s.tracks.map((n) => trackIdByName.get(n)!).filter(Boolean),
        ...(primary ? { primaryTrackName: primary.name, primaryTrackColor: primary.color } : {}),
        speakerIds: sids,
        speakerNames: sids.map((sid) => SPEAKERS_2026[realSpeakerIds.indexOf(sid)]?.name).filter(Boolean),
        tags: s.tracks,
        sequence: 0,
        stableGuid: id,
        qaEnabled: s.format !== 'social',
        pollsEnabled: s.format === 'keynote' || s.format === 'panel',
        ...(s.format === 'workshop' ? { capacity: 60 } : {}),
      },
    });
  }

  // Back-fill each speaker's session list now that the ids are known. Written
  // as a separate merge so it lands after the speaker document above it.
  for (const [sid, ids] of sessionIdsBySpeaker) {
    writes.push({ collection: COLLECTIONS.speakers, id: sid, data: { sessionIds: ids } });
  }

  console.log(`\nCommitting ${writes.length} writes…`);
  const n = await commitAll(writes);
  console.log(`Done. ${n} documents written.`);
}

function summarise(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(', ');
}

/** Firestore caps a batch at 500; the same chunking `commitAll` uses. */
async function deleteDocs(paths: string[]): Promise<void> {
  const store = db();
  for (let i = 0; i < paths.length; i += 400) {
    const batch = store.batch();
    for (const p of paths.slice(i, i + 400)) batch.delete(store.doc(p));
    await batch.commit();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
