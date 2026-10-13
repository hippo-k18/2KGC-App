/**
 * Report, block and the word filter (App Store guideline 1.2, T210).
 *
 * One test per guarantee, against the real `firestore.rules` on the emulator:
 * reports are create-only and de-duplicated by their id, a block list is
 * private to its owner, a block stops new conversations and new messages in
 * both directions, and blocked words are refused on every attendee-written
 * text path.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { reportId, reportTargetKey, reportTargetPath, type ReportTarget } from '@kgc/shared';

const A = 'attendeeA';
const B = 'attendeeB';
const C = 'attendeeC';
const ORG = 'organizerU';
const DEMO = 'demoU';
const THREAD_AB = [A, B].sort().join('_');
const THREAD_AC = [A, C].sort().join('_');

let env: RulesTestEnvironment;

const attendee = (uid: string, extra: Record<string, unknown> = {}) => ({
  registered: true,
  roles: ['attendee'],
  email: `${uid}@kgc.test`,
  email_verified: true,
  ...extra,
});

const as = (uid: string, extra: Record<string, unknown> = {}) =>
  env.authenticatedContext(uid, attendee(uid, extra)).firestore();
const asOrg = () =>
  env.authenticatedContext(ORG, { ...attendee(ORG), roles: ['attendee', 'organizer'] }).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: `kgc-rules-moderation-${process.pid}`,
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'communityPosts/p1'), {
      eventId: 'kgc-2027', authorId: B, category: 'questions', title: 'Hello', body: 'Hi all',
      status: 'visible', replyCount: 0, reactionCount: 0,
    });
    await setDoc(doc(db, 'communityPosts/p1/replies/r1'), { authorId: A, body: 'Hi', status: 'visible' });
    await setDoc(doc(db, `threads/${THREAD_AB}`), {
      eventId: 'kgc-2027', participantIds: [A, B].sort(), unread: { [A]: 0, [B]: 0 },
    });
    await setDoc(doc(db, 'sessions/s1'), { eventId: 'kgc-2027', status: 'published', qaEnabled: true });
  });
});

function report(reporter: string, target: ReportTarget, extra: Record<string, unknown> = {}) {
  return {
    id: reportId(reporter, target),
    data: {
      eventId: 'kgc-2027',
      reporterId: reporter,
      targetType: target.type,
      targetKey: reportTargetKey(target),
      targetPath: reportTargetPath(target),
      reason: 'offensive',
      status: 'open',
      createdAt: serverTimestamp(),
      ...extra,
    },
  };
}

describe('reports', () => {
  const POST: ReportTarget = { type: 'communityPost', postId: 'p1' };

  it('an attendee can report a post', async () => {
    const r = report(A, POST, { note: 'Rude', targetAuthorId: B });
    await assertSucceeds(setDoc(doc(as(A), 'reports', r.id), r.data));
  });

  it('every target type is accepted', async () => {
    const targets: ReportTarget[] = [
      { type: 'reply', postId: 'p1', replyId: 'r1' },
      { type: 'message', threadId: THREAD_AB, messageId: 'm1' },
      { type: 'message', threadId: THREAD_AB },
      { type: 'user', uid: B },
      { type: 'job', jobId: 'j1' },
    ];
    for (const t of targets) {
      const r = report(A, t);
      await assertSucceeds(setDoc(doc(as(A), 'reports', r.id), r.data));
    }
  });

  it('reporting the same thing twice is refused (the id de-duplicates)', async () => {
    const r = report(A, POST);
    await assertSucceeds(setDoc(doc(as(A), 'reports', r.id), r.data));
    await assertFails(setDoc(doc(as(A), 'reports', r.id), { ...r.data, reason: 'spam' }));
  });

  it('nobody reads, edits or deletes a report from a client, not even the reporter or an organizer', async () => {
    const r = report(A, POST);
    await assertSucceeds(setDoc(doc(as(A), 'reports', r.id), r.data));
    await assertFails(getDoc(doc(as(A), 'reports', r.id)));
    await assertFails(getDocs(collection(as(A), 'reports')));
    await assertFails(getDoc(doc(asOrg(), 'reports', r.id)));
    await assertFails(updateDoc(doc(as(A), 'reports', r.id), { status: 'dismissed' }));
    await assertFails(deleteDoc(doc(as(A), 'reports', r.id)));
  });

  it('a report must be filed as yourself, under its own id', async () => {
    const r = report(A, POST);
    await assertFails(setDoc(doc(as(B), 'reports', r.id), r.data));
    const forged = report(B, POST);
    await assertFails(setDoc(doc(as(A), 'reports', forged.id), { ...forged.data, reporterId: A }));
    await assertFails(setDoc(doc(as(A), 'reports', `${A}__other`), r.data));
  });

  it('a report arrives open, with a known reason and type, and nothing extra', async () => {
    const r = report(A, POST);
    const db = as(A);
    await assertFails(setDoc(doc(db, 'reports', r.id), { ...r.data, status: 'actioned' }));
    await assertFails(setDoc(doc(db, 'reports', r.id), { ...r.data, reason: 'boring' }));
    await assertFails(setDoc(doc(db, 'reports', r.id), { ...r.data, targetType: 'reply' }));
    await assertFails(setDoc(doc(db, 'reports', r.id), { ...r.data, note: 'x'.repeat(501) }));
    await assertFails(setDoc(doc(db, 'reports', r.id), { ...r.data, resolution: 'hidden' }));
    await assertFails(setDoc(doc(db, 'reports', r.id), { ...r.data, createdAt: new Date(0) }));
  });

  it('signed-out and unregistered users cannot report', async () => {
    const r = report(A, POST);
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'reports', r.id), r.data));
    const unregistered = env.authenticatedContext(A, { email: `${A}@kgc.test` }).firestore();
    await assertFails(setDoc(doc(unregistered, 'reports', r.id), r.data));
  });

  it('the demo login can report, because only organizers see a report', async () => {
    const r = report(DEMO, POST);
    await assertSucceeds(setDoc(doc(as(DEMO, { demo: true }), 'reports', r.id), r.data));
  });

  it('a report still goes through after the event closes to writes', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings/appAccess'), { values: { readOnlyFromMs: 1 } });
    });
    const r = report(A, POST);
    await assertSucceeds(setDoc(doc(as(A), 'reports', r.id), r.data));
  });
});

describe('blocks', () => {
  const block = (db: ReturnType<typeof as>, owner: string, other: string) =>
    setDoc(doc(db, 'users', owner, 'blocks', other), { blockedUid: other, createdAt: serverTimestamp() });

  it('an attendee can block, list and unblock someone', async () => {
    await assertSucceeds(block(as(A), A, B));
    await assertSucceeds(getDocs(collection(as(A), 'users', A, 'blocks')));
    await assertSucceeds(deleteDoc(doc(as(A), 'users', A, 'blocks', B)));
  });

  it('a block list is private: nobody else reads or writes it', async () => {
    await assertSucceeds(block(as(A), A, B));
    await assertFails(getDoc(doc(as(B), 'users', A, 'blocks', B)));
    await assertFails(getDocs(collection(as(B), 'users', A, 'blocks')));
    await assertFails(deleteDoc(doc(as(B), 'users', A, 'blocks', B)));
    await assertFails(block(as(B), A, C));
    await assertFails(getDoc(doc(asOrg(), 'users', A, 'blocks', B)));
  });

  it('a block is well formed: not yourself, the id matches, no extra fields, no edits', async () => {
    const db = as(A);
    await assertFails(block(db, A, A));
    await assertFails(setDoc(doc(db, 'users', A, 'blocks', B), { blockedUid: C, createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'users', A, 'blocks', B), { blockedUid: B, createdAt: serverTimestamp(), note: 'x' }));
    await assertSucceeds(block(db, A, B));
    await assertFails(updateDoc(doc(db, 'users', A, 'blocks', B), { createdAt: serverTimestamp() }));
  });

  it('the demo login can block, because nobody else sees the list', async () => {
    await assertSucceeds(block(as(DEMO, { demo: true }), DEMO, B));
  });
});

describe('a block stops messages both ways', () => {
  const blockAs = async (owner: string, other: string) =>
    env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', owner, 'blocks', other), { blockedUid: other, createdAt: new Date() });
    });
  const newThread = (db: ReturnType<typeof as>, id: string, ids: string[]) =>
    setDoc(doc(db, 'threads', id), { eventId: 'kgc-2027', participantIds: ids.sort(), unread: Object.fromEntries(ids.map((u) => [u, 0])) });
  const send = (db: ReturnType<typeof as>, thread: string, from: string, body = 'hello') =>
    addDoc(collection(db, 'threads', thread, 'messages'), { senderId: from, body, createdAt: serverTimestamp() });

  it('without a block, both can start a thread and message', async () => {
    await assertSucceeds(newThread(as(C), THREAD_AC, [A, C]));
    await assertSucceeds(send(as(B), THREAD_AB, B));
  });

  it('a blocked person cannot start a conversation with the blocker', async () => {
    await blockAs(A, C);
    await assertFails(newThread(as(C), THREAD_AC, [A, C]));
  });

  it('the blocker cannot start one with the person they blocked either', async () => {
    await blockAs(A, C);
    await assertFails(newThread(as(A), THREAD_AC, [A, C]));
  });

  it('a block stops new messages in an existing thread, from either side', async () => {
    await blockAs(A, B);
    await assertFails(send(as(B), THREAD_AB, B));
    await assertFails(send(as(A), THREAD_AB, A));
  });

  it('unblocking lets messages through again', async () => {
    await blockAs(A, B);
    await env.withSecurityRulesDisabled(async (ctx) => deleteDoc(doc(ctx.firestore(), 'users', A, 'blocks', B)));
    await assertSucceeds(send(as(B), THREAD_AB, B));
  });

  it('a block does not take away the conversation already had', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `threads/${THREAD_AB}/messages/m0`), { senderId: B, body: 'earlier' });
    });
    await blockAs(A, B);
    await assertSucceeds(getDoc(doc(as(A), `threads/${THREAD_AB}/messages/m0`)));
  });
});

describe('the word filter', () => {
  const post = (body: string, title = 'A question') => ({
    eventId: 'kgc-2027', authorId: A, category: 'questions', title, body,
    status: 'visible', replyCount: 0, reactionCount: 0,
  });

  it('a clean post, reply and message go through', async () => {
    await assertSucceeds(addDoc(collection(as(A), 'communityPosts'), post('See you at the Scunthorpe spice stand')));
    await assertSucceeds(addDoc(collection(as(A), 'communityPosts/p1/replies'), { authorId: A, body: 'Thanks', status: 'visible' }));
    await assertSucceeds(addDoc(collection(as(A), `threads/${THREAD_AB}/messages`), { senderId: A, body: 'Lunch?' }));
  });

  it('a blocked word is refused in a post title or body, in any case, across lines', async () => {
    await assertFails(addDoc(collection(as(A), 'communityPosts'), post('what the FUCK')));
    await assertFails(addDoc(collection(as(A), 'communityPosts'), post('fine', 'you slut')));
    await assertFails(addDoc(collection(as(A), 'communityPosts'), post('line one\nline two fucker')));
  });

  it('an author cannot edit a blocked word into their post or reply', async () => {
    await assertFails(updateDoc(doc(as(B), 'communityPosts/p1'), { body: 'cunt', editedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as(B), 'communityPosts/p1'), { body: 'Hi everyone', editedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(A), 'communityPosts/p1/replies/r1'), { body: 'retard', editedAt: serverTimestamp() }));
  });

  it('a blocked word is refused in a reply, a message and a session question', async () => {
    await assertFails(addDoc(collection(as(A), 'communityPosts/p1/replies'), { authorId: A, body: 'faggot', status: 'visible' }));
    await assertFails(addDoc(collection(as(A), `threads/${THREAD_AB}/messages`), { senderId: A, body: 'fuck off' }));
    await assertFails(
      addDoc(collection(as(A), 'sessions/s1/questions'), {
        eventId: 'kgc-2027', authorId: A, body: 'Why so fucking slow?', upvoteCount: 0, answered: false, state: 'pending',
      }),
    );
  });

  it('an organizer can still redact text, which is how a word is removed', async () => {
    await assertSucceeds(updateDoc(doc(asOrg(), 'communityPosts/p1'), { body: '[removed by the organizers]', status: 'hidden' }));
  });
});
