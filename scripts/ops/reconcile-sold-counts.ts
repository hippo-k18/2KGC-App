/**
 * Recompute `ticketTypes.quantitySold` from the `orders` ledger.
 *
 * ── What it is for ──────────────────────────────────────────────────────────
 *
 * `quantitySold` is a one-way ratchet: incremented at fulfilment, never
 * decremented on refund, and best-effort in both writers, so it can drift high
 * (every refund) and low (any increment that failed). It is also the number the
 * sold-out check consults. This is the only thing that can put it back.
 *
 * The dashboard has a per-tier "correct the sold count" control for the
 * one-tier case (Tickets › 1.1 Create Tickets). Use this when the whole
 * catalogue needs auditing, or after a batch of refunds.
 *
 * ── It prints before it writes ──────────────────────────────────────────────
 *
 * A dry run is the default. Nothing is written without `--apply`, because this
 * rewrites the figure that decides whether a tier is still selling, and a job
 * that does that silently is one nobody should run on the morning of an event.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/ops/reconcile-sold-counts.ts
 *   GOOGLE_APPLICATION_CREDENTIALS=… npx tsx scripts/ops/reconcile-sold-counts.ts --apply
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx scripts/ops/reconcile-sold-counts.ts
 *
 * ── Why `.ts` where its neighbours are `.mjs` ───────────────────────────────
 *
 * The fold — which order statuses consume a seat, how an absent `quantity` is
 * read — is pinned by `scripts/src/lib/sold-counts.test.ts` and shared with the
 * dashboard's drift readout. A second copy transcribed into plain JS is a
 * second answer to "is this tier sold out", and the day the two disagreed is
 * the day a tier closes with seats left. Every other entry point in this
 * workspace already runs under `tsx`.
 */
import admin from 'firebase-admin';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import {
  outstandingSeatsByTier,
  soldCountDrift,
  type SoldCountOrder,
} from '../src/lib/sold-counts.js';

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

const [tierSnap, orderSnap] = await Promise.all([
  db.collection(COLLECTIONS.ticketTypes).where('eventId', '==', EVENT_ID).get(),
  db.collection(COLLECTIONS.orders).where('eventId', '==', EVENT_ID).get(),
]);

const tiers = tierSnap.docs.map((d) => ({
  id: d.id,
  name: (d.data().name as string) ?? d.id,
  quantitySold: (d.data().quantitySold as number) ?? 0,
}));
const orders = orderSnap.docs.map((d) => d.data() as SoldCountOrder);

const drift = soldCountDrift(tiers, orders);
const outstanding = outstandingSeatsByTier(orders);

console.log(`${tiers.length} ticket types, ${orders.length} orders on ${PROJECT}.`);

if (outstanding.size > 0) {
  console.log('\nSeats on invoices raised and not yet paid (not counted as sold):');
  for (const [id, seats] of [...outstanding].sort()) console.log(`  ${id}  ${seats}`);
}

if (drift.length === 0) {
  console.log('\nEvery sold count already agrees with the ledger. Nothing to do.');
  process.exit(0);
}

const nameOf = new Map(tiers.map((t) => [t.id, t.name]));
console.log(`\n${drift.length} ticket ${drift.length === 1 ? 'type is' : 'types are'} adrift:`);
for (const d of drift) {
  const sign = d.delta > 0 ? '+' : '';
  console.log(
    `  ${d.ticketTypeId}  (${nameOf.get(d.ticketTypeId)})  ` +
      `stored ${d.stored} → ledger ${d.computed}  [${sign}${d.delta}]`,
  );
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write these figures.');
  process.exit(0);
}

/**
 * Written one at a time with `set(..., { merge: true })` rather than in a
 * batch, so a tier deleted between the read and the write fails on its own row
 * instead of taking the other corrections down with it.
 */
for (const d of drift) {
  await db
    .collection(COLLECTIONS.ticketTypes)
    .doc(d.ticketTypeId)
    .update({
      quantitySold: d.computed,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  console.log(`  wrote ${d.ticketTypeId} = ${d.computed}`);
}

/**
 * Audited, like every other correction to this number.
 *
 * The dashboard's control writes `ticketType.adjustSold` per tier; this writes
 * one entry for the run, because "somebody ran the reconcile and it moved four
 * tiers" is the fact worth finding later, not four separate entries that hide
 * the fact they were one action. The actor is the operator's own credential
 * rather than an organizer login — there is no session here.
 */
await db.collection(COLLECTIONS.auditLog).add({
  eventId: EVENT_ID,
  actor: process.env.KGC_OPERATOR ?? 'scripts/ops/reconcile-sold-counts.ts',
  action: 'ticketType.adjustSold',
  targetPath: COLLECTIONS.ticketTypes,
  targetId: 'reconcile',
  before: Object.fromEntries(drift.map((d) => [d.ticketTypeId, d.stored])),
  after: Object.fromEntries(drift.map((d) => [d.ticketTypeId, d.computed])),
  at: admin.firestore.FieldValue.serverTimestamp(),
});

console.log(`\nReconciled ${drift.length}. One audit entry written for the run.`);
