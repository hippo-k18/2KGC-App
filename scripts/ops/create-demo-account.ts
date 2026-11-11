/**
 * Provisions one attendee account that can sign in with an email and a password.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The app's real front door is the six-digit code (`login.tsx` → `otp-core.ts`),
 * and nothing on that path ever sets a password: `verifySignInCode` mints the
 * account with an address and no credential, and `/change-password` is where a
 * password first comes from. That is correct for attendees and useless for a
 * rehearsal, because the code only reaches `hartigandeely@gmail.com` until the
 * Resend domain is verified — so a demo on someone else's laptop cannot get in
 * at all.
 *
 * This script is the deliberate exception: **one** named address, provisioned
 * by hand, with a password. It is not a mode, not a flag in the app, and not a
 * mapping layer in the sign-in box — the last one of those turned `demo` / `123`
 * into a live credential and was removed. Everything it writes, it writes with
 * the Admin SDK from a laptop; the app is unchanged and still only ever calls
 * `signInWithEmailAndPassword`.
 *
 * ⚠️ **This is a shared password on a live project**, handed out with the
 * Expo Go QR code and used by App Store review. The current one is recorded in
 * `orchestrator/reports/T223.md` and nowhere in this repo. The script takes it
 * from the environment and has no default, because the old default was public
 * and re-running the script to "fix" the login would have reset the account
 * to it (T259 #9).
 *
 * The account is kept read-only and out of sight however often this runs: the
 * `demo: true` claim that `firestore.rules` reads as "writes nothing anybody
 * else can see", hidden from the directory, messaging off. Delete it before the
 * event runs on real attendees:
 *
 *     …  npx tsx scripts/ops/create-demo-account.ts --delete --confirm-live
 *
 * ── What it writes ──────────────────────────────────────────────────────────
 *
 *   auth user          the credential itself, plus the `registered` claim that
 *                      `firestore.rules` gates every read on and the `demo`
 *                      claim that keeps it read-only
 *   users/{uid}        the profile, with `mustChangePassword: false` — the seed
 *                      default of `true` would bounce every sign-in straight to
 *                      /change-password, which is precisely what a demo cannot
 *                      afford to hit on stage
 *   registrations/…    via `ensureRegistration`, so the Badge tab has a QR to
 *                      show; the badge reads `registrations` by email, not the
 *                      profile
 *   directory/{uid}    removed if present: the demo login is not listed
 *                      under People
 *
 * Idempotent. Re-running sets the password to DEMO_ACCOUNT_PASSWORD and leaves
 * `qrSecret` and `claimCode` alone, so a badge already screenshotted keeps
 * working.
 *
 *   DEMO_ACCOUNT_PASSWORD='…' GOOGLE_APPLICATION_CREDENTIALS=$PWD/.secrets/service-account.json \
 *     npx tsx scripts/ops/create-demo-account.ts --confirm-live
 *
 *   DEMO_ACCOUNT_PASSWORD='…' FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *     npx tsx scripts/ops/create-demo-account.ts
 *
 * Flags: --email …  --name …  --ticket …  --delete. No --password: a password
 * on the command line ends up in shell history.
 */
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { getAuth } from 'firebase-admin/auth';

import { db, targetDescription } from '../src/lib/firestore.js';
import { ensureRegistration } from '../src/lib/fulfilment.js';
import { normaliseEmail, registrationId } from '../src/lib/ids.js';

const DEFAULTS = {
  // The dashboard's address, on purpose. A `.com` variant was provisioned first
  // and deleted the same day: two demo addresses that differ only by TLD is a
  // credential nobody can recall correctly under stage lights, and the `.tech`
  // one is already in muscle memory from `apps/organizer`. The two are still
  // unrelated credentials — see the docblock above.
  email: 'demo@knowledgegraph.tech',
  name: 'Demo Attendee',
  ticket: 'All Access (VIP)',
};

/** The public QR code hands this password to strangers, so no short ones. */
const MIN_PASSWORD = 12;

/** `--email x` or `--email=x`; falls back to the default above. */
function arg(flag: keyof typeof DEFAULTS): string {
  const argv = process.argv;
  const i = argv.indexOf(`--${flag}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${flag}=`));
  if (inline) return inline.slice(flag.length + 3);
  return DEFAULTS[flag];
}

async function main() {
  const live = process.argv.includes('--confirm-live');
  const remove = process.argv.includes('--delete');

  // Both hosts, not just the Firestore one — the dangerous writes here go
  // through Auth, which is gated by FIREBASE_AUTH_EMULATOR_HOST. Exporting only
  // FIRESTORE_EMULATOR_HOST would create a real account on the live project
  // while every console line said "emulator". `set-claims.ts` carries the same
  // guard, and the same story about the fifty accounts that appeared without it.
  const onEmulator =
    Boolean(process.env.FIRESTORE_EMULATOR_HOST) &&
    Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);

  if (!onEmulator && !live) {
    console.error(
      `Refusing to touch accounts on ${targetDescription()} without --confirm-live.\n` +
        'This script writes to Auth, so BOTH emulator hosts must be set for a local run:\n' +
        '  export FIRESTORE_EMULATOR_HOST=localhost:8080\n' +
        '  export FIREBASE_AUTH_EMULATOR_HOST=localhost:9099',
    );
    process.exit(1);
  }

  const email = normaliseEmail(arg('email'));
  const password = process.env.DEMO_ACCOUNT_PASSWORD ?? '';
  const name = arg('name');
  const ticket = arg('ticket');

  const store = db();
  const auth = getAuth();

  if (remove) {
    const existing = await auth.getUserByEmail(email).catch(() => undefined);
    if (existing) {
      await auth.deleteUser(existing.uid);
      await store.collection(COLLECTIONS.users).doc(existing.uid).delete();
      await store.collection(COLLECTIONS.directory).doc(existing.uid).delete();
    }
    await store.collection(COLLECTIONS.registrations).doc(registrationId(email)).delete();
    console.log(`Removed ${email} from ${targetDescription()}.`);
    return;
  }

  if (password.length < MIN_PASSWORD) {
    // Anybody holding the Expo Go QR code has this password, so it has to be
    // one nobody can guess. Caught before any write.
    console.error(
      `Set DEMO_ACCOUNT_PASSWORD to the demo password (at least ${MIN_PASSWORD} characters). ` +
        'The current one is in orchestrator/reports/T223.md. Nothing was written.',
    );
    process.exit(1);
  }

  console.log(`Provisioning ${email} on ${targetDescription()}\n`);

  // The badge first: `ensureRegistration` is the same call the checkout makes,
  // so this account's registration is shaped like a bought one rather than like
  // something a script invented.
  const registration = await ensureRegistration(store, { email, name, ticketType: ticket });
  // Marked so the dashboard lists it but does not count it (T223).
  await store
    .collection(COLLECTIONS.registrations)
    .doc(registration.registrationId)
    .set({ demo: true, channel: 'manual', reason: 'Demo account for app previews' }, { merge: true });
  console.log(`  registration ${registration.registrationId} (${registration.created ? 'created' : 'updated'})`);

  const existing = await auth.getUserByEmail(email).catch((err: { code?: string }) => {
    if (err.code === 'auth/user-not-found') return undefined;
    throw err;
  });

  let uid: string;
  if (existing) {
    uid = existing.uid;
    await auth.updateUser(uid, { password, displayName: name, emailVerified: true });
    console.log(`  auth user ${uid} (password reset)`);
  } else {
    uid = (await auth.createUser({ email, password, displayName: name, emailVerified: true })).uid;
    console.log(`  auth user ${uid} (created)`);
  }

  // `registered` is the gate every rule in firestore.rules reads. Without it the
  // account signs in and then sees permission-denied on its own profile, which
  // renders as an empty app rather than as an error anyone can act on.
  //
  // `demo: true` is what keeps it read-only (`isDemo()` in firestore.rules).
  // Setting claims replaces them all, so leaving it out here would quietly
  // turn the shared login into an ordinary attendee who can post and message.
  await auth.setCustomUserClaims(uid, {
    registered: true,
    roles: ['attendee'],
    eventId: EVENT_ID,
    demo: true,
  });
  console.log('  claims registered=true roles=[attendee] demo=true');

  // A plain Date, never FieldValue.serverTimestamp() — AGENTS.md gotcha 8: three
  // copies of firebase-admin exist in this tree and a sentinel built by the
  // wrong one fails the whole write on an `instanceof` check.
  const now = new Date();
  await store
    .collection(COLLECTIONS.users)
    .doc(uid)
    .set(
      {
        eventId: EVENT_ID,
        email,
        name,
        title: 'Head of Data',
        company: 'Knowledge Graph Conference',
        interests: [],
        bio: '',
        onboarded: true,
        // Hidden and unreachable: strangers hold this login (T223, T224).
        visibleInDirectory: false,
        messagingEnabled: false,
        notificationPrefs: { announcements: true, messages: true, sessionReminders: true },
        roles: ['attendee'],
        // Both false on purpose. The code flow sets them true because an account
        // minted from an email code has no credential and must choose one; this
        // account was handed a password deliberately, and leaving these true
        // would redirect every sign-in to /change-password before the app is
        // ever seen (see the guard in app/src/app/_layout.tsx).
        mustChangePassword: false,
        mustSetPassword: false,
        createdAt: now,
        updatedAt: now,
      },
      // merge, so re-running does not discard a name or a photo set from the app.
      { merge: true },
    );
  console.log(`  users/${uid}`);

  // Not listed under People. A directory entry left by an older run of this
  // script is removed.
  await store.collection(COLLECTIONS.directory).doc(uid).delete();
  console.log(`  directory/${uid} (removed if present)`);

  // Ties the badge to the account, the way a first sign-in through the code flow
  // would. Nothing reads it yet on the client; it is what makes a hand-made
  // registration indistinguishable from a claimed one in the dashboard.
  await store
    .collection(COLLECTIONS.registrations)
    .doc(registration.registrationId)
    .set({ claimedByUid: uid, updatedAt: now }, { merge: true });

  console.log(`\n  Sign in at the app with ${email} and the password from DEMO_ACCOUNT_PASSWORD.`);
  console.log('  Claims land in the token at sign-in, so sign out and back in if this');
  console.log('  account was already signed in on a device.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
