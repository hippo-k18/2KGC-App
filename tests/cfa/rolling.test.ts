/**
 * Min's rolling review on the dashboard (T249), against the emulator: one-click
 * accept, reject that sends nothing, E3 on a moved clock, the Thursday
 * reminder, E4 in both versions and the single E6.
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
  type CallDoc,
  type SpeakerDoc,
  type SpeakerProfileEditDoc,
  type SubmissionDoc,
  type SubmissionIdentityDoc,
} from '@kgc/shared';
import { speakerId } from '@kgc/scripts/src/lib/ids';
import { db } from '@/lib/firestore';
import { decideMany, decideSubmission } from '@/lib/submissions';
import {
  acceptCfp,
  rejectCfp,
  runCfpSchedule,
  saveCfpSettings,
  saveDeclineReason,
  sendCloseDecisions,
  sendStillOpen,
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
  outbox = mkdtempSync(path.join(tmpdir(), 't249-dash-'));
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

async function seedCall(cfp: CallCfpSettings = CFP): Promise<void> {
  await db().collection(COLLECTIONS.calls).doc(CALL_ID).set({
    eventId: EVENT_ID,
    title: 'Call for Speakers. KGC 2027',
    instructions: '',
    status: 'published',
    timeZone: 'America/New_York',
    opensAtLocal: '2026-11-01T00:00',
    closesAtLocal: '2027-02-28T23:59',
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
const ACCEPT_AT = Date.parse('2026-11-10T15:00:00Z');

describe('Accept, in one click', () => {
  it('records it, creates the speaker unlisted, mails E2 and tells Min', async () => {
    await seedCall();
    await seed('sub_a');
    const r = await acceptCfp({ submissionId: 'sub_a', actor: ACTOR, nowMs: ACCEPT_AT });
    expect(r.ok).toBe(true);

    const sub = await raw('sub_a');
    expect(sub.status).toBe('accepted');
    const sid = speakerId('Ada Lovelace', 'Analytical Engines');
    expect(sub.acceptance?.speakerId).toBe(sid);
    expect(sub.acceptance?.e2SentAt?.toMillis()).toBe(ACCEPT_AT);
    expect(sub.acceptance?.detailsDueAt?.toMillis()).toBe(ACCEPT_AT + 7 * DAY);

    const speaker = (await db().collection(COLLECTIONS.speakers).doc(sid).get()).data() as SpeakerDoc;
    expect(speaker.unlisted).toBe(true);
    // The address is server-only since T252, never on the readable record.
    expect(speaker).not.toHaveProperty('contactEmail');
    const contact = (await db().collection(COLLECTIONS.speakerContacts).doc(sid).get()).data();
    expect(contact?.email).toBe('sub_a@authors.test');
    const edit = (await db().collection(COLLECTIONS.speakerProfileEdits).doc(sid).get()).data() as SpeakerProfileEditDoc;
    expect(edit.submissionIds).toEqual(['sub_a']);
    expect(edit.status).toBe('sent');
    const identity = (
      await db().collection(COLLECTIONS.submissions).doc('sub_a').collection(SUBCOLLECTIONS.identity).doc(SUBMISSION_IDENTITY_DOC).get()
    ).data() as SubmissionIdentityDoc;
    expect(identity.speakerId).toBe(sid);

    const [e2, notice] = mail();
    expect(e2.template).toBe('cfp-accepted');
    expect(e2.to).toBe('sub_a@authors.test');
    expect(e2.text).toContain('Talk sub_a\nPresentation Talks & Keynotes, 45 minutes');
    expect(e2.text).toContain('within one week, by Tuesday 17 November 2026.');
    expect(e2.text).toContain('Your session day and time will be shared by Monday 1 March 2027.');
    expect(e2.text).toMatch(/→ http:\/\/localhost:3200\/speaker\/\S+/);
    expect(notice.template).toBe('cfp-accept-notice');
    expect(notice.to).toBe('min@kgc.test');
    for (const fact of ['Ada Lovelace', 'Analytical Engines', 'Talk sub_a', 'Metadata', 'Tuesday 10 November 2026', '/submissions/sub_a']) {
      expect(notice.text).toContain(fact);
    }
    for (const m of mail()) expect(m.text).not.toMatch(/\[|—/);
  });

  it('leaves the track out of the notice and the length out of the type line when there are none (T276)', async () => {
    await seedCall();
    await seed('sub_n', { bare: true, sessionType: 'hcls' });
    const r = await acceptCfp({ submissionId: 'sub_n', actor: ACTOR, nowMs: ACCEPT_AT });
    expect(r.ok).toBe(true);
    const [e2, notice] = mail();
    expect(e2.text).toContain('Talk sub_n\nHealth Care and Life Sciences (HCLS) Symposium\n');
    expect(notice.text).not.toMatch(/Track:/);
    expect(notice.text).toContain('Type: Health Care and Life Sciences (HCLS) Symposium');
    for (const m of mail()) expect(m.text).not.toMatch(/undefined|· ·|: \n/);
  });

  it('is harmless to press twice, and finds a speaker who already exists', async () => {
    await seedCall();
    await seed('sub_a');
    await seed('sub_b');
    await acceptCfp({ submissionId: 'sub_a', actor: ACTOR, nowMs: ACCEPT_AT });
    await acceptCfp({ submissionId: 'sub_a', actor: ACTOR, nowMs: ACCEPT_AT });
    expect(mail().filter((m) => m.template === 'cfp-accepted')).toHaveLength(1);

    // Same author, second talk: the same speaker, both submissions on the link.
    await acceptCfp({ submissionId: 'sub_b', actor: ACTOR, nowMs: ACCEPT_AT });
    expect((await db().collection(COLLECTIONS.speakers).get()).size).toBe(1);
    const sid = speakerId('Ada Lovelace', 'Analytical Engines');
    const edit = (await db().collection(COLLECTIONS.speakerProfileEdits).doc(sid).get()).data() as SpeakerProfileEditDoc;
    expect(edit.submissionIds?.sort()).toEqual(['sub_a', 'sub_b']);
  });
});

describe('Reject', () => {
  it('records the decision and sends nothing', async () => {
    await seedCall();
    await seed('sub_r');
    expect((await rejectCfp({ submissionId: 'sub_r', actor: ACTOR })).ok).toBe(true);
    expect((await raw('sub_r')).status).toBe('rejected');
    expect(mail()).toHaveLength(0);
  });
});

describe('changing an acceptance (T262)', () => {
  it('refuses Reject on an accepted submission until the acceptance is withdrawn, then keeps it out of E4', async () => {
    await seedCall({ ...CFP, closeDate: '2027-02-28' });
    await seed('sub_yes');
    await acceptCfp({ submissionId: 'sub_yes', actor: ACTOR, nowMs: ACCEPT_AT });
    expect((await raw('sub_yes')).acceptance?.e2SentAt).toBeTruthy();
    const sid = (await raw('sub_yes')).acceptance!.speakerId!;

    const refused = await rejectCfp({ submissionId: 'sub_yes', actor: ACTOR });
    expect(refused.ok).toBe(false);
    expect((await raw('sub_yes')).status).toBe('accepted');

    const done = await rejectCfp({ submissionId: 'sub_yes', actor: ACTOR, withdrawAccepted: true });
    expect(done.ok && done.message).toMatch(/will not get the “not accepted” email/);
    const after = await raw('sub_yes');
    expect(after.status).toBe('rejected');
    expect(after.acceptance?.withdrawnAt).toBeTruthy();
    expect(((await db().collection(COLLECTIONS.speakers).doc(sid).get()).data() as SpeakerDoc).unlisted).toBe(true);
    const edit = (await db().collection(COLLECTIONS.speakerProfileEdits).doc(sid).get()).data() as SpeakerProfileEditDoc;
    expect(edit.submissionIds ?? []).not.toContain('sub_yes');

    const before = mail().length;
    await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: Date.parse('2027-03-14T16:00:00Z') });
    expect(mail().slice(before).filter((m) => m.template === 'cfp-decision-declined')).toHaveLength(0);
  });

  it('sends E2 straight away to someone accepted after E4 already told them no (T258 #8)', async () => {
    await seedCall({ ...CFP, closeDate: '2027-02-28' });
    await seed('sub_turn');
    await rejectCfp({ submissionId: 'sub_turn', actor: ACTOR });
    await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: Date.parse('2027-03-14T16:00:00Z') });
    expect((await raw('sub_turn')).closeDecision?.version).toBe('declined');

    const r = await acceptCfp({ submissionId: 'sub_turn', actor: ACTOR, nowMs: Date.parse('2027-03-16T15:00:00Z') });
    expect(r.ok && r.e2).toBe('sent');
    expect((await raw('sub_turn')).acceptance?.e2HeldForE4).toBeUndefined();
    expect(mail().filter((m) => m.template === 'cfp-accepted')).toHaveLength(1);
  });
});

describe('the hourly run', () => {
  it('retries an owed E2 once, and then E3 can count from it (T258 #5)', async () => {
    await seedCall();
    await seed('sub_owed');
    await acceptCfp({ submissionId: 'sub_owed', actor: ACTOR, nowMs: ACCEPT_AT });
    // As if the send had failed: owed, never sent. The map is rewritten rather than
    // using a delete sentinel, which would come from another firebase-admin copy (gotcha 8).
    const { e2SentAt: _s, detailsDueAt: _d, ...rest } = (await raw('sub_owed')).acceptance!;
    void _s;
    void _d;
    await db()
      .collection(COLLECTIONS.submissions)
      .doc('sub_owed')
      .update({ acceptance: { ...rest, e2Owed: true } });
    const before = mail().filter((m) => m.template === 'cfp-accepted').length;

    const run = await runCfpSchedule(ACCEPT_AT + DAY);
    expect(run.e2Retried).toEqual(['sub_owed']);
    const after = await raw('sub_owed');
    expect(after.acceptance?.e2Owed).toBeUndefined();
    expect(after.acceptance?.e2SentAt?.toMillis()).toBe(ACCEPT_AT + DAY);
    expect(mail().filter((m) => m.template === 'cfp-accepted')).toHaveLength(before + 1);
    expect((await runCfpSchedule(ACCEPT_AT + 2 * DAY)).e2Retried).toEqual([]);
  });

  it('sends no Thursday reminder before the call opens (T258 #17)', async () => {
    await seedCall();
    await seed('sub_early', { submittedAt: new Date('2026-10-28T15:00:00Z') });
    expect((await runCfpSchedule(Date.parse('2026-10-29T14:00:00Z'))).reminded).toEqual([]);
  });

  it('nudges five days after E2, once, and not someone who sent their details', async () => {
    await seedCall();
    await seed('sub_a');
    await seed('sub_d', { name: 'Grace Hopper' });
    await acceptCfp({ submissionId: 'sub_a', actor: ACTOR, nowMs: ACCEPT_AT });
    await acceptCfp({ submissionId: 'sub_d', actor: ACTOR, nowMs: ACCEPT_AT });
    await db().collection(COLLECTIONS.submissions).doc('sub_d').update({
      details: { title: 't', description: 'd', receivedAt: new Date(ACCEPT_AT + DAY) },
    });
    const before = mail().length;

    // Monday: four days, nothing.
    expect((await runCfpSchedule(ACCEPT_AT + 4 * DAY)).nudged).toEqual([]);
    // Sunday 15 November: five days.
    const run = await runCfpSchedule(ACCEPT_AT + 5 * DAY);
    expect(run.nudged).toEqual(['sub_a']);
    const e3 = mail().slice(before).find((m) => m.template === 'cfp-nudge')!;
    expect(e3.subject).toBe('Still need a few details for your KGC 2027 session');
    expect(e3.text).toContain('The week is up on Tuesday 17 November 2026.');
    expect((await raw('sub_a')).acceptance?.nudgedAt).toBeTruthy();

    expect((await runCfpSchedule(ACCEPT_AT + 6 * DAY)).nudged).toEqual([]);
  });

  it('reminds the reviewer on Thursday from 9:00 New York time, once a week', async () => {
    await seedCall();
    await seed('sub_new', { submittedAt: new Date('2026-11-11T15:00:00Z') });
    const thu0830 = Date.parse('2026-11-12T13:30:00Z');
    const thu0900 = Date.parse('2026-11-12T14:00:00Z');
    expect((await runCfpSchedule(thu0830)).reminded).toEqual([]);
    expect((await runCfpSchedule(thu0900)).reminded).toEqual([CALL_ID]);
    expect((await runCfpSchedule(thu0900 + 3_600_000)).reminded).toEqual([]);
    const r = mail().find((m) => m.template === 'cfp-weekly-reminder')!;
    expect(r.to).toBe('francois@kgc.test');
    expect(r.text).toContain('Hi François,');
    expect(r.text).toContain('1 new submission has arrived since your last pass. 1 in all');
    // The next Thursday it goes again.
    expect((await runCfpSchedule(thu0900 + 7 * DAY)).reminded).toEqual([CALL_ID]);
  });

  it('sends nothing for a call without the settings', async () => {
    await seedCall();
    const ref = db().collection(COLLECTIONS.calls).doc(CALL_ID);
    const { cfp: _drop, ...rest } = (await ref.get()).data() as CallDoc;
    void _drop;
    await ref.set(rest);
    await seed('sub_x');
    expect((await runCfpSchedule(Date.parse('2026-11-12T14:00:00Z'))).calls).toBe(0);
  });
});

describe('after the close', () => {
  const AFTER = Date.parse('2027-03-02T15:00:00Z');
  /** Close 28 February + 14 days, in New York. */
  const E4_OPEN = Date.parse('2027-03-14T16:00:00Z');

  it('holds E2 for an acceptance after the close, then E4 sends both versions once', async () => {
    await seedCall({ ...CFP, closeDate: '2027-02-28' });
    await seed('sub_late');
    await seed('sub_no', { name: 'Grace Hopper' });
    await seed('sub_open', { name: 'Alan Turing' });

    await acceptCfp({ submissionId: 'sub_late', actor: ACTOR, nowMs: AFTER });
    expect((await raw('sub_late')).acceptance?.e2HeldForE4).toBe(true);
    expect(mail().map((m) => m.template)).toEqual(['cfp-accept-notice']);

    await rejectCfp({ submissionId: 'sub_no', actor: ACTOR });
    expect((await saveDeclineReason('sub_no', 'The program already covers this ground.', ACTOR)).ok).toBe(true);

    // Whenever it is pressed, not only from two weeks after the close (T275).
    const r = await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: E4_OPEN });
    expect(r.ok && r.message).toMatch(/1 “not accepted” and 1 “accepted”.*1 still undecided/);

    const sent = mail().slice(1);
    expect(sent.map((m) => m.template)).toEqual(['cfp-decision-declined', 'cfp-decision-accepted', 'cfp-accepted']);
    expect(sent[0].text).toContain('We are not able to fit it into the 2027 program. The program already covers this ground.');
    expect(sent[1].text).toContain('in the message that follows this one');
    expect((await raw('sub_late')).acceptance?.e2SentAt?.toMillis()).toBe(E4_OPEN);
    expect((await raw('sub_late')).acceptance?.e2HeldForE4).toBeUndefined();
    expect((await raw('sub_no')).closeDecision?.reason).toBe('The program already covers this ground.');
    expect((await raw('sub_open')).closeDecision).toBeUndefined();

    await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: E4_OPEN + DAY });
    expect(mail()).toHaveLength(4);
    expect((await saveDeclineReason('sub_no', 'Changed', ACTOR)).ok).toBe(false);
  });

  it('E6 goes once to everyone still open', async () => {
    await seedCall();
    await seed('sub_1');
    await seed('sub_2', { status: 'rejected' });
    expect((await sendStillOpen({ callId: CALL_ID, actor: ACTOR })).ok).toBe(true);
    expect(mail().map((m) => [m.template, m.to])).toEqual([['cfp-still-open', 'sub_1@authors.test']]);
    expect(mail()[0].text).toContain('You will have an answer by Sunday 14 March 2027 at the latest');
    await sendStillOpen({ callId: CALL_ID, actor: ACTOR });
    expect(mail()).toHaveLength(1);
  });
});

describe('rejections go only when Send is pressed (T275)', () => {
  const CLOSED = { ...CFP, closeDate: '2027-02-28' };
  const LATER = [ACCEPT_AT, Date.parse('2027-03-02T15:00:00Z'), Date.parse('2027-03-15T15:00:00Z'), Date.parse('2027-06-01T15:00:00Z')];
  const declined = () => mail().filter((m) => m.template === 'cfp-decision-declined' || m.template === 'submission-decision');

  it('Reject from the weekly review, the submission page and the bulk bar sends nothing, then or later', async () => {
    await seedCall(CLOSED);
    await seed('sub_a');
    await seed('sub_b');
    await seed('sub_c');
    // The three screens all call this one function on a rolling call.
    for (const id of ['sub_a', 'sub_b', 'sub_c']) expect((await rejectCfp({ submissionId: id, actor: ACTOR })).ok).toBe(true);
    // No timer sends it either, before the close or long after.
    for (const at of LATER) await runCfpSchedule(at);
    expect(declined()).toHaveLength(0);
    expect(mail().filter((m) => m.to.endsWith('@authors.test'))).toHaveLength(0);
  });

  it('the old "Email the author" option sends nothing on a rolling call, single or bulk', async () => {
    await seedCall(CLOSED);
    await seed('sub_a');
    await seed('sub_b');
    await seed('sub_c');
    const one = await decideSubmission({ id: 'sub_a', accept: false, notify: true, note: 'No.', actor: ACTOR });
    expect(one.ok && one.message).toMatch(/Nothing was sent/);
    expect((await raw('sub_a')).status).toBe('rejected');
    const many = await decideMany({ ids: ['sub_b', 'sub_c'], accept: false, notify: true, actor: ACTOR });
    expect(many.ok).toBe(true);
    expect((await raw('sub_c')).status).toBe('rejected');
    expect(mail()).toHaveLength(0);
  });

  it('withdrawing an acceptance sends no "not accepted" email, now or from Send', async () => {
    await seedCall(CLOSED);
    await seed('sub_yes');
    await acceptCfp({ submissionId: 'sub_yes', actor: ACTOR, nowMs: ACCEPT_AT });
    const before = mail().length;
    expect((await rejectCfp({ submissionId: 'sub_yes', actor: ACTOR, withdrawAccepted: true })).ok).toBe(true);
    for (const at of LATER) await runCfpSchedule(at);
    await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: LATER[2] });
    expect(mail().slice(before).filter((m) => m.to === 'sub_yes@authors.test')).toHaveLength(0);
  });

  it('Send works while the call is open, but only with the second box ticked', async () => {
    await seedCall(CLOSED);
    await seed('sub_no');
    await seed('sub_open', { name: 'Alan Turing' });
    await rejectCfp({ submissionId: 'sub_no', actor: ACTOR });

    const refused = await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: ACCEPT_AT });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatch(/still open.*Nothing was sent/);
    expect(mail()).toHaveLength(0);

    const r = await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: ACCEPT_AT, confirmStillOpen: true });
    expect(r.ok && r.message).toMatch(/Sent 1 “not accepted” and 0 “accepted”.*1 still undecided was left alone/);
    expect(mail().map((m) => [m.template, m.to])).toEqual([['cfp-decision-declined', 'sub_no@authors.test']]);
    expect((await raw('sub_open')).closeDecision).toBeUndefined();
  });

  it('a call with no close date counts as open', async () => {
    await seedCall();
    await seed('sub_no');
    await rejectCfp({ submissionId: 'sub_no', actor: ACTOR });
    expect((await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: LATER[3] })).ok).toBe(false);
    expect((await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: LATER[3], confirmStillOpen: true })).ok).toBe(true);
    expect(declined()).toHaveLength(1);
  });

  it('each author is told once; a later press tells only those rejected since', async () => {
    await seedCall(CLOSED);
    await seed('sub_1');
    await seed('sub_2', { name: 'Grace Hopper' });
    await rejectCfp({ submissionId: 'sub_1', actor: ACTOR });
    await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: LATER[1] });
    await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: LATER[1] + DAY });
    expect(declined().map((m) => m.to)).toEqual(['sub_1@authors.test']);

    await rejectCfp({ submissionId: 'sub_2', actor: ACTOR });
    expect(declined()).toHaveLength(1);
    await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: LATER[2] });
    await sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: LATER[3] });
    expect(declined().map((m) => m.to)).toEqual(['sub_1@authors.test', 'sub_2@authors.test']);
  });
});

describe('the settings', () => {
  it('writes the close date through to the deadline, and a blank date as no field', async () => {
    await seedCall({ decisionDate: '2027-03-14' });
    const r = await saveCfpSettings(
      CALL_ID,
      {
        closeDate: '2027-01-31',
        decisionDate: '',
        sessionNoticeDate: '',
        acceptNoticeEmail: 'Min@Example.org',
        reviewerReminderEmail: '',
        abstractMaxWords: '300',
        talkMinutes: '25, 45',
      },
      ACTOR,
    );
    expect(r.ok).toBe(true);
    const call = (await db().collection(COLLECTIONS.calls).doc(CALL_ID).get()).data() as CallDoc;
    expect(call.closesAtLocal).toBe('2027-01-31T23:59');
    expect((call.closesAt as unknown as { toDate(): Date }).toDate().toISOString()).toBe('2027-02-01T04:59:00.000Z');
    expect(call.cfp?.decisionDate).toBeUndefined();
    expect(call.cfp?.acceptNoticeEmail).toBe('min@example.org');
    expect(call.cfp?.talkMinutes).toEqual([25, 45]);

    const bad = await saveCfpSettings(CALL_ID, { closeDate: '', decisionDate: '', sessionNoticeDate: '', acceptNoticeEmail: 'nope', reviewerReminderEmail: '', abstractMaxWords: '', talkMinutes: '25' }, ACTOR);
    expect(bad.ok).toBe(false);
  });
});

/**
 * T250 F2: two organizers pressing the same button at once. Each send is
 * claimed in a transaction before it goes, so N concurrent calls send once.
 */
describe('concurrent presses send once (T252)', () => {
  it('Accept pressed three times at once: one E2, one notice, one speaker, no raw error', async () => {
    await seedCall();
    await seed('sub_a');
    const results = await Promise.all(
      [1, 2, 3].map(() => acceptCfp({ submissionId: 'sub_a', actor: ACTOR, nowMs: ACCEPT_AT })),
    );
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.message).not.toMatch(/ALREADY_EXISTS|EntityRef|\d+ [A-Z_]+:/);
    }
    expect(mail().filter((m) => m.template === 'cfp-accepted')).toHaveLength(1);
    expect(mail().filter((m) => m.template === 'cfp-accept-notice')).toHaveLength(1);
    expect((await db().collection(COLLECTIONS.speakers).get()).size).toBe(1);
  });

  it('two talks by one new author accepted at once share one speaker and both succeed', async () => {
    await seedCall();
    await seed('sub_a');
    await seed('sub_b');
    const [a, b] = await Promise.all([
      acceptCfp({ submissionId: 'sub_a', actor: ACTOR, nowMs: ACCEPT_AT }),
      acceptCfp({ submissionId: 'sub_b', actor: ACTOR, nowMs: ACCEPT_AT }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect((await db().collection(COLLECTIONS.speakers).get()).size).toBe(1);
    expect(mail().filter((m) => m.template === 'cfp-accepted')).toHaveLength(2);
  });

  it('E6 pressed five times at once sends once per author', async () => {
    await seedCall();
    await seed('sub_1');
    await seed('sub_2', { name: 'Grace Hopper' });
    await Promise.all([1, 2, 3, 4, 5].map(() => sendStillOpen({ callId: CALL_ID, actor: ACTOR })));
    expect(mail().map((m) => m.to).sort()).toEqual(['sub_1@authors.test', 'sub_2@authors.test']);
  });

  it('E4 pressed three times at once sends each version once', async () => {
    const AFTER = Date.parse('2027-03-02T15:00:00Z');
    const OPEN = Date.parse('2027-03-14T16:00:00Z');
    await seedCall({ ...CFP, closeDate: '2027-02-28' });
    await seed('sub_late');
    await seed('sub_no', { name: 'Grace Hopper' });
    await acceptCfp({ submissionId: 'sub_late', actor: ACTOR, nowMs: AFTER });
    await rejectCfp({ submissionId: 'sub_no', actor: ACTOR });
    await Promise.all([1, 2, 3].map(() => sendCloseDecisions({ callId: CALL_ID, actor: ACTOR, nowMs: OPEN })));
    const t = mail().map((m) => m.template);
    expect(t.filter((x) => x === 'cfp-decision-declined')).toHaveLength(1);
    expect(t.filter((x) => x === 'cfp-decision-accepted')).toHaveLength(1);
    expect(t.filter((x) => x === 'cfp-accepted')).toHaveLength(1);
  });

  it('the hourly run started three times at once sends one E3 and one reminder', async () => {
    await seedCall();
    await seed('sub_a');
    await acceptCfp({ submissionId: 'sub_a', actor: ACTOR, nowMs: ACCEPT_AT });
    const before = mail().length;
    // Thursday 19 November 2026, 10:00 in New York: E3 is due and so is the reminder.
    const when = Date.parse('2026-11-19T15:00:00Z');
    await Promise.all([1, 2, 3].map(() => runCfpSchedule(when)));
    const t = mail().slice(before).map((m) => m.template);
    expect(t.filter((x) => x === 'cfp-nudge')).toHaveLength(1);
    expect(t.filter((x) => x === 'cfp-weekly-reminder')).toHaveLength(1);
  });
});
