/**
 * Put the 2027 price ladder and the Continuing education units add-on onto the
 * live `ticketTypes` collection.
 *
 * ── What it writes ──────────────────────────────────────────────────────────
 *
 *   - `pricePhases` on all-access, main-conference and virtual (merge).
 *   - `badge: "Best value"` on all-access, and "Continuing education units"
 *     appended to its `includes` and `groups` if not already there.
 *   - The `continuing-education` add-on and its two bundles, created only if
 *     absent. Every CEU phase after Super Early Bird is off sale, so nothing
 *     new becomes buyable.
 *
 * It never touches `quantitySold`, prices already paid, or any other tier. The
 * definitions come from `scripts/src/lib/ticket-types.ts`, the same seed the
 * emulator uses, so live and local cannot drift.
 *
 * ── It prints before it writes ──────────────────────────────────────────────
 *
 * A dry run is the default. Nothing is written without `--apply`.
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx scripts/ops/apply-2027-price-phases.ts
 *   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/ops/apply-2027-price-phases.ts
 *   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/ops/apply-2027-price-phases.ts --apply
 */
import admin from 'firebase-admin';
import { COLLECTIONS, EVENT_ID, type TicketTypeDoc } from '@kgc/shared';
import {
  ALL_ACCESS_PHASES,
  MAIN_CONFERENCE_PHASES,
  TICKET_TYPE_SEED,
  VIRTUAL_PHASES,
} from '../src/lib/ticket-types.js';

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
const col = db.collection(COLLECTIONS.ticketTypes);
const CEU_LINE = 'Continuing education units';
const NEW_IDS = [
  'continuing-education',
  'main-conference-continuing-education',
  'main-conference-workshops-continuing-education',
];

async function main() {
  console.log(`${apply ? 'APPLYING to' : 'Dry run against'} ${emulator ? `emulator ${emulator}` : PROJECT}\n`);
  const writes: { id: string; data: Record<string, unknown>; create: boolean }[] = [];

  for (const [id, phases] of [
    ['all-access', ALL_ACCESS_PHASES],
    ['main-conference', MAIN_CONFERENCE_PHASES],
    ['virtual', VIRTUAL_PHASES],
  ] as const) {
    const snap = await col.doc(id).get();
    if (!snap.exists) {
      console.error(`  ✗ ${id} does not exist. Stopping; nothing written.`);
      process.exit(1);
    }
    const doc = snap.data() as TicketTypeDoc;
    const data: Record<string, unknown> = { pricePhases: phases };
    if (id === 'all-access') {
      data.badge = 'Best value';
      const includes = doc.includes ?? [];
      if (!includes.includes(CEU_LINE)) data.includes = [...includes, CEU_LINE];
      const groups = doc.groups ?? [];
      if (groups.length && !groups.some((g) => g.heading === CEU_LINE)) {
        data.groups = [...groups, { heading: CEU_LINE }];
      }
    }
    console.log(`  ${id}: now $${doc.priceCents / 100} flat → ${phases.map((p) => `${p.name} ${p.priceCents! / 100}`).join(', ')}`);
    writes.push({ id, data, create: false });
  }

  for (const id of NEW_IDS) {
    const snap = await col.doc(id).get();
    if (snap.exists) {
      console.log(`  ${id}: already exists, left alone`);
      continue;
    }
    const { id: _id, ...fields } = TICKET_TYPE_SEED.find((t) => t.id === id)!;
    console.log(`  ${id}: create (hidden${fields.pricePhases ? ', every phase off sale' : ''})`);
    writes.push({
      id,
      create: true,
      data: {
        ...fields,
        eventId: EVENT_ID,
        quantitySold: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  }

  if (!apply) {
    console.log('\nNothing written. Re-run with --apply to write.');
    return;
  }
  const batch = db.batch();
  for (const w of writes) {
    const ref = col.doc(w.id);
    const data = { ...w.data, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (w.create) batch.create(ref, data);
    else batch.set(ref, data, { merge: true });
  }
  await batch.commit();
  console.log(`\nWrote ${writes.length} documents.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
