// The website's trigger, as a paid order or a refund fires it: queue the
// registrations and start a drain without awaiting it. Then waits until that
// drain has written its run to the log (or a timeout), so the spec can assert.
//   npx tsx kick.mts <trigger> <registrationId>...
import { COLLECTIONS, type HubspotTrigger } from '@kgc/shared';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { queueAndKickHubspot } from '../../../scripts/src/lib/hubspot-sync.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST || !/^(127\.0\.0\.1|localhost):8333$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('kick.mts only runs against the private emulator on 8333');
  process.exit(1);
}
if (!/^http:\/\/127\.0\.0\.1:12133\/?$/.test(process.env.HUBSPOT_API_BASE ?? '')) {
  console.error('kick.mts only runs against the fake HubSpot on 12133');
  process.exit(1);
}

const [trigger, ...ids] = process.argv.slice(2);
initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-hubspot-e2e' });
const db = getFirestore();
const runs = db.collection(COLLECTIONS.integrations).doc('hubspot').collection('runs');
const start = Date.now();
const problems: string[] = [];

await queueAndKickHubspot(db, ids, trigger as HubspotTrigger, (what, err) => problems.push(`${what}: ${String(err)}`));

const deadline = Date.now() + Number(process.env.KICK_TIMEOUT_MS ?? 90_000);
let found = 0;
while (Date.now() < deadline) {
  found = (await runs.where('startedAt', '>=', start).count().get()).data().count;
  if (found > 0) break;
  await new Promise((r) => setTimeout(r, 300));
}
console.log(JSON.stringify({ runs: found, problems }));
process.exit(found > 0 && problems.length === 0 ? 0 : 2);
