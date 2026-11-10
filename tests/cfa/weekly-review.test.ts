/**
 * The weekly review fixes for François (T378), against the emulator: Leave is
 * recorded and comes back after the next pass, Accept sends the email as
 * edited in its dialog, "Contact the author" sends one logged message, and
 * the screens open on the call the website shows.
 *
 * Every email is captured to a file (`EMAIL_CAPTURE_DIR`) and read back.
 *
 * Run with: npm run test:cfa
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  SUBMISSION_IDENTITY_DOC,
  type CallCfpSettings,
  type SubmissionDoc,
} from '@kgc/shared';
import { db } from '@/lib/firestore';
import {
  acceptCfp,
  contactAuthor,
  contactDraft,
  currentCfpCallId,
  finishPass,
  getCfpCall,
  leaveCfp,
  listCfpSubmissions,
  listContactMessages,
  previewAcceptEmail,
  rejectCfp,
  reviewQueue,
} from '@/lib/cfp';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:cfa');
  }
});

const ACTOR = 'francois@kgc.test';
const CALL_ID = 'call-for-speakers-kgc-2027';
const DAY = 24 * 60 * 60 * 1000;
let outbox = '';

async function wipe() {
  await db().recursiveDelete(db().collection(COLLECTIONS.submissions));
  for (const name of [
    COLLECTIONS.calls,
    COLLECTIONS.tracks,
    COLLECTIONS.emailLog,
    COLLECTIONS.speakers,
    COLLECTIONS.speakerProfileEdits,
    COLLECTIONS.speakerContacts,
    COLLECTIONS.auditLog,
    COLLECTIONS.teamMembers,
  ]) {
    const snap = await db().collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

beforeEach(async () => {
  await wipe();
  outbox = mkdtempSync(path.join(tmpdir(), 't378-review-'));
  process.env.EMAIL_CAPTURE_DIR = outbox;
});

interface Captured {
  to: string;
  subject: string;
  template: string;
  text: string;
}
const mail = (): Captured[] =>
  readdirSync(outbox)
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(outbox, f), 'utf8')) as Captured);

const CFP: CallCfpSettings = {
  acceptNoticeEmail: 'min@kgc.test',
  reviewerReminderEmail: 'francois@kgc.test',
  sessionNoticeDate: '2027-03-01',
  decisionDate: '2027-03-14',
};

async function seedCall(cfp: CallCfpSettings = CFP, closesAtLocal = '2027-02-28T23:59'): Promise<void> {
  await db().collection(COLLECTIONS.calls).doc(CALL_ID).set({
    eventId: EVENT_ID,
    title: 'Call for Speakers. KGC 2027',
    instructions: '',
    status: 'published',
    timeZone: 'America/New_York',
    opensAtLocal: '2026-11-01T00:00',
    closesAtLocal,
    opensAt: new Date('2026-11-01T04:00:00Z'),
    closesAt: new Date('2027-03-01T04:59:00Z'),
    sessionTypes: ['talk', 'workshop'],
    trackIds: ['metadata'],
    form: [],
    formVersion: 1,
    priorVersions: [],
    blindReview: 'single-blind',
    reviewsPerSubmission: 3,
    reminderDaysBefore: [],
    notifyEmails: [],
    cfp,
  });
  await db().collection(COLLECTIONS.tracks).doc('metadata').set({ eventId: EVENT_ID, name: 'Metadata' });
  await db()
    .collection(COLLECTIONS.teamMembers)
    .doc('team_f')
    .set({ eventId: EVENT_ID, email: 'francois@kgc.test', name: 'François', roles: ['owner'], status: 'active' });
}

async function seed(
  id: string,
  over: {
    sessionType?: 'talk' | 'workshop' | 'hcls';
    status?: SubmissionDoc['status'];
    name?: string;
    submittedAt?: Date;
    /** Neither a track nor a length, as the T276 form sends. */
    bare?: boolean;
  } = {},
): Promise<string> {
  const ref = db().collection(COLLECTIONS.submissions).doc(id);
  await ref.set({
    eventId: EVENT_ID,
    callId: CALL_ID,
    title: `Talk ${id}`,
    abstract: 'An abstract.',
    ...(over.bare ? {} : { trackId: 'metadata' }),
    sessionType: over.sessionType ?? 'talk',
    ...(over.sessionType === 'workshop' || over.bare ? {} : { durationMinutes: 45 }),
    answers: {},
    formVersion: 1,
    status: over.status ?? 'submitted',
    submitterTokenHash: 'x',
    submittedAt: over.submittedAt ?? new Date('2026-11-02T15:00:00Z'),
    reviewsAssigned: 0,
    reviewsSubmitted: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await ref
    .collection(SUBCOLLECTIONS.identity)
    .doc(SUBMISSION_IDENTITY_DOC)
    .set({
      eventId: EVENT_ID,
      submissionId: id,
      callId: CALL_ID,
      name: over.name ?? 'Ada Lovelace',
      email: `${id}@authors.test`,
      affiliation: 'Analytical Engines',
      coAuthors: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  return id;
}

const raw = async (id: string) =>
  (await db().collection(COLLECTIONS.submissions).doc(id).get()).data() as SubmissionDoc;

/** Tuesday 10 November 2026, 10:00 in New York: before the close. */
const NOW = Date.parse('2026-11-10T15:00:00Z');

async function queueIds(): Promise<{ id: string; isNew: boolean }[]> {
  const call = await getCfpCall(CALL_ID);
  const rows = await listCfpSubmissions(CALL_ID);
  return reviewQueue(rows, call?.cfp.lastPassAtMs).map(({ row, isNew }) => ({ id: row.id, isNew }));
}

const audit = async (action: string) =>
  (await db().collection(COLLECTIONS.auditLog).where('action', '==', action).get()).docs.map((d) => d.data());

describe('Leave is recorded (T378)', () => {
  it('takes the talk off this pass, keeps its status, and brings it back after the next pass without New', async () => {
    await seedCall();
    await seed('sub_l', { submittedAt: new Date(NOW - 2 * DAY) });
    await seed('sub_k', { submittedAt: new Date(NOW - DAY) });
    expect((await queueIds()).map((q) => q.id)).toEqual(['sub_k', 'sub_l']);

    const r = await leaveCfp({ submissionId: 'sub_l', actor: ACTOR, nowMs: NOW });
    expect(r.ok).toBe(true);
    const sub = await raw('sub_l');
    expect(sub.status).toBe('submitted');
    expect(sub.reviewLeft?.by).toBe(ACTOR);
    expect(sub.reviewLeft?.at.toMillis()).toBe(NOW);
    expect((await queueIds()).map((q) => q.id)).toEqual(['sub_k']);

    // Still on the Submissions list, with its real status.
    const all = await listCfpSubmissions(CALL_ID);
    expect(all.find((s) => s.id === 'sub_l')?.status).toBe('submitted');

    const left = await audit('submission.cfpLeave');
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ actor: ACTOR, targetId: 'sub_l' });

    await finishPass(CALL_ID, ACTOR, NOW + 60_000);
    const back = await queueIds();
    expect(back.map((q) => q.id)).toEqual(['sub_l', 'sub_k']);
    expect(back.every((q) => !q.isNew)).toBe(true);
    // Nothing was sent.
    expect(mail()).toHaveLength(0);
  });

  it('refuses a decided talk, and Accept and Reject still take a talk off the list', async () => {
    await seedCall();
    await seed('sub_a');
    await seed('sub_r');
    await seed('sub_o');
    await acceptCfp({ submissionId: 'sub_a', actor: ACTOR, nowMs: NOW });
    await rejectCfp({ submissionId: 'sub_r', actor: ACTOR, nowMs: NOW });
    expect((await queueIds()).map((q) => q.id)).toEqual(['sub_o']);
    const again = await leaveCfp({ submissionId: 'sub_a', actor: ACTOR, nowMs: NOW });
    expect(again.ok).toBe(false);
    expect((await raw('sub_a')).reviewLeft).toBeUndefined();
  });
});

describe('Accept shows the email first (T378)', () => {
  it('previews E2 as it would go, the CEU line for a workshop included, and writes nothing', async () => {
    await seedCall();
    await seed('sub_w', { sessionType: 'workshop' });
    const before = await raw('sub_w');
    const p = await previewAcceptEmail('sub_w', NOW);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.held).toBe(false);
    expect(p.to).toBe('sub_w@authors.test');
    expect(p.subject).toBe('Your session is in: KGC 2027');
    expect(p.text).toContain('Hi Ada,');
    expect(p.text).toContain('Continuing Education Units');
    expect(p.text).toContain('/speaker/');
    expect(await raw('sub_w')).toEqual(before);
    expect(mail()).toHaveLength(0);
  });

  it('says the email is held once the call has closed', async () => {
    await seedCall(CFP, '2026-11-05T23:59');
    await seed('sub_h');
    const p = await previewAcceptEmail('sub_h', NOW);
    expect(p.ok && p.held).toBe(true);
  });

  it('sends the edited words, logs them, and keeps them for a retry', async () => {
    await seedCall();
    await seed('sub_e');
    const p = await previewAcceptEmail('sub_e', NOW);
    if (!p.ok) throw new Error(p.error);
    const text = p.text.replace('Welcome aboard.', 'Welcome aboard. We loved this one.');
    const r = await acceptCfp({ submissionId: 'sub_e', actor: ACTOR, nowMs: NOW, e2Edited: { subject: 'You are in', text } });
    expect(r.ok).toBe(true);
    const e2 = mail().filter((m) => m.template === 'cfp-accepted');
    expect(e2).toHaveLength(1);
    expect(e2[0].subject).toBe('You are in');
    expect(e2[0].text).toContain('We loved this one.');
    const sub = await raw('sub_e');
    expect(sub.status).toBe('accepted');
    expect(sub.acceptance?.e2Edited).toEqual({ subject: 'You are in', text });

    const log = (await db().collection(COLLECTIONS.emailLog).where('template', '==', 'cfp-accepted').get()).docs;
    expect(log).toHaveLength(1);
    expect(log[0].data()).toMatchObject({ subject: 'You are in', status: 'sent', submissionId: 'sub_e', hasBody: true });
    const body = (await db().collection(COLLECTIONS.emailBodies).doc(log[0].id).get()).data();
    expect(String(body?.text)).toContain('We loved this one.');
  });

  it('sends the standard email when the dialog was not used (bulk accept)', async () => {
    await seedCall();
    await seed('sub_s');
    await acceptCfp({ submissionId: 'sub_s', actor: ACTOR, nowMs: NOW });
    const e2 = mail().filter((m) => m.template === 'cfp-accepted');
    expect(e2[0].subject).toBe('Your session is in: KGC 2027');
    expect((await raw('sub_s')).acceptance?.e2Edited).toBeUndefined();
  });
});

describe('Contact the author (T378)', () => {
  it('sends one email from contact@ with replies to contact@, logs it, lists it and audits it', async () => {
    await seedCall();
    await seed('sub_c');
    const d = await contactDraft('sub_c');
    expect(d).toMatchObject({ ok: true, to: 'sub_c@authors.test' });
    const r = await contactAuthor({
      submissionId: 'sub_c',
      subject: 'A question about your talk',
      text: 'Hi Ada,\n\nCould you shorten the abstract?\n\nBest,\nThe KGC team',
      actor: ACTOR,
      nowMs: NOW,
    });
    expect(r.ok).toBe(true);
    const sent = mail() as (Captured & { from: string; replyTo: string })[];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'sub_c@authors.test', template: 'cfp-contact', subject: 'A question about your talk' });
    expect(sent[0].from).toContain('contact@knowledgegraph.tech');
    expect(sent[0].replyTo).toBe('contact@knowledgegraph.tech');
    expect(sent[0].text).toContain('Could you shorten the abstract?');

    const log = (await db().collection(COLLECTIONS.emailLog).where('template', '==', 'cfp-contact').get()).docs;
    expect(log).toHaveLength(1);
    expect(log[0].data()).toMatchObject({ actor: ACTOR, submissionId: 'sub_c', status: 'sent' });

    const list = await listContactMessages('sub_c');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ by: ACTOR, subject: 'A question about your talk', outcome: 'sent', atMs: NOW });
    expect(await audit('submission.cfpContact')).toHaveLength(1);
    // Kept apart from the submission a blind reviewer is handed.
    expect(JSON.stringify(await raw('sub_c'))).not.toContain('shorten');
    // Status unchanged.
    expect((await raw('sub_c')).status).toBe('submitted');
  });

  it('refuses an empty message and a submission with no author', async () => {
    await seedCall();
    await seed('sub_c');
    expect((await contactAuthor({ submissionId: 'sub_c', subject: ' ', text: 'x', actor: ACTOR })).ok).toBe(false);
    expect((await contactAuthor({ submissionId: 'sub_c', subject: 'x', text: '  ', actor: ACTOR })).ok).toBe(false);
    await db()
      .collection(COLLECTIONS.submissions)
      .doc('sub_c')
      .collection(SUBCOLLECTIONS.identity)
      .doc(SUBMISSION_IDENTITY_DOC)
      .delete();
    expect((await contactAuthor({ submissionId: 'sub_c', subject: 'x', text: 'y', actor: ACTOR })).ok).toBe(false);
    expect(mail()).toHaveLength(0);
  });
});

describe('the screens open on the real call (T378)', () => {
  it('picks the call shown on the website over Min\'s test call, which closes later', async () => {
    await seedCall();
    await db().collection(COLLECTIONS.calls).doc(CALL_ID).update({ showOnWebsite: true, updatedAt: new Date('2026-11-01T00:00:00Z') });
    await db().collection(COLLECTIONS.calls).doc('test-draft-min-call-for-speakers-kgc-2027').set({
      eventId: EVENT_ID,
      title: 'Test draft',
      status: 'published',
      opensAt: new Date('2026-11-01T04:00:00Z'),
      closesAt: new Date('2027-06-01T04:00:00Z'),
      updatedAt: new Date('2026-11-09T00:00:00Z'),
      cfp: {} as CallCfpSettings,
    });
    expect(await currentCfpCallId(NOW)).toBe(CALL_ID);
  });
});

