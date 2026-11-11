/**
 * The "Other" track on the dashboard (T271), against the emulator: the call
 * editor's setting, and "Other: <topic>" wherever a submission's track is
 * named, including the acceptance notice to Min.
 *
 * Run with: npm run test:cfa
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS, SUBMISSION_IDENTITY_DOC } from '@kgc/shared';
import { db } from '@/lib/firestore';
import { getCall, saveCall, type SaveCallInput } from '@/lib/calls';
import { acceptCfp, getCfpCall, listCfpSubmissions } from '@/lib/cfp';
import { listSubmissions } from '@/lib/submissions';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:cfa');
  }
});

const ACTOR = 'francois@kgc.test';
let outbox = '';

beforeEach(async () => {
  await db().recursiveDelete(db().collection(COLLECTIONS.submissions));
  for (const name of [
    COLLECTIONS.calls,
    COLLECTIONS.tracks,
    COLLECTIONS.emailLog,
    COLLECTIONS.speakers,
    COLLECTIONS.speakerProfileEdits,
    COLLECTIONS.speakerContacts,
    COLLECTIONS.auditLog,
  ]) {
    const snap = await db().collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  outbox = mkdtempSync(path.join(tmpdir(), 't271-dash-'));
  process.env.EMAIL_CAPTURE_DIR = outbox;
});

const input = (over: Partial<SaveCallInput> = {}): SaveCallInput => ({
  title: 'Call for Speakers. KGC 2027',
  instructions: '',
  status: 'published',
  opensAtLocal: '2026-11-01T00:00',
  closesAtLocal: '2027-02-28T23:59',
  sessionTypes: ['talk', 'workshop', 'panel'],
  trackIds: ['metadata'],
  allowOtherTrack: true,
  blindReview: 'single-blind',
  reviewsPerSubmission: 3,
  reminderDaysBefore: [],
  notifyEmails: [],
  actor: ACTOR,
  ...over,
});

async function seedSubmission(id: string, callId: string, track: Record<string, string>) {
  const ref = db().collection(COLLECTIONS.submissions).doc(id);
  await ref.set({
    eventId: EVENT_ID,
    callId,
    title: `Talk ${id}`,
    abstract: 'An abstract.',
    ...track,
    sessionType: 'talk',
    durationMinutes: 25,
    answers: {},
    formVersion: 1,
    status: 'submitted',
    submitterTokenHash: 'x',
    submittedAt: new Date('2026-11-02T15:00:00Z'),
    reviewsAssigned: 0,
    reviewsSubmitted: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await ref.collection(SUBCOLLECTIONS.identity).doc(SUBMISSION_IDENTITY_DOC).set({
    eventId: EVENT_ID,
    submissionId: id,
    callId,
    name: 'Sample Author',
    email: `${id}@authors.test`,
    affiliation: 'Sample Org',
    coAuthors: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('the call editor', () => {
  it('stores Other on the call and never as a track', async () => {
    const r = await saveCall(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await getCall(r.id))?.allowOtherTrack).toBe(true);
    expect((await getCall(r.id))?.trackIds).toEqual(['metadata']);
    expect((await db().collection(COLLECTIONS.tracks).get()).size).toBe(0);

    await saveCall(input({ id: r.id, allowOtherTrack: false }));
    expect((await getCall(r.id))?.allowOtherTrack).toBe(false);
  });

  it('reads an older call without the setting as off, and keeps the ticked types in order', async () => {
    const r = await saveCall(input());
    if (!r.ok) throw new Error(r.error);
    // A call saved before T271 has no such field at all.
    const ref = db().collection(COLLECTIONS.calls).doc(r.id);
    const { allowOtherTrack: _dropped, ...older } = (await ref.get()).data() ?? {};
    await ref.set(older);
    expect((await getCall(r.id))?.allowOtherTrack).toBe(false);
    expect((await getCfpCall(r.id))?.sessionTypes).toEqual(['talk', 'workshop', 'panel']);
  });
});

describe('a submission under Other', () => {
  it('reads "Other: <topic>" on the review list and in the notice to Min', async () => {
    const r = await saveCall(input());
    if (!r.ok) throw new Error(r.error);
    await db().collection(COLLECTIONS.calls).doc(r.id).set(
      { cfp: { acceptNoticeEmail: 'min@kgc.test', decisionDate: '2027-03-14' } },
      { merge: true },
    );
    await db().collection(COLLECTIONS.tracks).doc('metadata').set({ eventId: EVENT_ID, name: 'Metadata' });
    await seedSubmission('sub_other', r.id, { trackOther: 'Logistics' });
    await seedSubmission('sub_meta', r.id, { trackId: 'metadata' });

    const rows = await listSubmissions(r.id);
    expect(rows.find((s) => s.id === 'sub_other')?.trackOther).toBe('Logistics');

    const cfp = await listCfpSubmissions(r.id);
    expect(cfp.find((s) => s.id === 'sub_other')?.trackName).toBe('Other: Logistics');
    expect(cfp.find((s) => s.id === 'sub_meta')?.trackName).toBe('Metadata');

    const accepted = await acceptCfp({ submissionId: 'sub_other', actor: ACTOR, nowMs: Date.parse('2026-11-10T15:00:00Z') });
    expect(accepted.ok).toBe(true);
    const notice = readdirSync(outbox)
      .map((f) => JSON.parse(readFileSync(path.join(outbox, f), 'utf8')) as { template: string; text: string })
      .find((m) => m.template === 'cfp-accept-notice');
    expect(notice?.text).toContain('Other: Logistics');
  });
});
