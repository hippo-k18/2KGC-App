/**
 * Engagement › Community › Reports (T210): the queue an organizer reads and the
 * decisions it writes. Real dashboard code against the Firestore emulator.
 *
 * Run with: npm run test:dashboard-reports
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, reportId, reportTargetKey, reportTargetPath, type ReportTarget } from '@kgc/shared';
import { db as dashDb } from '@/lib/firestore';
import { listReportQueue, resolveReports, withContent } from '@/lib/reports';

let db: Firestore;
const ORG = 'organizer@example.com';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:dashboard-reports');
  }
  db = dashDb() as unknown as Firestore;
});

async function wipe(collection: string) {
  const snap = await db.collection(collection).get();
  await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
}

async function file(reporter: string, target: ReportTarget, reason = 'offensive', extra: Record<string, unknown> = {}) {
  await db.collection(COLLECTIONS.reports).doc(reportId(reporter, target)).set({
    eventId: EVENT_ID,
    reporterId: reporter,
    targetType: target.type,
    targetKey: reportTargetKey(target),
    targetPath: reportTargetPath(target),
    reason,
    status: 'open',
    createdAt: new Date(),
    ...extra,
  });
}

const reportsOn = async (key: string) =>
  (await db.collection(COLLECTIONS.reports).where('targetKey', '==', key).get()).docs.map((d) => d.data());
const audits = async () => (await db.collection(COLLECTIONS.auditLog).get()).docs.map((d) => d.data());

const POST: ReportTarget = { type: 'communityPost', postId: 'p1' };
const REPLY: ReportTarget = { type: 'reply', postId: 'p1', replyId: 'r1' };
const THREAD = 'bad_good';

beforeEach(async () => {
  await Promise.all(
    [COLLECTIONS.reports, COLLECTIONS.communityPosts, COLLECTIONS.threads, COLLECTIONS.users, COLLECTIONS.directory, COLLECTIONS.auditLog, COLLECTIONS.sessions, COLLECTIONS.registrations].map(wipe),
  );
  await db.doc('users/good').set({ eventId: EVENT_ID, name: 'Grace Good' });
  await db.doc('users/bad').set({ eventId: EVENT_ID, name: 'Brian Bad' });
  await db.doc('communityPosts/p1').set({ eventId: EVENT_ID, authorId: 'bad', title: 'Buy now', body: 'Cheap watches', status: 'visible', category: 'questions' });
  await db.doc('communityPosts/p1/replies/r1').set({ authorId: 'bad', body: 'rude reply', status: 'visible' });
  await db.doc(`threads/${THREAD}`).set({ eventId: EVENT_ID, participantIds: ['bad', 'good'] });
  await db.doc(`threads/${THREAD}/messages/m1`).set({ senderId: 'bad', body: 'first nasty one', sentAt: new Date(1000) });
  await db.doc(`threads/${THREAD}/messages/m2`).set({ senderId: 'good', body: 'please stop', sentAt: new Date(2000) });
  await db.doc(`threads/${THREAD}/messages/m3`).set({ senderId: 'bad', body: 'second nasty one', sentAt: new Date(3000) });
  await db.doc('directory/bad').set({ eventId: EVENT_ID, uid: 'bad', name: 'Brian Bad', title: 'Sales', interests: [] });
});

describe('the queue', () => {
  it('groups reports by target, names the reporters and shows the content as it is now', async () => {
    await file('good', POST, 'spam');
    await file('other', POST, 'spam', { note: 'Selling watches' });
    await file('good', REPLY);
    const q = await listReportQueue();
    expect(q).toHaveLength(2);
    const post = q.find((i) => i.targetKey === 'communityPost:p1')!;
    expect(post.reports).toHaveLength(2);
    expect(post.reasons).toBe('Spam ×2');
    expect(post.reports.map((r) => r.reporterName).sort()).toEqual(['Grace Good', 'Unknown attendee']);
    expect(post.content).toMatchObject({ exists: true, title: 'Buy now', body: 'Cheap watches', authorName: 'Brian Bad', status: 'visible' });
    expect(q[0].targetKey).toBe('communityPost:p1'); // most reported first
  });

  it('says when the reported thing is gone', async () => {
    await file('good', { type: 'communityPost', postId: 'gone' });
    const [item] = await listReportQueue();
    expect(item.content.exists).toBe(false);
  });

  it('shows a reported conversation as the reported person\'s messages there, and a reported profile', async () => {
    await file('good', { type: 'message', threadId: THREAD }, 'offensive', { targetAuthorId: 'bad' });
    await file('good', { type: 'user', uid: 'bad' });
    const q = await listReportQueue();
    const convo = q.find((i) => i.target?.type === 'message')!;
    expect(convo.content.messages!.map((m) => m.body)).toEqual(['first nasty one', 'second nasty one']);
    const profile = q.find((i) => i.target?.type === 'user')!;
    expect(profile.content).toMatchObject({ exists: true, title: 'Brian Bad', body: 'Sales' });
  });
});

describe('decisions', () => {
  it('hide takes the post down, closes every report on it, and is audited', async () => {
    await file('good', POST);
    await file('other', POST);
    const res = await resolveReports({ targetKey: 'communityPost:p1', decision: 'hide', actor: ORG });
    expect(res).toEqual({ ok: true, changed: 2 });
    expect((await db.doc('communityPosts/p1').get()).get('status')).toBe('hidden');
    for (const r of await reportsOn('communityPost:p1')) {
      expect(r).toMatchObject({ status: 'actioned', resolution: 'hidden', resolvedBy: ORG });
    }
    const a = await audits();
    expect(a.map((e) => e.action).sort()).toEqual(['moderation.setStatus', 'report.resolve']);
    expect(a.find((e) => e.action === 'moderation.setStatus')).toMatchObject({ actor: ORG, targetPath: 'communityPosts/p1', before: { status: 'visible' } });
  });

  it('hide on a reply hides only the reply', async () => {
    await file('good', REPLY);
    await resolveReports({ targetKey: 'reply:p1:r1', decision: 'hide', actor: ORG });
    expect((await db.doc('communityPosts/p1/replies/r1').get()).get('status')).toBe('hidden');
    expect((await db.doc('communityPosts/p1').get()).get('status')).toBe('visible');
  });

  it('hide on a conversation hides only the reported person\'s messages in it', async () => {
    await file('good', { type: 'message', threadId: THREAD }, 'offensive', { targetAuthorId: 'bad' });
    await resolveReports({ targetKey: `message:${THREAD}`, decision: 'hide', actor: ORG });
    const msgs = Object.fromEntries((await db.collection(`threads/${THREAD}/messages`).get()).docs.map((d) => [d.id, d.get('hidden') === true]));
    expect(msgs).toEqual({ m1: true, m2: false, m3: true });
  });

  it('hide on one message hides that message', async () => {
    await file('good', { type: 'message', threadId: THREAD, messageId: 'm3' });
    await resolveReports({ targetKey: `message:${THREAD}:m3`, decision: 'hide', actor: ORG });
    expect((await db.doc(`threads/${THREAD}/messages/m3`).get()).get('hidden')).toBe(true);
    expect((await db.doc(`threads/${THREAD}/messages/m1`).get()).get('hidden')).toBeUndefined();
  });

  it('keep closes the reports and leaves the content alone', async () => {
    await file('good', POST);
    await resolveReports({ targetKey: 'communityPost:p1', decision: 'keep', actor: ORG });
    expect((await db.doc('communityPosts/p1').get()).get('status')).toBe('visible');
    expect((await reportsOn('communityPost:p1'))[0]).toMatchObject({ status: 'dismissed', resolution: 'kept' });
    expect((await audits()).map((e) => e.action)).toEqual(['report.resolve']);
  });

  it('reopen puts closed reports back in the queue and clears the decision', async () => {
    await file('good', POST);
    await resolveReports({ targetKey: 'communityPost:p1', decision: 'keep', actor: ORG });
    await resolveReports({ targetKey: 'communityPost:p1', decision: 'reopen', actor: ORG });
    const [r] = await reportsOn('communityPost:p1');
    expect(r.status).toBe('open');
    expect(r.resolvedBy).toBeUndefined();
    expect(r.resolution).toBeUndefined();
    expect((await listReportQueue())[0].status).toBe('open');
  });

  it('a profile report cannot be "hidden", only kept', async () => {
    await file('good', { type: 'user', uid: 'bad' });
    const res = await resolveReports({ targetKey: 'user:bad', decision: 'hide', actor: ORG });
    expect(res.ok).toBe(false);
    expect((await reportsOn('user:bad'))[0].status).toBe('open');
    expect((await db.doc('directory/bad').get()).exists).toBe(true);
  });

  it('a decision on reports that no longer exist is refused', async () => {
    expect(await resolveReports({ targetKey: 'communityPost:nope', decision: 'keep', actor: ORG })).toEqual({
      ok: false,
      error: 'Those reports are no longer there.',
    });
  });
});

/**
 * T231: the gate's forged report (orchestrator/reports/T230/forged.test.ts),
 * written straight to the database as the old rules allowed, against the real
 * dashboard code. The rules now refuse these; the dashboard must be safe on
 * its own too, because a report filed before the rules ship stays in the queue.
 */
describe('a forged targetPath changes nothing but what the key names', () => {
  async function everything() {
    const out: Record<string, unknown> = {};
    for (const c of [COLLECTIONS.communityPosts, COLLECTIONS.sessions, COLLECTIONS.registrations, COLLECTIONS.threads]) {
      for (const d of (await db.collection(c).get()).docs) {
        out[d.ref.path] = d.data();
        for (const sub of await d.ref.listCollections()) {
          for (const s of (await sub.get()).docs) out[s.ref.path] = s.data();
        }
      }
    }
    return out;
  }

  beforeEach(async () => {
    await db.doc('users/aa-attacker').set({ eventId: EVENT_ID, name: 'Al Attacker' });
    await db.doc('sessions/keynote').set({ eventId: EVENT_ID, title: 'Opening keynote', status: 'published' });
    await db.doc('registrations/reg_victim').set({ eventId: EVENT_ID, email: 'v@example.com', status: 'active', qrSecret: 'x' });
    // The genuine report first, the forged one a minute later from a reporter whose id sorts first.
    await file('good', POST, 'offensive', { createdAt: new Date(1000) });
    await file('aa-attacker', POST, 'offensive', { targetPath: 'sessions/keynote', createdAt: new Date(61000) });
    // A lone forged reply report pointing at someone's badge.
    await file('aa-attacker', { type: 'reply', postId: 'p1', replyId: 'r9' }, 'offensive', { targetPath: 'registrations/reg_victim' });
  });

  it('the card shows the post the key names, whatever the reports say', async () => {
    const q = await listReportQueue();
    const post = q.find((i) => i.targetKey === 'communityPost:p1')!;
    expect(post.targetPath).toBe('communityPosts/p1');
    expect(post.content).toMatchObject({ exists: true, title: 'Buy now' });
    const reply = q.find((i) => i.targetKey === 'reply:p1:r9')!;
    expect(reply.targetPath).toBe('communityPosts/p1/replies/r9');
    expect(reply.content.exists).toBe(false);
  });

  it('Hide post hides the post and nothing else; Hide reply on a missing reply touches nothing', async () => {
    const before = await everything();
    expect(await resolveReports({ targetKey: 'communityPost:p1', decision: 'hide', actor: ORG })).toEqual({ ok: true, changed: 2 });
    expect(await resolveReports({ targetKey: 'reply:p1:r9', decision: 'hide', actor: ORG })).toEqual({ ok: true, changed: 1 });
    const after = await everything();

    expect((after['communityPosts/p1'] as { status: string }).status).toBe('hidden');
    const changed = Object.keys({ ...before, ...after }).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    );
    expect(changed).toEqual(['communityPosts/p1']);
    expect(after['sessions/keynote']).toEqual(before['sessions/keynote']);
    expect(after['registrations/reg_victim']).toEqual(before['registrations/reg_victim']);

    const paths = (await audits()).map((a) => a.targetPath).sort();
    expect(paths).toEqual(['communityPosts/p1', 'communityPosts/p1', 'communityPosts/p1/replies/r9']);
  });
});

describe('a conversation report is about the other person in it', () => {
  it('a reporter outside the thread shows nobody, and Hide refuses', async () => {
    await file('stranger', { type: 'message', threadId: THREAD }, 'offensive', { targetAuthorId: 'bad' });
    const [item] = await listReportQueue();
    expect(item.content.messages).toEqual([]);
    const res = await resolveReports({ targetKey: `message:${THREAD}`, decision: 'hide', actor: ORG });
    expect(res.ok).toBe(false);
    const hidden = (await db.collection(`threads/${THREAD}/messages`).get()).docs.filter((d) => d.get('hidden') === true);
    expect(hidden).toHaveLength(0);
  });

  it('the person hidden is worked out from the thread, not from targetAuthorId', async () => {
    // 'good' names themselves: the dashboard still hides only 'bad'.
    await file('good', { type: 'message', threadId: THREAD }, 'offensive', { targetAuthorId: 'good' });
    const [item] = await listReportQueue();
    expect(item.content.authorName).toBe('Brian Bad');
    await resolveReports({ targetKey: `message:${THREAD}`, decision: 'hide', actor: ORG });
    const msgs = Object.fromEntries((await db.collection(`threads/${THREAD}/messages`).get()).docs.map((d) => [d.id, d.get('hidden') === true]));
    expect(msgs).toEqual({ m1: true, m2: false, m3: true });
  });
});

describe('reporter names', () => {
  it('the demo login is named as such, and a reporter with no profile is not a raw uid', async () => {
    await db.doc('users/demoU').set({ eventId: EVENT_ID, name: 'Demo Attendee', demo: true });
    await file('demoU', POST);
    await file('xYz123NoProfile', POST);
    const [item] = await listReportQueue();
    expect(item.reports.map((r) => r.reporterName).sort()).toEqual(['Demo login', 'Unknown attendee']);
  });
});

/**
 * T233: reports the rules now refuse, written straight to the database with the
 * Admin SDK (as a report filed before the rules shipped would be). Each one once
 * made the whole queue throw (T232). Now each is its own unreadable card, the
 * other cards are untouched, Hide refuses cleanly and Keep clears it.
 */
describe('one bad report never takes the queue down', () => {
  const ODD = [
    'communityPost:..',
    'communityPost:.',
    'communityPost:__x__',
    'communityPost:ｐ１',
    'communityPost:p1 ',
    'communityPost:p1\nx',
    'message:..',
    'user:..',
  ];
  const oddId = (key: string) => `odd${ODD.indexOf(key)}`;

  beforeEach(async () => {
    await file('good', POST, 'spam');
    for (const key of ODD) {
      await db.collection(COLLECTIONS.reports).doc(oddId(key)).set({
        eventId: EVENT_ID, reporterId: 'aa-attacker', targetType: key.split(':')[0], targetKey: key,
        targetPath: key.replace(':', 's/'), reason: 'spam', status: 'open', createdAt: new Date(),
      });
    }
  });

  it('lists every card: the real one as before, each odd one as unreadable', async () => {
    const q = await listReportQueue();
    expect(q).toHaveLength(ODD.length + 1);
    const real = q.find((i) => i.targetKey === 'communityPost:p1')!;
    expect(real.content).toMatchObject({ exists: true, title: 'Buy now' });
    for (const key of ODD) {
      const card = q.find((i) => i.targetKey === key)!;
      expect(card.target, key).toBeNull();
      expect(card.content.exists, key).toBe(false);
    }
  });

  it('Hide refuses each odd card without throwing, and Keep clears it', async () => {
    for (const key of ODD) {
      const hide = await resolveReports({ targetKey: key, decision: 'hide', actor: ORG });
      expect(hide.ok, key).toBe(false);
      expect(await resolveReports({ targetKey: key, decision: 'keep', actor: ORG }), key).toEqual({ ok: true, changed: 1 });
    }
    const q = await listReportQueue();
    expect(q.filter((i) => i.status === 'open').map((i) => i.targetKey)).toEqual(['communityPost:p1']);
    expect(await resolveReports({ targetKey: 'communityPost:p1', decision: 'hide', actor: ORG })).toEqual({ ok: true, changed: 1 });
    expect((await db.doc('communityPosts/p1').get()).get('status')).toBe('hidden');
  });

  it('a card whose read throws is marked unreadable and the others still load', async () => {
    const groups = (await listReportQueue()).slice(0, 3);
    const [bad] = groups;
    const out = await withContent(groups, async (g) => {
      if (g === bad) throw new Error('INVALID_ARGUMENT: reserved id');
      return { exists: true, title: g.targetKey };
    });
    expect(out).toHaveLength(3);
    expect(out[0].content).toEqual({ exists: false, unreadable: true });
    expect(out.slice(1).every((g) => g.content.exists)).toBe(true);
  });
});
