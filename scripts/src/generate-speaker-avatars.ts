/**
 * Gives every speaker document a portrait, by generating one rather than by
 * finding one.
 *
 *   npm run avatars:speakers                    # dry run — prints, writes nothing
 *   npm run avatars:speakers -- --confirm-live  # fetch, upload, write photoURL
 *   npm run avatars:speakers -- --confirm-live --replace   # also overwrite existing photos
 *
 * ## Why generated and not stock photography
 *
 * The `speakers` collection holds the forty-five people `npm run seed` invents.
 * They are the roster the public `/speakers` page publishes today, because
 * `SPEAKERS_PAGE_SOURCE` reads `'firestore'` — so whatever goes in this field is
 * *published under an invented person's name*.
 *
 * A stock headshot is a photograph of a real, identifiable human being. Putting
 * one under "Ada Lovelace, Chief Data Officer at Northwind" asserts that this
 * person holds that job and is speaking at this conference, and none of that is
 * true. Every major stock licence (Unsplash, Pexels, Getty) forbids exactly
 * that use — depicting an identifiable model in a way that implies endorsement
 * or a false attribute. It is also the same harm `import-speakers-2026.ts`
 * refuses when it declines to attach real 2026 speakers to invented 2027
 * sessions, and the harm the `SPEAKERS_PAGE_SOURCE` switch was built around.
 *
 * A DiceBear avatar is a drawing assembled from a seed. It depicts nobody, so
 * there is no likeness to misattribute and no licence to breach (the
 * `notionists` set is CC0). It also reads as deliberate: an audience seeing
 * forty-five illustrated portraits understands immediately that the roster is a
 * placeholder, which is the honest signal. Forty-five convincing photographs
 * would say the opposite.
 *
 * ## Why the bytes are fetched once and stored, not hotlinked
 *
 * `photoURL` is read by three surfaces: the public website through
 * `next/image`, the organizer dashboard, and the native app's `Avatar`, which
 * hands it straight to a React Native `<Image source={{ uri }}>`. That last one
 * settles two things.
 *
 * It must be an **absolute** URL — RN has no document origin to resolve
 * `/kgc/speakers/x.png` against — which rules out the `apps/web/public/`
 * arrangement the checked-in 2026 portraits use. And it must be **PNG, not
 * SVG**: RN's `Image` cannot render SVG without `react-native-svg`, which this
 * app does not install. So: PNG, absolute, first-party.
 *
 * Pointing it at `api.dicebear.com` would satisfy both and is still wrong. It
 * would put a third-party request on every render of the People tab, need a new
 * entry in `images.remotePatterns`, and make the roster stop rendering the day
 * that service changes its URL scheme. The bytes are fetched once, here, and
 * uploaded to our own bucket.
 *
 * ## Where they land, and why that path
 *
 * `speakers/{speakerId}/photo.png` — byte-identical to the target Speaker
 * Manager's own upload action builds (`content/speaker-center/speaker-manager/
 * actions.ts`), and the path `storage.rules` already has a match block for. An
 * organizer who later uploads a real headshot for that speaker overwrites this
 * object rather than orphaning it.
 *
 * The URL is minted the same way `apps/organizer/src/lib/uploads.ts` mints one:
 * a download token on the object, served from `firebasestorage.googleapis.com`.
 * That host is not cosmetic — `firestore.rules`' `isFirebaseStorageUrl()` and
 * `mirror-directory.ts` both require it exactly, and a URL built any other way
 * is silently dropped from the attendee directory. A signed URL would expire;
 * `makePublic()` fails outright on a uniform-bucket-level-access bucket.
 *
 * ## What it will not do
 *
 * It skips any speaker that already has a `photoURL`. A generated drawing must
 * never overwrite a real person's actual headshot, and the day this script is
 * re-run after an organizer has been uploading photos is the day that would
 * otherwise happen. `--replace` is the explicit opt-out.
 *
 * The seed's writes are `merge: true`, so `npm run seed` does **not** clear
 * these afterwards — re-seeding and re-running this in either order converges.
 */
import { randomUUID } from 'node:crypto';

import { COLLECTIONS } from '@kgc/shared';
import { getStorage } from 'firebase-admin/storage';

import { db, targetDescription } from './lib/firestore.js';

const args = process.argv.slice(2);
const live = args.includes('--confirm-live');
const replace = args.includes('--replace');

/**
 * The avatar set, and the reason it is this one.
 *
 * `notionists` is monochrome line art on a flat tint: it reads as an editorial
 * illustration rather than as a cartoon, sits quietly beside the KGC palette,
 * and survives being cropped to a 44pt circle in a `ListRow`. The alternatives
 * were checked rather than assumed — `personas` and `big-smile` are broad
 * enough to look like a joke on a conference programme, and `micah` and
 * `open-peeps` fight every surface they sit on.
 *
 * Licensed CC0 by its author (Zoish), so there is nothing to attribute and
 * nothing to renew.
 */
const STYLE = 'notionists';

/** Rendered square; the two `photo*` fields below must agree with it. */
const SIZE = 256;

/**
 * Background tints, cycled by DiceBear against the seed.
 *
 * Without these the PNG has a transparent background, and a transparent
 * portrait on the dashboard's white card is a floating head with no edge. These
 * are DiceBear's own pastel defaults, which stay legible behind dark line work
 * in both the app's light and dark themes.
 */
const BACKGROUNDS = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf'].join(',');

function avatarUrl(seed: string): string {
  const q = new URLSearchParams({
    seed,
    size: String(SIZE),
    radius: '50',
    backgroundColor: BACKGROUNDS,
  });
  return `https://api.dicebear.com/9.x/${STYLE}/png?${q}`;
}

function bucketName(): string {
  const projectId = process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website';
  return process.env.FIREBASE_STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`;
}

/** See the docblock: this exact host is load-bearing, not a formatting choice. */
function downloadUrl(path: string, token: string): string {
  const emulator = (
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? process.env.STORAGE_EMULATOR_HOST
  )?.replace(/^https?:\/\//, '');
  const origin = emulator ? `http://${emulator}` : 'https://firebasestorage.googleapis.com';
  return `${origin}/v0/b/${bucketName()}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function fetchPng(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());

  /*
   * Check the magic number rather than the Content-Type header. A proxy or a
   * captive portal returning an HTML error page with a 200 would otherwise be
   * uploaded as `image/png` and produce forty-five broken images that only
   * fail at render time, on a device, in front of an audience.
   */
  const isPng =
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isPng) throw new Error(`response from ${url} is not a PNG (${bytes.length} bytes)`);

  return bytes;
}

async function main() {
  console.log(`Target: ${targetDescription()}`);
  console.log(`Bucket: ${bucketName()}`);
  console.log(`Style:  ${STYLE} @ ${SIZE}px\n`);

  const store = db();
  const snap = await store.collection(COLLECTIONS.speakers).get();

  if (snap.empty) {
    console.log('No speaker documents. Run `npm run seed` first.');
    return;
  }

  const todo: { id: string; name: string; seed: string }[] = [];
  let skipped = 0;

  snap.forEach((doc) => {
    const data = doc.data() as { name?: string; photoURL?: string };
    if (data.photoURL && !replace) {
      skipped++;
      return;
    }
    /*
     * Seed on the document id, not on the name. Two speakers can share a name —
     * `SpeakerCard` keys on `name-index` for exactly that reason — and seeding
     * on the name would hand both of them the same face, which is the one way a
     * generated avatar can still look like a bug.
     */
    todo.push({ id: doc.id, name: data.name ?? doc.id, seed: doc.id });
  });

  console.log(`${snap.size} speakers · ${todo.length} to generate · ${skipped} already have a photo`);
  if (skipped && !replace) console.log('(pass --replace to overwrite those too)\n');
  else console.log('');

  if (!todo.length) {
    console.log('Nothing to do.');
    return;
  }

  if (!live) {
    for (const s of todo) {
      console.log(`  would generate  ${s.name.padEnd(24)} → speakers/${s.id}/photo.png`);
    }
    console.log(`\nDry run. ${todo.length} avatars would be created. Re-run with --confirm-live.`);
    return;
  }

  const bucket = getStorage().bucket(bucketName());
  let written = 0;

  for (const s of todo) {
    const path = `${COLLECTIONS.speakers}/${s.id}/photo.png`;
    const bytes = await fetchPng(avatarUrl(s.seed));
    const token = randomUUID();

    await bucket.file(path).save(bytes, {
      contentType: 'image/png',
      metadata: {
        // `firebaseStorageDownloadTokens` is the metadata key the Firebase
        // layer reads; without it the `?token=` URL above 403s.
        metadata: { firebaseStorageDownloadTokens: token },
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    await store.collection(COLLECTIONS.speakers).doc(s.id).set(
      {
        photoURL: downloadUrl(path, token),
        photoWidth: SIZE,
        photoHeight: SIZE,
      },
      { merge: true },
    );

    written++;
    console.log(`  ${String(written).padStart(3)}/${todo.length}  ${s.name}`);
  }

  console.log(`\nDone. ${written} speakers now have a portrait.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
