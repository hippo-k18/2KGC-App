/**
 * Give every community reply a `status`, so none of them falls off the board.
 *
 * ── What it is for ──────────────────────────────────────────────────────────
 *
 * `status` arrived on `CommunityReplyDoc` with moderation, after the first
 * replies had been written. A reply without it used to be shown anyway, because
 * the app read the field with a default. It cannot be any more: `firestore.rules`
 * only answers a reply query that carries `where('status', '==', 'visible')`,
 * which is what stops a hidden reply being handed to every ticket holder — and
 * Firestore has no way to ask for a field that is absent, so a reply with no
 * `status` is in no query an attendee can run, and therefore on no board. The
 * dashboard still sees it: the moderation queue reads with the Admin SDK and
 * treats an absent status as visible, so the two surfaces disagree about what
 * is on the board until this has run.
 *
 * Every reply this project has written carries the field: `addReply` sets it,
 * the seed sets it, and the rules now refuse a create without it. So on the
 * live database this run is expected to find nothing. It exists for the case
 * where that is not true — a database restored from a backup taken before the
 * field, or rows imported from somewhere else — and it must be run once against
 * live before or with the rules deploy, because the two changes together are
 * what make an unbackfilled reply disappear.
 *
 * ── It prints before it writes ──────────────────────────────────────────────
 *
 * A dry run is the default. Nothing is written without `--apply`. Every reply
 * it touches is set to `visible`, which is how the app treated an absent field
 * all along: this restores what people could already see, it does not un-hide
 * anything. A moderated reply says `hidden` and is left alone.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/ops/backfill-reply-status.ts
 *   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/ops/backfill-reply-status.ts --apply
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx scripts/ops/backfill-reply-status.ts
 *
 * ── Why a collection group query ────────────────────────────────────────────
 *
 * Replies live under each post, so there is no one collection to walk. The
 * group query needs no composite index — it is a scan of one collection id with
 * no filter and no order — and it is the only way to reach a reply under a post
 * this script would otherwise have to enumerate first.
 */
import admin from 'firebase-admin';
import { SUBCOLLECTIONS } from '@kgc/shared';

const apply = process.argv.includes('--apply');
const PROJECT = process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website';
const emulator = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    'Set GOOGLE_APPLICATION_CREDENTIALS to the service-account file, or ' +
      'FIRESTORE_EMULATOR_HOST to run against the emulator.',
  );
  process.exit(1);
}

admin.initializeApp(
  emulator
    ? { projectId: PROJECT }
    : { credential: admin.credential.applicationDefault(), projectId: PROJECT },
);
const db = admin.firestore();

const snap = await db.collectionGroup(SUBCOLLECTIONS.replies).get();
const missing = snap.docs.filter((d) => typeof d.get('status') !== 'string');

console.log(
  `${snap.size} replies on ${emulator ? `${PROJECT} (emulator)` : PROJECT}, ` +
    `${missing.length} with no status.`,
);

if (missing.length === 0) {
  console.log('Nothing to backfill.');
  process.exit(0);
}

for (const d of missing) console.log(`  ${d.ref.path}`);

if (!apply) {
  console.log('\nDry run. Nothing written. Re-run with --apply to set these to visible.');
  process.exit(0);
}

// Batched in 400s: the limit is 500 writes and leaving headroom costs nothing.
for (let i = 0; i < missing.length; i += 400) {
  const batch = db.batch();
  for (const d of missing.slice(i, i + 400)) batch.update(d.ref, { status: 'visible' });
  await batch.commit();
}

console.log(`\nSet status: 'visible' on ${missing.length} replies.`);
