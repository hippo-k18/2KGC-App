/**
 * A call for abstracts with a few submissions and a small committee, for the
 * local emulator: `npm run seed:cfa --workspace=@kgc/scripts`.
 *
 * ⚠️ **Emulator only, and it refuses anything else.** The live event has no call
 * yet and its first one should be an organizer's, made on the dashboard. This
 * exists so the review round — criteria, assignment, the reviewer's page, the
 * ranking, the decisions — can be walked through end to end without typing five
 * abstracts first.
 *
 * It seeds the *start* of a round on purpose: nothing is assigned and nothing is
 * scored, because assignment and scoring are the write paths worth exercising
 * and a seed that did them would prove only that a seed can write.
 *
 * Idempotent, and careful about it: a document that already exists is left
 * alone, so running it again does not wipe the scores somebody entered since.
 *
 * Dates are native `Date`s. Sentinels built in this package are fine for this
 * package's own store, but the habit is not worth having (AGENTS.md gotcha 8).
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  SUBMISSION_IDENTITY_DOC,
  TIME_ZONE,
} from '@kgc/shared';
import { db, targetDescription } from './lib/firestore.js';
import { reviewerId } from './lib/ids.js';
import { DEFAULT_RUBRIC } from './lib/review-core.js';

const CALL_ID = 'kgc-2027-call-for-abstracts';

const SUBMISSIONS = [
  {
    id: 'sub_cfademo_provenance',
    title: 'Provenance at scale: three years of lineage in an enterprise graph',
    abstract:
      'Four business units write to one knowledge graph and nobody agreed who owns a fact. We describe the provenance layer we built over it, what it cost in write latency, and the two audits it has already survived.\n\nThe talk covers the model, the named-graph strategy we abandoned, and the query patterns analysts actually use.',
    trackId: 'graph-data-science',
    author: { name: 'Ada Okonkwo', email: 'ada.okonkwo@example.org', affiliation: 'Acme Graphs' },
  },
  {
    id: 'sub_cfademo_embeddings',
    title: 'When graph embeddings lie: evaluating link prediction honestly',
    abstract:
      'Most published link prediction numbers are inflated by test leakage through inverse relations. We re-evaluate six popular models on three cleaned benchmarks and show the ranking changes.\n\nWe close with a checklist for anyone reporting these metrics.',
    trackId: 'graph-data-science',
    author: { name: 'Marek Havel', email: 'marek.havel@example.org', affiliation: 'Charles University' },
  },
  {
    id: 'sub_cfademo_fraud',
    title: 'Fraud rings in real time with a streaming graph',
    abstract:
      'A payments company moved ring detection from a nightly batch to a streaming graph. We show the architecture, the false positive rate before and after, and the on-call cost nobody budgets for.',
    trackId: 'graph-data-science',
    author: { name: 'Priya Raman', email: 'priya.raman@example.org', affiliation: 'Northwind Pay' },
  },
  {
    id: 'sub_cfademo_taxonomy',
    title: 'One taxonomy, eleven languages: governance that survived a merger',
    abstract:
      'Two publishers merged with two product taxonomies and eleven languages between them. This is the governance model that produced one, the tooling behind it, and the three decisions we would reverse.',
    trackId: 'ontologies-taxonomies',
    author: { name: 'Sofie Lindqvist', email: 'sofie.lindqvist@example.org', affiliation: 'Bokhuset' },
  },
  {
    id: 'sub_cfademo_shacl',
    title: 'SHACL in production: validation as a deployment gate',
    abstract:
      'We made SHACL validation a required check on every ontology change. We report eighteen months of what it caught, what it missed, and how long the shapes took to write compared with the ontology itself.',
    trackId: 'ontologies-taxonomies',
    author: { name: 'Tomás Reyes', email: 'tomas.reyes@example.org', affiliation: 'Universidad de Chile' },
  },
];

const REVIEWERS = [
  { name: 'Dr Helen Marsh', email: 'helen.marsh@example.edu', affiliation: 'University of Leeds', trackIds: ['graph-data-science', 'ontologies-taxonomies'] },
  { name: 'Kwame Mensah', email: 'kwame.mensah@example.com', affiliation: 'Graphwise', trackIds: ['graph-data-science'] },
  { name: 'Prof Ingrid Solberg', email: 'ingrid.solberg@example.edu', affiliation: 'NTNU', trackIds: ['ontologies-taxonomies', 'graph-data-science'] },
];

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'seed-cfa-demo only runs against the emulator. Set FIRESTORE_EMULATOR_HOST=localhost:8080.',
    );
  }
  console.log(`Seeding a demo call into the ${targetDescription()}`);

  const store = db();
  const now = new Date();
  let wrote = 0;

  const callRef = store.collection(COLLECTIONS.calls).doc(CALL_ID);
  if (!(await callRef.get()).exists) {
    await callRef.set({
      eventId: EVENT_ID,
      title: 'KGC 2027 Call for Abstracts',
      instructions:
        'Tell us what the work is, who it is for, and what somebody in the room will take away.\n\nAbstracts are reviewed blind by three members of the programme committee.',
      status: 'published',
      timeZone: TIME_ZONE,
      opensAtLocal: '2026-09-01T09:00',
      closesAtLocal: '2026-12-15T23:59',
      // New York is UTC-4 in September and UTC-5 in December.
      opensAt: new Date('2026-09-01T13:00:00.000Z'),
      closesAt: new Date('2026-12-16T04:59:00.000Z'),
      sessionTypes: ['talk', 'workshop'],
      trackIds: ['graph-data-science', 'ontologies-taxonomies'],
      form: [],
      formVersion: 1,
      priorVersions: [],
      blindReview: 'double-blind',
      rubric: DEFAULT_RUBRIC,
      reviewsPerSubmission: 2,
      reminderDaysBefore: [14, 7, 3],
      notifyEmails: [],
      createdAt: now,
      updatedAt: now,
    });
    wrote++;
  }

  for (const s of SUBMISSIONS) {
    const ref = store.collection(COLLECTIONS.submissions).doc(s.id);
    if ((await ref.get()).exists) continue;
    await ref.set({
      eventId: EVENT_ID,
      callId: CALL_ID,
      title: s.title,
      abstract: s.abstract,
      trackId: s.trackId,
      sessionType: 'talk',
      answers: {},
      formVersion: 1,
      status: 'submitted',
      submittedAt: now,
      // Nobody holds the link this hashes, which is right for an invented author.
      submitterTokenHash: createHash('sha256').update(randomBytes(24)).digest('hex'),
      reviewsAssigned: 0,
      reviewsSubmitted: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ref.collection(SUBCOLLECTIONS.identity).doc(SUBMISSION_IDENTITY_DOC).set({
      eventId: EVENT_ID,
      submissionId: s.id,
      callId: CALL_ID,
      ...s.author,
      coAuthors: [],
      createdAt: now,
      updatedAt: now,
    });
    wrote++;
  }

  for (const r of REVIEWERS) {
    const id = reviewerId(r.email);
    const ref = store.collection(COLLECTIONS.reviewers).doc(id);
    if ((await ref.get()).exists) continue;
    await ref.set({
      eventId: EVENT_ID,
      ...r,
      status: 'invited',
      maxAssignments: 5,
      assignedCount: 0,
      // Gates nothing (see `tokenHash` in the dashboard's `reviewers.ts`), so a
      // random one keeps this script free of the link-signing secret.
      inviteTokenHash: createHash('sha256').update(randomBytes(24)).digest('hex'),
      invitedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    wrote++;
  }

  console.log(
    wrote === 0
      ? 'Already seeded. Nothing was changed.'
      : `Wrote ${wrote} documents: call ${CALL_ID}, ${SUBMISSIONS.length} submissions, ${REVIEWERS.length} reviewers.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
