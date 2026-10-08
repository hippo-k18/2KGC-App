/**
 * Update the live Workshops ticket's wording for T186 (owner, 2026-10-07):
 * Workshops and Main Conference are independent tickets, so Workshops no longer
 * says it is "Added to your Main Conference ticket" or that it "Needs a Main
 * Conference ticket".
 *
 * ── What it writes ──────────────────────────────────────────────────────────
 *
 *   - `workshops`: `tagline` and `includes` from the seed. Nothing else: the
 *     price, `kind: 'extra'`, `addOnFor` (kept for the record, no longer read),
 *     `quantitySold` and any `stripeProductId` stay as they are.
 *
 * The code change is what makes Workshops sell on its own; this only fixes the
 * words on /tickets. Code first, then this: until it runs, the card still reads
 * "Added to your Main Conference ticket" while the checkout already sells it
 * alone.
 *
 * ── It backs up, then prints, then writes ───────────────────────────────────
 *
 * The document is saved as JSON first, to `--backup-dir` (default `./backups`).
 * A dry run is the default; nothing is written without `--apply`, and `--apply`
 * stops if the backup cannot be written. Running it twice changes nothing.
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8186 npx tsx scripts/ops/workshops-independent.ts
 *   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/ops/workshops-independent.ts
 *   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/ops/workshops-independent.ts --apply
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import admin from 'firebase-admin';
import { COLLECTIONS, EVENT_ID, type TicketTypeDoc } from '@kgc/shared';
import { TICKET_TYPE_SEED } from '../src/lib/ticket-types.js';

const apply = process.argv.includes('--apply');
const dirArg = process.argv.find((a) => a.startsWith('--backup-dir='));
const backupDir = resolve(dirArg ? dirArg.slice('--backup-dir='.length) : 'backups');
const PROJECT = process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website';
const emulator = process.env.FIRESTORE_EMULATOR_HOST;

async function main() {
  if (!emulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      'Set GOOGLE_APPLICATION_CREDENTIALS to the service-account file, or ' +
        'FIRESTORE_EMULATOR_HOST to run against the emulator.',
    );
    process.exit(1);
  }
  admin.initializeApp(
    emulator ? { projectId: PROJECT } : { credential: admin.credential.applicationDefault(), projectId: PROJECT },
  );
  const col = admin.firestore().collection(COLLECTIONS.ticketTypes);
  const now = new Date();

  console.log(`${apply ? 'APPLYING to' : 'Dry run against'} ${emulator ? `emulator ${emulator}` : PROJECT}\n`);

  const seed = TICKET_TYPE_SEED.find((t) => t.id === 'workshops')!;
  const snap = await col.doc('workshops').get();
  if (!snap.exists) {
    console.error('  ✗ workshops does not exist. Stopping; nothing written.');
    process.exit(1);
  }
  const doc = snap.data() as TicketTypeDoc;
  if (doc.eventId !== EVENT_ID) {
    console.error(`  ✗ workshops belongs to ${doc.eventId}, not ${EVENT_ID}. Stopping; nothing written.`);
    process.exit(1);
  }
  if (doc.kind !== 'extra') {
    console.log(`  ⚠️ workshops is kind ${doc.kind ?? '(none)'}, not extra. Run workshops-standalone.ts first.`);
  }

  const data = { tagline: seed.tagline, includes: seed.includes };
  const same = doc.tagline === data.tagline && JSON.stringify(doc.includes ?? []) === JSON.stringify(data.includes);
  console.log(`  workshops tagline:\n    before: ${doc.tagline ?? '(none)'}\n    after:  ${data.tagline}`);
  console.log(`  workshops includes:\n    before: ${JSON.stringify(doc.includes ?? [])}\n    after:  ${JSON.stringify(data.includes)}`);
  console.log(`  kept: kind ${doc.kind ?? '(none)'}, price $${doc.priceCents / 100}, sold ${doc.quantitySold ?? 0}, addOnFor ${doc.addOnFor ?? '(none)'}`);

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `ticketTypes-workshops-independent-${stamp}.json`);
  try {
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(
      backupPath,
      JSON.stringify({ project: emulator ? `emulator ${emulator}` : PROJECT, at: now, before: { workshops: doc } }, null, 2),
    );
    console.log(`\nBackup: ${backupPath}`);
  } catch (err) {
    console.error(`\n✗ Could not write the backup to ${backupPath}.`, err);
    if (apply) {
      console.error('Nothing written.');
      process.exit(1);
    }
  }

  if (same) {
    console.log('Already up to date. Nothing to write.');
    return;
  }
  if (!apply) {
    console.log('Nothing written. Re-run with --apply to write.');
    return;
  }
  await col.doc('workshops').set({ ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  console.log('Wrote 1 document.');
}

if (process.argv[1] && /workshops-independent\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
