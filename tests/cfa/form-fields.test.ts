/**
 * The T276 form on the dashboard, against the emulator: the call editor's
 * six types and its two question switches, Schedule it for the new types,
 * and the phone in the submissions export and nowhere a reviewer reads.
 *
 * Run with: npm run test:cfa
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS, SUBMISSION_IDENTITY_DOC, type SessionDoc } from '@kgc/shared';
import { db } from '@/lib/firestore';
import { getCall, saveCall, type SaveCallInput } from '@/lib/calls';
import { exportByKind } from '@/lib/exports';
import { getSubmission, promoteSubmission } from '@/lib/submissions';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:cfa');
  }
});

const ACTOR = 'francois@kgc.test';

beforeEach(async () => {
  await db().recursiveDelete(db().collection(COLLECTIONS.submissions));
  for (const name of [
    COLLECTIONS.calls,
    COLLECTIONS.tracks,
    COLLECTIONS.sessions,
    COLLECTIONS.speakers,
    COLLECTIONS.rooms,
    COLLECTIONS.auditLog,
  ]) {
    const snap = await db().collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
});

const input = (over: Partial<SaveCallInput> = {}): SaveCallInput => ({
  title: 'Call for Speakers. KGC 2027',
  instructions: '',
  status: 'published',
  opensAtLocal: '2026-11-01T00:00',
  closesAtLocal: '2027-02-28T23:59',
  sessionTypes: ['talk', 'workshop', 'panel', 'hcls', 'poster', 'demo'],
  trackIds: [],
  allowOtherTrack: false,
  blindReview: 'single-blind',
  reviewsPerSubmission: 3,
  reminderDaysBefore: [],
  notifyEmails: [],
  actor: ACTOR,
  ...over,
});

async function seedSubmission(id: string, callId: string, over: Record<string, unknown> = {}, phone?: string) {
  const ref = db().collection(COLLECTIONS.submissions).doc(id);
  await ref.set({
    eventId: EVENT_ID,
    callId,
    title: `Session ${id}`,
    abstract: 'A description.',
    sessionType: 'talk',
    answers: {},
    formVersion: 1,
    status: 'submitted',
    submitterTokenHash: 'x',
    submittedAt: new Date('2026-11-02T15:00:00Z'),
    reviewsAssigned: 0,
    reviewsSubmitted: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });
  await ref.collection(SUBCOLLECTIONS.identity).doc(SUBMISSION_IDENTITY_DOC).set({
    eventId: EVENT_ID,
    submissionId: id,
    callId,
    name: `Author ${id}`,
    email: `${id}@authors.test`,
    affiliation: 'Sample Org',
    ...(phone ? { phone } : {}),
    coAuthors: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('the call editor', () => {
  it('stores the six types and the two switches, and a save without the switches leaves them', async () => {
    const r = await saveCall(input({ askTrack: true, askTalkLength: false }));
    if (!r.ok) throw new Error(r.error);
    // A CFP call: the switches only mean something once `cfp` is set.
    await db().collection(COLLECTIONS.calls).doc(r.id).set({ cfp: {} }, { merge: true });

    let call = await getCall(r.id);
    expect(call?.sessionTypes).toEqual(['talk', 'workshop', 'panel', 'hcls', 'poster', 'demo']);
    expect(call?.isCfp).toBe(true);
    expect(call?.askTrack).toBe(true);
    expect(call?.askTalkLength).toBe(false);

    // A save from a form that did not show the switches does not reset them.
    await saveCall(input({ id: r.id, title: 'Renamed' }));
    call = await getCall(r.id);
    expect(call?.askTrack).toBe(true);

    await saveCall(input({ id: r.id, askTrack: false, askTalkLength: true }));
    call = await getCall(r.id);
    expect(call?.askTrack).toBe(false);
    expect(call?.askTalkLength).toBe(true);
  });

  it('reads a CFP call saved before T276 as asking neither, and any other call as asking for a track', async () => {
    const r = await saveCall(input());
    if (!r.ok) throw new Error(r.error);
    expect((await getCall(r.id))?.askTrack).toBe(true);
    expect((await getCall(r.id))?.isCfp).toBe(false);
    await db().collection(COLLECTIONS.calls).doc(r.id).set({ cfp: {} }, { merge: true });
    expect((await getCall(r.id))?.askTrack).toBe(false);
    expect((await getCall(r.id))?.askTalkLength).toBe(false);
  });
});

describe('Schedule it', () => {
  it('puts the symposium and the demos on the agenda as talks, and a panel as a panel', async () => {
    const r = await saveCall(input());
    if (!r.ok) throw new Error(r.error);
    await db().collection(COLLECTIONS.rooms).doc('hall').set({ eventId: EVENT_ID, name: 'Hall' });
    const cases: [string, string][] = [
      ['hcls', 'talk'],
      ['demo', 'talk'],
      ['panel', 'panel'],
    ];
    for (const [i, [type, format]] of cases.entries()) {
      const id = `sub_${type}`;
      await seedSubmission(id, r.id, { sessionType: type, status: 'accepted' });
      const out = await promoteSubmission({
        submissionId: id,
        startsAtLocal: `2027-05-05T1${i}:00`,
        endsAtLocal: `2027-05-05T1${i}:45`,
        roomId: 'hall',
        actor: ACTOR,
      });
      if (!out.ok) throw new Error(out.error);
      const sessionId = (await getSubmission(id))?.sessionId;
      const session = (await db().collection(COLLECTIONS.sessions).doc(sessionId!).get()).data() as SessionDoc;
      expect(session.format).toBe(format);
      expect(session.trackIds).toEqual([]);
    }
  });
});

describe('the phone number', () => {
  it('is in the submissions export and on the organizer’s row, and not on the submission', async () => {
    const r = await saveCall(input());
    if (!r.ok) throw new Error(r.error);
    await seedSubmission('sub_p', r.id, { sessionType: 'hcls', resourceLink: 'https://example.org/deck' }, '+1 212 555 0100');
    await seedSubmission('sub_q', r.id, {});

    const row = await getSubmission('sub_p');
    expect(row?.author?.phone).toBe('+1 212 555 0100');
    const doc = (await db().collection(COLLECTIONS.submissions).doc('sub_p').get()).data();
    expect(doc && 'phone' in doc).toBe(false);

    const { csv, rows } = await exportByKind('cfp-submissions')!.build();
    expect(rows).toBe(2);
    const [header, ...lines] = csv.trim().split(/\r?\n/);
    expect(header).toContain('Phone');
    expect(header).toContain('Session Type & Format');
    const p = lines.find((l) => l.includes('Session sub_p'))!;
    expect(p).toContain('+1 212 555 0100');
    expect(p).toContain('Health Care and Life Sciences (HCLS) Symposium');
    expect(p).toContain('https://example.org/deck');
    expect(csv).not.toContain('undefined');
  });
});
