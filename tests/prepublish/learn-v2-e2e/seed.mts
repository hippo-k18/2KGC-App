// The owner's session epoch, a learn-only member and an agenda-only member, in
// the private emulator this suite runs against. Refuses to run without
// FIRESTORE_EMULATOR_HOST, so it can never touch live.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { COLLECTIONS, EVENT_ID, LEARN_LIBRARY_SAMPLE, LEARN_PAGE_KITCHEN_SINK, LEARN_PAGE_KITCHEN_SINK_V2, type LearnPageContent } from '@kgc/shared';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { validateLearnContent, validateLearnSection } from '../../../apps/organizer/src/lib/learn-page-core.ts';
import { memberIdFor } from '../../../apps/organizer/src/lib/team-core.ts';
import { hostileButValid } from './payloads.ts';
import { AGENDA, LEARN, OWNER, ownerSessionId } from './people.ts';

// 8323 by default; run.sh may move it (LEARN_E2E_FS_PORT), never onto the shared 8080.
const port = process.env.FIRESTORE_REST?.match(/:(\d+)$/)?.[1] ?? '8323';
const emu = process.env.FIRESTORE_EMULATOR_HOST ?? '';
if (port === '8080' || !new RegExp(`^(127\\.0\\.0\\.1|localhost):${port}$`).test(emu)) {
  console.error(`seed.mts only runs against the private emulator on ${port}`);
  process.exit(1);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-learn-v2-e2e' });
const db = getFirestore();
await db
  .collection(COLLECTIONS.ownerSessions)
  .doc(ownerSessionId(OWNER))
  .set({ epoch: randomBytes(16).toString('hex'), updatedAt: new Date() });
for (const [email, roles] of [
  [LEARN, ['learn']],
  [AGENDA, ['agenda']],
] as const) {
  await db.collection(COLLECTIONS.teamMembers).doc(memberIdFor(email)).set({
    email,
    name: email.split('@')[0],
    roles: [...roles],
    status: 'active',
    sessionEpoch: randomBytes(16).toString('hex'),
    eventId: EVENT_ID,
    invitedBy: OWNER,
    updatedBy: OWNER,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
// Every block kind (T328): the v2 sink holds 17, the v1 sink the other 7.
const v2Kinds = new Set(LEARN_PAGE_KITCHEN_SINK_V2.sections.flatMap((s) => s.blocks.map((b) => b.kind)));
const rest = LEARN_PAGE_KITCHEN_SINK.sections.flatMap((s) => s.blocks).filter((b) => !v2Kinds.has(b.kind));
const sink24: LearnPageContent = structuredClone(LEARN_PAGE_KITCHEN_SINK_V2);
sink24.sections.push({
  ...structuredClone(LEARN_PAGE_KITCHEN_SINK_V2.sections[0]),
  id: 'sink-v1-kinds',
  anchor: 'v1-kinds',
  blocks: rest.map((b, i) => ({ ...structuredClone(b), id: `v1k-${i}` })),
});
const kinds = new Set(sink24.sections.flatMap((s) => s.blocks.map((b) => b.kind)));
if (kinds.size !== 24) throw new Error(`the e2e sink has ${kinds.size} block kinds, not 24`);
const pageOk = (c: unknown) => validateLearnContent(c).ok;
if (!pageOk(sink24)) throw new Error(`the e2e sink does not validate: ${JSON.stringify(validateLearnContent(sink24))}`);

// The most hostile page and saved sections the save check still accepts, stored as the save would store them.
const valid = validateLearnContent(hostileButValid(sink24, pageOk));
if (!valid.ok) throw new Error('hostileButValid produced a page the save refuses');
const sectionOk = (c: unknown) => validateLearnSection(c, { forLibrary: true }).ok;
const library = Object.fromEntries(
  Object.entries(LEARN_LIBRARY_SAMPLE).map(([id, section]) => {
    const v = validateLearnSection(hostileButValid(section, sectionOk), { forLibrary: true });
    if (!v.ok) throw new Error(`hostileButValid produced a saved section the save refuses: ${v.problems.join('; ')}`);
    return [id, v.section];
  }),
);

// The spec cannot import @kgc/shared's TypeScript, so the samples it needs are written beside it.
writeFileSync(
  new URL('./.fixtures.json', import.meta.url),
  JSON.stringify({ sink: LEARN_PAGE_KITCHEN_SINK_V2, sink24, library: LEARN_LIBRARY_SAMPLE, hostileValid: valid.content, hostileLibrary: library }),
);
console.log('[seed] owner epoch, a learn-only and an agenda-only member');
