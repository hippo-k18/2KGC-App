/**
 * Undoes the purchases made during a rehearsal, so the next run starts clean.
 *
 * This exists because of one property of the checkout that is correct and
 * inconvenient: buying twice with the same email address **updates** the same
 * registration and the same order rather than creating a second one, and
 * `quantitySold` only increments when the registration is newly created. So
 * the second time you demo the purchase, the counter does not move and the
 * orders screen already says "Paid 1" before you have bought anything — which
 * is exactly the moment the audience decides the number is fake.
 *
 * Scoped to `channel: 'demo'` orders and the registrations they name. It cannot
 * touch a real Stripe order, because a real order's channel is `checkout`.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node scripts/ops/reset-demo-sales.mjs
 *   …                                  node scripts/ops/reset-demo-sales.mjs --dry-run
 */
import admin from 'firebase-admin';

const dry = process.argv.includes('--dry-run');
const PROJECT = process.env.GCLOUD_PROJECT ?? 'kgc-conference-app-and-website';

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the service-account file first.');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT });
const db = admin.firestore();

const orders = await db.collection('orders').where('channel', '==', 'demo').get();
if (orders.empty) {
  console.log('No demo orders to clear.');
  process.exit(0);
}

// Count per tier before deleting, so `quantitySold` can be decremented by the
// amount this actually removes rather than reset to zero — a tier may carry a
// seeded starting figure that is not ours to discard.
const soldBack = new Map();
const registrationIds = new Set();

for (const doc of orders.docs) {
  const o = doc.data();
  for (const line of o.items ?? []) {
    if (!line.ticketTypeId) continue;
    soldBack.set(line.ticketTypeId, (soldBack.get(line.ticketTypeId) ?? 0) + (line.quantity ?? 1));
  }
  for (const rid of o.registrationIds ?? []) registrationIds.add(rid);
  console.log(`  order ${doc.id} — ${o.email} — ${o.status}`);
}

for (const rid of registrationIds) console.log(`  registration ${rid}`);
for (const [tier, n] of soldBack) console.log(`  ${tier}.quantitySold -${n}`);

if (dry) {
  console.log('\n--dry-run: nothing deleted.');
  process.exit(0);
}

const batch = db.batch();
for (const doc of orders.docs) batch.delete(doc.ref);
for (const rid of registrationIds) batch.delete(db.collection('registrations').doc(rid));
for (const [tier, n] of soldBack) {
  batch.update(db.collection('ticketTypes').doc(tier), {
    quantitySold: admin.firestore.FieldValue.increment(-n),
  });
}
await batch.commit();

// The receipts that were never sent. Left behind they make the email log read
// as a backlog of failures rather than an empty slate.
const logs = await db.collection('emailLog').where('template', '==', 'purchase-confirmation').get();
const stale = logs.docs.filter((d) => registrationIds.has(d.data().registrationId));
if (stale.length) {
  const b2 = db.batch();
  for (const d of stale) b2.delete(d.ref);
  await b2.commit();
}

console.log(`\nCleared ${orders.size} order(s), ${registrationIds.size} registration(s), ${stale.length} email log entries.`);
