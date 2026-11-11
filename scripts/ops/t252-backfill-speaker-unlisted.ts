/**
 * T252: give every speaker an explicit `unlisted` boolean, and move any
 * `contactEmail` off the speaker record into the server-only `speakerContacts`.
 *
 *   npx tsx scripts/ops/t252-backfill-speaker-unlisted.ts            # dry run
 *   npx tsx scripts/ops/t252-backfill-speaker-unlisted.ts --apply    # backs up, then writes
 *     [--backup-dir=<dir>]
 *
 * Without FIRESTORE_EMULATOR_HOST this is the LIVE project, through
 * GOOGLE_APPLICATION_CREDENTIALS. Run from the repo root.
 *
 * Why: the new `speakers` rule only lets the app list speakers with
 * `where('unlisted', '==', false)`, and a document with no `unlisted` field
 * does not match that filter. So, in this order:
 *   1. run this with --apply (adding the field changes nothing visible),
 *   2. deploy the dashboard, the website and the app (the app's new query
 *      filters on the field, so before step 1 it would find no speakers),
 *   3. run this again, for any speaker the old dashboard created in between,
 *   4. deploy the rules.
 *
 * Idempotent: a speaker that already has the boolean and no address is left
 * alone. An existing `unlisted: true` is kept. On 2026-10-13 live had 137
 * speakers, none with either field.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type SpeakerDoc } from '@kgc/shared';
import { db, targetDescription } from '../src/lib/firestore.js';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'] as const;
  }),
);
const APPLY = args.get('apply') === 'true';
const BACKUP_DIR = args.get('backup-dir') ?? path.resolve('..', 'backups', 't252');

async function main() {
  const snap = await db().collection(COLLECTIONS.speakers).where('eventId', '==', EVENT_ID).get();
  const needFlag = snap.docs.filter((d) => typeof (d.data() as SpeakerDoc).unlisted !== 'boolean');
  const withEmail = snap.docs.filter((d) => Boolean((d.data() as SpeakerDoc).contactEmail));

  console.log(`Target: ${targetDescription()}`);
  console.log(`Speakers: ${snap.size}. Missing the unlisted boolean: ${needFlag.length}. With contactEmail on the record: ${withEmail.length}.`);

  if (!APPLY) {
    console.log('\nDry run. Nothing written. Add --apply to write.');
    return;
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `speakers-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      (_k, v) => (v instanceof Timestamp ? { _ts: v.toDate().toISOString() } : v),
      2,
    ),
  );
  console.log(`Backup: ${file}`);

  let writes = 0;
  for (const d of snap.docs) {
    const s = d.data() as SpeakerDoc;
    const update: Record<string, unknown> = {};
    if (typeof s.unlisted !== 'boolean') update.unlisted = false;
    if (s.contactEmail) {
      const contact = db().collection(COLLECTIONS.speakerContacts).doc(d.id);
      if (!(await contact.get()).exists) {
        await contact.set({
          eventId: EVENT_ID,
          speakerId: d.id,
          email: s.contactEmail.trim().toLowerCase(),
          updatedAt: new Date(),
        });
      }
      update.contactEmail = FieldValue.delete();
    }
    if (Object.keys(update).length) {
      await d.ref.update(update);
      writes++;
    }
  }
  console.log(`Updated ${writes} speaker${writes === 1 ? '' : 's'}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
