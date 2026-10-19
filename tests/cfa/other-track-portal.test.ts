/**
 * The "Other" track on the public form (T271), against the emulator: offered
 * only when the call allows it, the typed topic saved as `trackOther` with no
 * `trackId`, and validated on the server like the rest of the form.
 *
 * Run with: npm run test:cfa
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COLLECTIONS, EVENT_ID, type SubmissionDoc } from '@kgc/shared';
import { OTHER_TRACK } from '@kgc/scripts/src/lib/cfp-core';
import { db } from '@/lib/firestore';
import { loadCall, loadOwnSubmission, saveSubmission, type SubmitInput } from '@/lib/submissions';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:cfa');
  }
});

const CALL_ID = 'call-for-speakers-kgc-2027';
const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await db().recursiveDelete(db().collection(COLLECTIONS.submissions));
  for (const name of [COLLECTIONS.calls, COLLECTIONS.tracks, COLLECTIONS.emailLog]) {
    const snap = await db().collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  delete process.env.EMAIL_CAPTURE_DIR;
});

async function seedCall(over: Record<string, unknown> = {}): Promise<void> {
  const now = Date.now();
  await db()
    .collection(COLLECTIONS.calls)
    .doc(CALL_ID)
    .set({
      eventId: EVENT_ID,
      title: 'Call for Speakers. KGC 2027',
      instructions: 'Plain.',
      status: 'published',
      timeZone: 'America/New_York',
      opensAtLocal: '2026-10-01T00:00',
      closesAtLocal: '2027-02-28T23:59',
      opensAt: new Date(now - HOUR),
      closesAt: new Date(now + HOUR),
      sessionTypes: ['talk', 'workshop'],
      trackIds: ['metadata'],
      form: [],
      formVersion: 1,
      priorVersions: [],
      blindReview: 'single-blind',
      reviewsPerSubmission: 3,
      reminderDaysBefore: [],
      notifyEmails: [],
      ...over,
    });
  await db().collection(COLLECTIONS.tracks).doc('metadata').set({ eventId: EVENT_ID, name: 'Metadata' });
}

const talk = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  title: 'Lineage at scale',
  abstract: 'An abstract long enough for a committee to read, about what we built and why.',
  trackId: OTHER_TRACK,
  trackOther: 'Logistics and supply chains',
  sessionType: 'talk',
  answers: {},
  authorName: 'Sample Author',
  authorEmail: 'author@example.test',
  affiliation: 'Sample Org',
  coAuthors: [],
  finish: true,
  ...over,
});

const raw = async (id: string) =>
  (await db().collection(COLLECTIONS.submissions).doc(id).get()).data() as SubmissionDoc;

describe('a call without Other', () => {
  it('does not offer it and refuses it', async () => {
    await seedCall();
    expect((await loadCall(CALL_ID))?.allowOtherTrack).toBe(false);
    const r = await saveSubmission(CALL_ID, talk());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.trackId).toBe('That is not one of this call’s tracks.');
  });

  it('still saves a real track exactly as before', async () => {
    await seedCall();
    const r = await saveSubmission(CALL_ID, talk({ trackId: 'metadata', trackOther: undefined }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = await raw(r.submissionId);
    expect(doc.trackId).toBe('metadata');
    expect(doc).not.toHaveProperty('trackOther');
  });
});

describe('a call with Other', () => {
  it('saves the topic and no track id, and gives it back on the edit page', async () => {
    await seedCall({ allowOtherTrack: true });
    expect((await loadCall(CALL_ID))?.allowOtherTrack).toBe(true);
    const r = await saveSubmission(CALL_ID, talk());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = await raw(r.submissionId);
    expect(doc.trackOther).toBe('Logistics and supply chains');
    expect(doc).not.toHaveProperty('trackId');
    const own = await loadOwnSubmission(r.submissionId);
    expect(own?.trackOther).toBe('Logistics and supply chains');
    expect(own?.trackId).toBeUndefined();
  });

  it('needs the topic to submit, and refuses one over 80 characters', async () => {
    await seedCall({ allowOtherTrack: true });
    const empty = await saveSubmission(CALL_ID, talk({ trackOther: '  ' }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.fieldErrors?.trackOther).toBe('Say which topic.');

    const long = await saveSubmission(CALL_ID, talk({ trackOther: 'x'.repeat(81), finish: false }));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.fieldErrors?.trackOther).toMatch(/80 characters/);
  });

  it('clears the topic when the author moves to a real track', async () => {
    await seedCall({ allowOtherTrack: true });
    const first = await saveSubmission(CALL_ID, talk({ finish: false }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await saveSubmission(
      CALL_ID,
      talk({ trackId: 'metadata', trackOther: 'stale text', finish: false }),
      first.submissionId,
    );
    expect(second.ok).toBe(true);
    const doc = await raw(first.submissionId);
    expect(doc.trackId).toBe('metadata');
    expect(doc).not.toHaveProperty('trackOther');
  });

  it('asks for a track when Other is the only choice', async () => {
    await seedCall({ allowOtherTrack: true, trackIds: [] });
    const r = await saveSubmission(CALL_ID, talk({ trackId: undefined, trackOther: undefined }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.trackId).toBe('Choose a track.');
  });
});
