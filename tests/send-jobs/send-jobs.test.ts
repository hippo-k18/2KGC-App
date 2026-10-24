/**
 * The background bulk send (T265, T258 #1/#16) against the Firestore emulator:
 * the real `startBulkSend` with a fake sender, so the lock, the resume from
 * `emailLog` and the counters are what production runs.
 *
 * Run with: npm run test:send-jobs (its own emulator, port 8165).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import type { SendOutcome } from '@kgc/scripts/src/lib/email';
import { db as dashDb } from '@/lib/firestore';
import { readSendJob, sentAddresses, startBulkSend } from '@/lib/send-jobs';

let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:send-jobs');
  }
  db = dashDb() as unknown as Firestore;
});

async function wipe(collection: string) {
  const snap = await db.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
  await Promise.all([COLLECTIONS.emailLog, COLLECTIONS.sendJobs, COLLECTIONS.sendLocks].map(wipe));
});

const people = [
  { email: 'ada@example.com', name: 'Ada' },
  { email: 'ADA@example.com', name: 'Ada twice' },
  { email: 'bo@example.com', name: 'Bo' },
  { email: 'cy@example.com', name: 'Cy' },
];

/** A sender that logs like `send()` does and answers from a script. */
function sender(answer: (email: string) => SendOutcome, calls: string[], campaign = { issuedAt: 0 }) {
  return async (r: { email: string }, ctx: { campaignId: string; issuedAt: number }): Promise<SendOutcome> => {
    calls.push(r.email);
    campaign.issuedAt = ctx.issuedAt;
    const status = answer(r.email);
    await db.collection(COLLECTIONS.emailLog).add({
      eventId: EVENT_ID,
      to: r.email,
      template: 'bulk-message',
      subject: 'Hello',
      campaignId: ctx.campaignId,
      status,
      at: new Date(),
    });
    return status;
  };
}

const start = (campaignId: string, send: ReturnType<typeof sender>, onFirstRun?: () => Promise<void>) =>
  startBulkSend({
    store: db,
    campaignId,
    kind: 'campaign',
    audience: 'list',
    label: 'the list',
    subject: 'Hello',
    actor: 'owner@example.com',
    recipients: people,
    send,
    onFirstRun,
  });

describe('a background bulk send', () => {
  it('mails each folded address once, counts real outcomes and finishes the job', async () => {
    const calls: string[] = [];
    const r = await start('campaign_a', sender((e) => (e === 'bo@example.com' ? 'failed' : 'sent'), calls));
    expect(r.started).toBe(true);
    if (!r.started) return;
    expect(r).toMatchObject({ total: 3, todo: 3, duplicates: 1, alreadySent: 0, resumed: false });
    await r.done;

    expect(calls).toEqual(['ada@example.com', 'bo@example.com', 'cy@example.com']);
    const job = await readSendJob(db, 'campaign_a');
    expect(job).toMatchObject({ view: 'done', sent: 2, failed: 1, total: 3 });
    expect((await db.collection(COLLECTIONS.sendLocks).doc('campaign_a').get()).exists).toBe(false);
  });

  it('resumes on a second press: only the failed person is mailed, with the same issuedAt', async () => {
    const first: string[] = [];
    const seenFirst = { issuedAt: 0 };
    const r1 = await start('campaign_b', sender((e) => (e === 'bo@example.com' ? 'failed' : 'sent'), first, seenFirst));
    if (!r1.started) throw new Error('did not start');
    await r1.done;

    let firstRuns = 0;
    const second: string[] = [];
    const seenSecond = { issuedAt: 0 };
    const r2 = await start('campaign_b', sender(() => 'sent', second, seenSecond), async () => void firstRuns++);
    if (!r2.started) throw new Error('did not resume');
    expect(r2).toMatchObject({ resumed: true, alreadySent: 2, todo: 1 });
    await r2.done;

    expect(second).toEqual(['bo@example.com']);
    expect(firstRuns).toBe(0);
    expect(seenSecond.issuedAt).toBe(seenFirst.issuedAt);
    expect([...(await sentAddresses(db, 'campaign_b'))].sort()).toEqual([
      'ada@example.com',
      'bo@example.com',
      'cy@example.com',
    ]);
  });

  it('says there is nothing left once everybody has it, and mails nobody', async () => {
    const r1 = await start('campaign_c', sender(() => 'sent', []));
    if (!r1.started) throw new Error('did not start');
    await r1.done;

    const again: string[] = [];
    const r2 = await start('campaign_c', sender(() => 'sent', again));
    expect(r2).toMatchObject({ started: false, reason: 'nothing-left', alreadySent: 3 });
    expect(again).toEqual([]);
  });

  it('refuses a second press while the first is still running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    const slow = async (r: { email: string }, ctx: { campaignId: string; issuedAt: number }) => {
      await gate;
      return sender(() => 'sent', calls)(r, ctx);
    };
    const r1 = await start('campaign_d', slow);
    const r2 = await start('campaign_d', sender(() => 'sent', calls));
    expect(r2).toMatchObject({ started: false, reason: 'busy' });
    release();
    if (r1.started) await r1.done;
    expect(calls).toHaveLength(3);
  });

  it('takes over a lock whose holder stopped beating', async () => {
    await db
      .collection(COLLECTIONS.sendLocks)
      .doc('campaign_e')
      .set({ campaignId: 'campaign_e', actor: 'x', runId: 'dead', heldAt: new Date(Date.now() - 10 * 60_000) });
    const r = await start('campaign_e', sender(() => 'sent', []));
    expect(r.started).toBe(true);
    if (r.started) await r.done;
  });

  it('records the suppression log on the first press only', async () => {
    let firstRuns = 0;
    const r = await start('campaign_f', sender(() => 'failed', []), async () => void firstRuns++);
    if (r.started) await r.done;
    const r2 = await start('campaign_f', sender(() => 'sent', []), async () => void firstRuns++);
    if (r2.started) await r2.done;
    expect(firstRuns).toBe(1);
  });
});
