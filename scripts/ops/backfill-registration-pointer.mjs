/**
 * Gives every existing account the pointer the watch rules follow.
 *
 * ── What is broken without it ───────────────────────────────────────────────
 *
 * `firestore.rules` finds out which ticket a caller holds by reading
 * `users/{uid}.registrationId`. It cannot work the id out for itself: a
 * registration is keyed by `reg_` + sha256(email) and the rules language has no
 * hash function. So the app stores the pointer, and an account with no pointer
 * is refused every restricted stream and recording.
 *
 * The app now writes it from sign-in onwards, above every screen, so a new
 * account acquires it on first use and nothing here is needed for anybody who
 * signs in after this ships. Accounts that already exist are the gap: they get
 * the pointer the next time they open the app, and until then a video they paid
 * for is locked. This closes it in one pass instead.
 *
 * It is safe to run twice. An account that already has a pointer is skipped,
 * and an account whose stored pointer names a different registration is left
 * alone and reported, because that is a fact about somebody's data rather than
 * something a backfill should decide.
 *
 * ── Matching ────────────────────────────────────────────────────────────────
 *
 * On the address, folded, against `registrations.email` and then `altEmails` —
 * the same two lookups the app makes and the same two arms `registrationIsMine`
 * checks in the rules. A ticket bought on a work address and used to sign in on
 * a personal one is the ordinary case, not an edge.
 *
 * ── Running it ──────────────────────────────────────────────────────────────
 *
 * Dry run, which is the default and prints what it would write:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… \
 *   node scripts/ops/backfill-registration-pointer.mjs \
 *     --project kgc-conference-app-and-website
 *
 * Add `--write` to make the changes. The project has to be named on the command
 * line and has to match the one the credential is for, so this cannot be run
 * against live by pressing up-arrow in the wrong terminal, and it refuses
 * outright when the shell is pointed at an emulator.
 */
import admin from 'firebase-admin';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const write = has('--write');
const named = valueOf('--project');

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    'FIRESTORE_EMULATOR_HOST is set, so this shell is pointed at an emulator.\n' +
      'This script is for the live project. Unset it, or run it in another shell.',
  );
  process.exit(1);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the service-account file first.');
  process.exit(1);
}

if (!named) {
  console.error(
    'Name the project you mean, in full:\n' +
      '  node scripts/ops/backfill-registration-pointer.mjs --project kgc-conference-app-and-website',
  );
  process.exit(1);
}

const credentialProject =
  process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? named;
if (credentialProject !== named) {
  console.error(
    `--project says ${named} but the environment says ${credentialProject}. ` +
      'Refusing rather than guessing which one you meant.',
  );
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: named });
const db = admin.firestore();

console.log(`Project: ${named}`);
console.log(write ? 'Writing.\n' : 'Dry run. Nothing will be written.\n');

/**
 * Every registration, by address. Read in one pass rather than queried per
 * account: the whole collection is a few thousand small documents at most, and
 * one read is cheaper and far faster than two queries per user.
 */
const byAddress = new Map();
const registrations = await db.collection('registrations').get();
for (const d of registrations.docs) {
  const r = d.data();
  const addresses = [r.email, ...(r.altEmails ?? [])];
  for (const a of addresses) {
    if (typeof a !== 'string' || a.trim() === '') continue;
    const key = a.trim().toLowerCase();
    // First one wins, and a second is reported. A single address on two
    // registrations is a data problem somebody has to look at, and picking one
    // silently is how it stays invisible.
    if (byAddress.has(key) && byAddress.get(key) !== d.id) {
      console.warn(`  ! ${key} is on two registrations: ${byAddress.get(key)} and ${d.id}`);
      continue;
    }
    byAddress.set(key, d.id);
  }
}
console.log(`${registrations.size} registrations, ${byAddress.size} addresses.\n`);

const users = await db.collection('users').get();

let already = 0;
let matched = 0;
let noTicket = 0;
let disagrees = 0;
const writes = [];

for (const d of users.docs) {
  const u = d.data();
  const address = typeof u.email === 'string' ? u.email.trim().toLowerCase() : '';
  const found = address ? byAddress.get(address) : undefined;
  const current = typeof u.registrationId === 'string' ? u.registrationId : '';

  if (current) {
    if (found && found !== current) {
      disagrees += 1;
      console.warn(`  ! ${d.id} (${address}) points at ${current}, address matches ${found}`);
    } else {
      already += 1;
    }
    continue;
  }

  if (!found) {
    noTicket += 1;
    continue;
  }

  matched += 1;
  console.log(`  ${d.id} (${address}) -> ${found}`);
  writes.push({ ref: d.ref, registrationId: found });
}

console.log(
  `\n${users.size} accounts: ${already} already pointed, ${matched} to write, ` +
    `${noTicket} with no matching ticket, ${disagrees} disagreeing.`,
);

if (!write) {
  console.log('\nDry run: nothing written. Add --write to make these changes.');
  process.exit(0);
}

if (writes.length === 0) {
  console.log('\nNothing to write.');
  process.exit(0);
}

// Batched in five hundreds, which is the write limit on a batch.
for (let i = 0; i < writes.length; i += 500) {
  const batch = db.batch();
  for (const w of writes.slice(i, i + 500)) {
    batch.set(
      w.ref,
      {
        registrationId: w.registrationId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await batch.commit();
  console.log(`  committed ${Math.min(i + 500, writes.length)} of ${writes.length}`);
}

console.log(`\nDone. ${writes.length} accounts can now be recognised as ticket holders.`);
