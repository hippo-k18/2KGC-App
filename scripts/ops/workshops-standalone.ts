/**
 * Make Workshops its own ticket on the live catalogue, and retire the two
 * bundles that sold it as an add-on (T169, owner's decision 2026-10-06).
 *
 * ── What it writes ──────────────────────────────────────────────────────────
 *
 *   - `workshops`: `kind: 'extra'`, `visible: true`, and the seed's tagline,
 *     includes and sort order. The price, `addOnFor`, `quantitySold` and any
 *     `stripeProductId` are left as they are.
 *   - `main-conference-workshops` and
 *     `main-conference-workshops-continuing-education`: sales closed now
 *     (`salesCloseAt`, `salesCloseAtLocal`, `salesTimeZone`). The documents stay,
 *     so past orders, refunds and badges still read correctly. The website
 *     also stops selling any bundle with an extra in it, so this is the second
 *     lock, not the only one.
 *
 * `main-conference-continuing-education` (CEUs) is not touched.
 *
 * ── It backs up, then prints, then writes ───────────────────────────────────
 *
 * Every document it would change is saved as JSON first, to `--backup-dir`
 * (default `./backups`). A dry run is the default; nothing is written without
 * `--apply`, and `--apply` stops if the backup cannot be written.
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8137 npx tsx scripts/ops/workshops-standalone.ts
 *   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/ops/workshops-standalone.ts
 *   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/ops/workshops-standalone.ts --apply
 *
 * ⚠️ After applying, check Marketing › Discount codes for any code limited to
 * the two retired bundles' Stripe products. Such a code can no longer apply to
 * anything; recreate it against Workshops if it is still wanted.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import admin from 'firebase-admin';
import { COLLECTIONS, EVENT_ID, TIME_ZONE, type TicketTypeDoc } from '@kgc/shared';
import { TICKET_TYPE_SEED } from '../src/lib/ticket-types.js';

const apply = process.argv.includes('--apply');
const dirArg = process.argv.find((a) => a.startsWith('--backup-dir='));
const backupDir = resolve(dirArg ? dirArg.slice('--backup-dir='.length) : 'backups');
const PROJECT = process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website';
const emulator = process.env.FIRESTORE_EMULATOR_HOST;

export const RETIRED = ['main-conference-workshops', 'main-conference-workshops-continuing-education'];

/** `YYYY-MM-DDTHH:mm` wall clock in `zone`, the shape the dashboard types. */
export function wallClock(at: Date, zone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

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
  const db = admin.firestore();
  const col = db.collection(COLLECTIONS.ticketTypes);
  const now = new Date();

  console.log(`${apply ? 'APPLYING to' : 'Dry run against'} ${emulator ? `emulator ${emulator}` : PROJECT}\n`);

  const seed = TICKET_TYPE_SEED.find((t) => t.id === 'workshops')!;
  const ids = ['workshops', ...RETIRED];
  const before: Record<string, unknown> = {};
  const writes: { id: string; data: Record<string, unknown> }[] = [];

  for (const id of ids) {
    const snap = await col.doc(id).get();
    if (!snap.exists) {
      console.error(`  ✗ ${id} does not exist. Stopping; nothing written.`);
      process.exit(1);
    }
    const doc = snap.data() as TicketTypeDoc;
    if (doc.eventId !== EVENT_ID) {
      console.error(`  ✗ ${id} belongs to ${doc.eventId}, not ${EVENT_ID}. Stopping; nothing written.`);
      process.exit(1);
    }
    before[id] = snap.data();

    if (id === 'workshops') {
      const data = {
        kind: 'extra',
        visible: true,
        sortOrder: seed.sortOrder,
        tagline: seed.tagline,
        includes: seed.includes,
      };
      console.log(
        `  workshops: kind ${doc.kind ?? '(none)'} → extra, visible ${doc.visible} → true, ` +
          `addOnFor ${doc.addOnFor ?? '(none)'} (kept), price $${doc.priceCents / 100} (kept), sold ${doc.quantitySold ?? 0} (kept)`,
      );
      if (doc.addOnFor !== 'main-conference') {
        console.log('    ⚠️ addOnFor is not main-conference; the checkout will require whatever it names.');
      }
      writes.push({ id, data });
    } else {
      const closed = doc.salesCloseAt && doc.salesCloseAt.toDate() <= now;
      console.log(
        `  ${id}: ${closed ? `already closed ${doc.salesCloseAtLocal ?? ''}, left alone` : `sales close now (${wallClock(now, TIME_ZONE)} ${TIME_ZONE})`}` +
          `, sold ${doc.quantitySold ?? 0}${doc.stripeProductId ? `, Stripe product ${doc.stripeProductId}` : ''}`,
      );
      if (!closed) {
        writes.push({
          id,
          data: {
            salesCloseAt: admin.firestore.Timestamp.fromDate(now),
            salesCloseAtLocal: wallClock(now, TIME_ZONE),
            salesTimeZone: TIME_ZONE,
          },
        });
      }
    }
  }

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `ticketTypes-workshops-standalone-${stamp}.json`);
  try {
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(backupPath, JSON.stringify({ project: emulator ? `emulator ${emulator}` : PROJECT, at: now, before }, null, 2));
    console.log(`\nBackup of ${ids.length} documents: ${backupPath}`);
  } catch (err) {
    console.error(`\n✗ Could not write the backup to ${backupPath}.`, err);
    if (apply) {
      console.error('Nothing written.');
      process.exit(1);
    }
  }

  if (!apply) {
    console.log('Nothing written. Re-run with --apply to write.');
    return;
  }
  const batch = db.batch();
  for (const w of writes) {
    batch.set(col.doc(w.id), { ...w.data, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  await batch.commit();
  console.log(`Wrote ${writes.length} documents.`);
  console.log('Next: check Marketing › Discount codes for codes limited to the retired bundles.');
}

if (process.argv[1] && /workshops-standalone\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
