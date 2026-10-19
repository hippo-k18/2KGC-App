/**
 * The dashboard's Email Log (T274), against the emulator: what `send()` keeps,
 * the list and its filters, the preview (stored, re-created, or not there),
 * and the Scheduled tab's reading of real submissions.
 *
 * No mail leaves: with no API key every send is `skipped` (and still logged
 * with its body), and `EMAIL_CAPTURE_DIR` writes the rest to files.
 *
 * Run with: npm run test:email-log
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  SUBMISSION_IDENTITY_DOC,
  type CallCfpSettings,
  type SubmissionDoc,
} from '@kgc/shared';
import { cfpReceivedMessage, sendCfpMessage, sendSignInCode } from '@kgc/scripts/src/lib/email';
import { db } from '@/lib/firestore';
import { getEmailPreview, listEmailLog } from '@/lib/email-log';
import { rangeMs } from '@/lib/email-log-core';
import { CRON_STATUS_DOC, loadSchedule, scheduleEnv, scheduledPreview } from '@/lib/email-schedule';

const NY = 'America/New_York';
const CALL_ID = 'call-kgc-2027';
const DAY = 86_400_000;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with: npm run test:email-log');
});

beforeEach(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_CAPTURE_DIR;
  delete process.env.CRON_SECRET;
  await db().recursiveDelete(db().collection(COLLECTIONS.submissions));
  for (const c of [
    COLLECTIONS.emailLog,
    COLLECTIONS.emailBodies,
    COLLECTIONS.calls,
    COLLECTIONS.registrations,
    COLLECTIONS.orders,
    COLLECTIONS.sendJobs,
    COLLECTIONS.settings,
  ]) {
    const snap = await db().collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
});

const CFP: CallCfpSettings = {
  closeDate: '2026-12-14',
  decisionDate: '2027-02-14',
  sessionNoticeDate: '2027-03-01',
  acceptNoticeEmail: 'min@kgc.test',
  reviewerReminderEmail: 'francois@kgc.test',
};

async function seedCall(cfp: CallCfpSettings = CFP) {
  await db().collection(COLLECTIONS.calls).doc(CALL_ID).set({
    eventId: EVENT_ID,
    title: 'Call for Speakers. KGC 2027',
    status: 'published',
    timeZone: NY,
    opensAtLocal: '2026-09-01T00:00',
    closesAtLocal: '2026-12-14T23:59',
    opensAt: new Date('2026-09-01T04:00:00Z'),
    closesAt: new Date('2026-12-15T04:59:00Z'),
    sessionTypes: ['talk', 'workshop'],
    form: [],
    formVersion: 1,
    cfp,
  });
}

async function seedSubmission(id: string, over: Partial<SubmissionDoc> = {}) {
  const ref = db().collection(COLLECTIONS.submissions).doc(id);
  await ref.set({
    eventId: EVENT_ID,
    callId: CALL_ID,
    title: `Graphs at ${id}`,
    abstract: 'An abstract.',
    sessionType: 'talk',
    durationMinutes: 25,
    answers: {},
    formVersion: 1,
    status: 'submitted',
    submittedAt: new Date('2026-10-02T15:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });
  await ref.collection(SUBCOLLECTIONS.identity).doc(SUBMISSION_IDENTITY_DOC).set({
    eventId: EVENT_ID,
    submissionId: id,
    callId: CALL_ID,
    name: 'Ada Lovelace',
    email: `${id}@authors.test`,
    coAuthors: [],
  });
}

/** A row the way `send()` wrote them before bodies were kept. */
async function oldRow(id: string, row: Record<string, unknown>) {
  await db()
    .collection(COLLECTIONS.emailLog)
    .doc(id)
    .set({ eventId: EVENT_ID, status: 'sent', subject: 'Old', to: 'ada@example.com', at: new Date('2026-10-01T15:00:00Z'), ...row });
}

const allRows = async () => (await db().collection(COLLECTIONS.emailLog).get()).docs;

describe('capture on send', () => {
  it('keeps the message under the row’s id, and the preview shows it exactly', async () => {
    process.env.EMAIL_CAPTURE_DIR = mkdtempSync(path.join(tmpdir(), 'kgc-t274-'));
    const message = cfpReceivedMessage({ name: 'Ada', title: 'Graphs', typeLine: 'Talk, 25 minutes' });
    expect(await sendCfpMessage(db(), { to: 'ada@example.com', template: 'cfp-received', submissionId: 's1', message })).toBe('sent');

    const [row] = await allRows();
    expect(row.get('hasBody')).toBe(true);
    const body = await db().collection(COLLECTIONS.emailBodies).doc(row.id).get();
    expect(body.get('html')).toBe(message.html);

    const preview = await getEmailPreview(row.id);
    expect(preview).toMatchObject({ kind: 'stored', subject: message.subject, html: message.html, text: message.text });
    expect(preview?.from).toContain('@');
  });

  it('never stores a sign-in code, even for a send that was skipped', async () => {
    expect(await sendSignInCode(db(), { to: 'ada@example.com', code: '918273', ttlMinutes: 10 })).toBe('skipped');
    const [row] = await allRows();
    expect(row.data()).toMatchObject({ status: 'skipped', template: 'sign-in-code', hasBody: true });
    const bodies = await db().collection(COLLECTIONS.emailBodies).get();
    expect(bodies.size).toBe(1);
    expect(JSON.stringify(bodies.docs[0].data())).not.toContain('918273');
    const preview = await getEmailPreview(row.id);
    expect(preview?.masked).toBe(true);
    expect(preview?.text).toContain('••••••');
  });
});

describe('the list', () => {
  beforeEach(async () => {
    await oldRow('a', { template: 'cfp-received', submissionId: 's1', at: new Date('2026-10-18T15:00:00Z') });
    await oldRow('b', { template: 'cfp-nudge', status: 'failed', error: '422', at: new Date('2026-10-17T15:00:00Z') });
    await oldRow('c', { template: 'purchase-confirmation', orderId: 'ord_1', to: 'bilal@example.com', at: new Date('2026-10-16T15:00:00Z') });
    // Late on the 18th in New York, early on the 19th in UTC.
    await oldRow('d', { template: 'sign-in-code', at: new Date('2026-10-19T03:30:00Z') });
    await oldRow('other', { template: 'cfp-received', eventId: 'kgc-2026' });
  });

  it('lists every email of this event, newest first', async () => {
    const { rows, capped } = await listEmailLog({}, {});
    expect(rows.map((r) => r.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(capped).toBe(false);
  });

  it('filters by group, status, search and New York dates', async () => {
    expect((await listEmailLog({ group: 'cfp' }, {})).rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect((await listEmailLog({ status: 'failed' }, {})).rows.map((r) => r.id)).toEqual(['b']);
    expect((await listEmailLog({ q: 'bilal' }, {})).rows.map((r) => r.id)).toEqual(['c']);
    const f = { from: '2026-10-18', to: '2026-10-18' };
    expect((await listEmailLog(f, rangeMs(f, NY))).rows.map((r) => r.id)).toEqual(['d', 'a']);
  });
});

describe('previews of rows from before bodies were kept', () => {
  it('re-creates E1 from the submission, clearly labelled, with no working link', async () => {
    await seedCall();
    await seedSubmission('s1');
    await oldRow('e1', { template: 'cfp-received', submissionId: 's1', to: 's1@authors.test' });
    const p = await getEmailPreview('e1');
    expect(p?.kind).toBe('recreated');
    expect(p?.subject).toBe('We received your KGC 2027 submission');
    expect(p?.html).toContain('Graphs at s1');
    // The owner's E1 copy (T275) names no date, and is from contact@.
    expect(p?.html).toContain('Thank you for submitting your proposal to the Knowledge Graph Conference (KGC)!');
    expect(p?.html).not.toContain('Sunday 14 February 2027');
    expect(p?.from).toBe('Knowledge Graph Conference <contact@knowledgegraph.tech>');
    expect(p?.text).toContain('[private link]');
    expect(p?.notes?.join(' ')).toMatch(/Built again/);
  });

  it('re-creates the decline with the reason it went with', async () => {
    await seedCall();
    await seedSubmission('s2', {
      status: 'rejected',
      closeDecision: { version: 'declined', reason: 'The track was full.', sentAt: new Date() as never, by: 'x' },
    } as Partial<SubmissionDoc>);
    await oldRow('e4', { template: 'cfp-decision-declined', submissionId: 's2' });
    const p = await getEmailPreview('e4');
    expect(p?.kind).toBe('recreated');
    expect(p?.text).toContain('The track was full.');
  });

  it('re-creates a ticket confirmation from the ticket and its order', async () => {
    await db().collection(COLLECTIONS.registrations).doc('reg_1').set({
      eventId: EVENT_ID,
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      ticketType: 'Main Conference',
      orderId: 'ord_1',
    });
    await db().collection(COLLECTIONS.orders).doc('ord_1').set({
      eventId: EVENT_ID,
      email: 'ada@example.com',
      totalCents: 79_900,
      currency: 'usd',
      items: [{ ticketTypeId: 'main', ticketTypeName: 'Main Conference', quantity: 1, unitPriceCents: 79_900 }],
    });
    await oldRow('t1', { template: 'purchase-confirmation', registrationId: 'reg_1', orderId: 'ord_1' });
    const p = await getEmailPreview('t1');
    expect(p?.kind).toBe('recreated');
    expect(p?.subject).toBe('Your Knowledge Graph Conference ticket: Main Conference');
    expect(p?.text).toContain('$799');
    expect(p?.text).toContain('/order/[private link]');
  });

  it('says when nothing can be shown, and from when previews exist', async () => {
    await oldRow('gone', { template: 'cfp-received', submissionId: 'deleted' });
    await oldRow('code', { template: 'sign-in-code' });
    expect(await getEmailPreview('gone')).toMatchObject({ kind: 'none', storedFromMs: undefined });

    await sendSignInCode(db(), { to: 'x@example.com', code: '123123', ttlMinutes: 10 });
    const p = await getEmailPreview('code');
    expect(p?.kind).toBe('none');
    expect(p?.storedFromMs).toBeGreaterThan(Date.parse('2026-10-01T00:00:00Z'));
  });

  it('refuses a row from another event', async () => {
    await oldRow('other', { template: 'cfp-received', eventId: 'kgc-2026' });
    expect(await getEmailPreview('other')).toBeNull();
  });
});

describe('the Scheduled tab', () => {
  const NOW = Date.parse('2026-10-20T14:15:00Z');

  it('finds E3, the reminder and the waiting E4 in real submissions', async () => {
    process.env.CRON_SECRET = 'x'.repeat(32);
    // Only so nothing reads as blocked; the Scheduled tab never sends.
    process.env.RESEND_API_KEY = 're_test_not_used';
    await seedCall();
    await seedSubmission('acc', {
      status: 'accepted',
      acceptance: { at: new Date(NOW - 3 * DAY), by: 'f', speakerId: 'spk_1', e2SentAt: new Date(NOW - 3 * DAY) },
    } as Partial<SubmissionDoc>);
    await seedSubmission('rej', { status: 'rejected' });
    await seedSubmission('open');

    const view = await loadSchedule(NOW);
    const keys = view.items.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['e3:acc', `reminder:${CALL_ID}`, `e4d:${CALL_ID}`, `e6:${CALL_ID}`]));
    const e3 = view.items.find((i) => i.key === 'e3:acc')!;
    // E2 at 17 Oct 14:15 UTC, five days on is 22 Oct 14:15: the 15:00 run.
    expect(new Date(e3.whenMs!).toISOString()).toBe('2026-10-22T15:00:00.000Z');
    expect(e3.blocked).toBeUndefined();

    const preview = await scheduledPreview('e3:acc', NOW);
    expect(preview?.subject).toBe('Still need a few details for your KGC 2027 session');
    expect(preview?.to).toBe('acc@authors.test');
    expect(preview?.text).toContain('Graphs at acc');

    const e4 = await scheduledPreview(`e4d:${CALL_ID}`, NOW);
    expect(e4?.recipients?.map((r) => r.email)).toEqual(['rej@authors.test']);
    expect(e4?.text).toContain('We are not able to fit it into the 2027 program.');
  });

  it('says so when the reminder address is empty and the hourly run is not set up', async () => {
    process.env.RESEND_API_KEY = 're_test_not_used';
    await seedCall({ ...CFP, reviewerReminderEmail: '' });
    await seedSubmission('acc', {
      status: 'accepted',
      acceptance: { at: new Date(NOW), by: 'f', speakerId: 'spk_1', e2SentAt: new Date(NOW - DAY) },
    } as Partial<SubmissionDoc>);
    const view = await loadSchedule(NOW);
    expect(view.items.find((i) => i.key === `reminder:${CALL_ID}`)?.blocked).toMatch(/address is empty/);
    expect(view.items.find((i) => i.key === 'e3:acc')?.blocked).toMatch(/CRON_SECRET/);
    expect(view.calls[0].missing).toEqual(['Weekly reminder address']);
  });

  it('reads when the hourly run last called in', async () => {
    expect((await scheduleEnv()).lastCronRunMs).toBeUndefined();
    await db().collection(COLLECTIONS.settings).doc(CRON_STATUS_DOC).set({ lastRunAtMs: 1234 });
    expect((await scheduleEnv()).lastCronRunMs).toBe(1234);
  });

  it('the cron route records the run, and nothing on the Email Log screens can send', () => {
    const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../apps/organizer/src/${p}`, import.meta.url)), 'utf8');
    expect(read('app/api/cron/cfp/route.ts')).toContain('CRON_STATUS_DOC');
    for (const p of [
      'app/(dash)/tools/email-log/page.tsx',
      'app/(dash)/tools/email-log/[id]/page.tsx',
      'app/(dash)/tools/email-log/scheduled/[key]/page.tsx',
      'lib/email-log.ts',
      'lib/email-schedule.ts',
    ]) {
      const src = read(p);
      expect(src, p).not.toMatch(/'use server'|\bsend(Cfp|SignIn|Bulk|Purchase)\w*\(/);
    }
  });
});
