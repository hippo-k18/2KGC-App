/**
 * `POST /api/account/delete` against the Firestore and Auth emulators.
 *
 * Runs the real route handler and the real `deleteAccountData`, and checks the
 * three things the store reviewers and our own records depend on: what goes,
 * what stays, and that nobody can delete an account that is not theirs.
 *
 * Run with `npm run test:account-deletion` (private ports 8211/9211).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, DELETED_USER_ID, EVENT_ID, SUBCOLLECTIONS } from '@kgc/shared';
import { verifySignInCode } from '@kgc/scripts/src/lib/otp-core';
import { otpDocId } from '@kgc/scripts/src/lib/otp-ids';

import { POST } from '../../apps/web/src/app/api/account/delete/route';
import { deleteAccountData } from '../../apps/web/src/lib/account-deletion-core';
import { provisionAttendeeAccount, uidForEmail } from '../../apps/web/src/lib/app-account-core';

const FIRESTORE_EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-account-deletion';

const ADA = 'ada@example.com';
const BEN = 'ben@example.com';
const CY = 'cy@example.com';
const ada = uidForEmail(ADA);
const ben = uidForEmail(BEN);
const cy = uidForEmail(CY);

let db: Firestore;
let auth: Auth;

function call(init: { token?: string; body?: unknown }) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const req = new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers,
    body: init.body === undefined ? '' : JSON.stringify(init.body),
  });
  // The handler reads only `headers` and `text()`, which a plain Request has.
  return POST(req as never);
}

/** A real ID token from the Auth emulator, the same kind the app sends. */
async function idTokenFor(uid: string): Promise<string> {
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(
    `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) },
  );
  const json = (await res.json()) as { idToken?: string };
  if (!json.idToken) throw new Error(`no id token: ${JSON.stringify(json)}`);
  return json.idToken;
}

async function clearAll() {
  await fetch(`http://${FIRESTORE_EMULATOR}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

const exists = async (path: string) => (await db.doc(path).get()).exists;
const field = async (path: string, name: string) => (await db.doc(path).get()).get(name);

async function seedPerson(uid: string, email: string, name: string) {
  await auth.createUser({ uid, email, displayName: name });
  await db.doc(`${COLLECTIONS.users}/${uid}`).set({ email, name, eventId: 'kgc-2027' });
  await db.doc(`${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.savedSessions}/s1`).set({ savedAt: new Date() });
  await db.doc(`${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.fcmTokens}/tok-${uid}`).set({ token: 'x' });
  await db.doc(`${COLLECTIONS.users}/${uid}/${SUBCOLLECTIONS.notifications}/n1`).set({ title: 'Hi' });
  await db.doc(`${COLLECTIONS.users}/${uid}/blocks/someone`).set({ at: new Date() });
  await db.doc(`${COLLECTIONS.directory}/${uid}`).set({ uid, name, eventId: 'kgc-2027', interests: [] });
  await db.doc(`${COLLECTIONS.registrations}/${uid}`).set({ email, name, status: 'active' });
  await db.doc(`${COLLECTIONS.orders}/order-${uid}`).set({ email, totalCents: 79900, status: 'paid' });
}

/** Ada is deleted; Ben shares a post, a session and a thread with her. */
async function seedWorld() {
  await seedPerson(ada, ADA, 'Ada');
  await seedPerson(ben, BEN, 'Ben');

  await db.doc(`${COLLECTIONS.communityPosts}/p-ada`).set({ authorId: ada, title: 'Hello', body: 'From Ada', replyCount: 1, reactionCount: 2, status: 'visible' });
  await db.doc(`${COLLECTIONS.communityPosts}/p-ada/${SUBCOLLECTIONS.replies}/r-ben`).set({ authorId: ben, body: 'Hi Ada', status: 'visible' });
  await db.doc(`${COLLECTIONS.communityPosts}/p-ada/${SUBCOLLECTIONS.reactions}/${ada}`).set({ uid: ada, emoji: '👍' });
  await db.doc(`${COLLECTIONS.communityPosts}/p-ada/${SUBCOLLECTIONS.reactions}/${ben}`).set({ uid: ben, emoji: '🎉' });
  await db.doc(`${COLLECTIONS.communityPosts}/p-ben`).set({ authorId: ben, title: 'Question', body: 'From Ben', replyCount: 1, reactionCount: 0, status: 'visible' });
  await db.doc(`${COLLECTIONS.communityPosts}/p-ben/${SUBCOLLECTIONS.replies}/r-ada`).set({ authorId: ada, body: 'An answer', status: 'visible' });

  await db.doc(`${COLLECTIONS.sessions}/s1`).set({ title: 'Keynote' });
  await db.doc(`${COLLECTIONS.sessions}/s1/${SUBCOLLECTIONS.questions}/q-ada`).set({ authorId: ada, body: 'Why?' });
  await db.doc(`${COLLECTIONS.sessions}/s1/${SUBCOLLECTIONS.questions}/q-ben`).set({ authorId: ben, body: 'How?' });
  await db.doc(`${COLLECTIONS.sessions}/s1/${SUBCOLLECTIONS.questions}/q-ben/${SUBCOLLECTIONS.upvotes}/${ada}`).set({ uid: ada });
  await db.doc(`${COLLECTIONS.sessions}/s1/${SUBCOLLECTIONS.questions}/q-ben/${SUBCOLLECTIONS.upvotes}/${ben}`).set({ uid: ben });

  const threadId = [ada, ben].sort().join('_');
  await db.doc(`${COLLECTIONS.threads}/${threadId}`).set({
    participantIds: [ada, ben].sort(),
    unread: { [ada]: 1, [ben]: 2 },
    lastSenderId: ada,
    lastMessage: 'See you there',
  });
  await db.doc(`${COLLECTIONS.threads}/${threadId}/${SUBCOLLECTIONS.messages}/m1`).set({ senderId: ben, body: 'Coming?' });
  await db.doc(`${COLLECTIONS.threads}/${threadId}/${SUBCOLLECTIONS.messages}/m2`).set({ senderId: ada, body: 'See you there' });
  return threadId;
}

beforeAll(() => {
  if (!FIRESTORE_EMULATOR || !AUTH_EMULATOR) throw new Error('Run with npm run test:account-deletion.');
  const app = getApps().find((a) => a.name === 'account-deletion-test') ?? initializeApp({ projectId: PROJECT }, 'account-deletion-test');
  db = getFirestore(app);
  // As the website's own store does (lib/firestore.ts); provisioning relies on it.
  db.settings({ ignoreUndefinedProperties: true });
  auth = getAuth(app);
});

describe('who may delete', () => {
  beforeEach(async () => {
    await clearAll();
    await seedWorld();
  });

  it('refuses a request with no proof', async () => {
    const res = await call({ body: {} });
    expect(res.status).toBe(401);
    expect(await exists(`${COLLECTIONS.users}/${ada}`)).toBe(true);
  });

  it('refuses a token that is not a valid ID token, and changes nothing', async () => {
    const res = await call({ token: 'not-a-token', body: {} });
    expect(res.status).toBe(401);
    expect(await exists(`${COLLECTIONS.users}/${ada}`)).toBe(true);
    expect((await auth.getUser(ada)).uid).toBe(ada);
  });

  it("refuses to delete another person's account, and deletes nobody", async () => {
    const res = await call({ token: await idTokenFor(ada), body: { uid: ben } });
    expect(res.status).toBe(403);
    expect(await exists(`${COLLECTIONS.users}/${ben}`)).toBe(true);
    expect(await exists(`${COLLECTIONS.users}/${ada}`)).toBe(true);
    expect((await auth.getUser(ben)).uid).toBe(ben);
  });
});

describe('what goes and what stays', () => {
  let threadId: string;

  beforeEach(async () => {
    await clearAll();
    threadId = await seedWorld();
    const res = await call({ token: await idTokenFor(ada), body: { uid: ada } });
    expect(res.status).toBe(200);
  });

  it('removes the Auth account, the profile and everything under it, and the directory card', async () => {
    await expect(auth.getUser(ada)).rejects.toMatchObject({ code: 'auth/user-not-found' });
    expect(await exists(`${COLLECTIONS.users}/${ada}`)).toBe(false);
    for (const sub of [SUBCOLLECTIONS.savedSessions, SUBCOLLECTIONS.fcmTokens, SUBCOLLECTIONS.notifications, 'blocks']) {
      expect((await db.collection(`${COLLECTIONS.users}/${ada}/${sub}`).get()).size).toBe(0);
    }
    expect(await exists(`${COLLECTIONS.directory}/${ada}`)).toBe(false);
  });

  it('keeps her posts, replies, questions and messages, attributed to a deleted user', async () => {
    expect(await field(`${COLLECTIONS.communityPosts}/p-ada`, 'authorId')).toBe(DELETED_USER_ID);
    expect(await field(`${COLLECTIONS.communityPosts}/p-ada`, 'body')).toBe('From Ada');
    expect(await field(`${COLLECTIONS.communityPosts}/p-ben/${SUBCOLLECTIONS.replies}/r-ada`, 'authorId')).toBe(DELETED_USER_ID);
    expect(await field(`${COLLECTIONS.sessions}/s1/${SUBCOLLECTIONS.questions}/q-ada`, 'authorId')).toBe(DELETED_USER_ID);
    expect(await field(`${COLLECTIONS.threads}/${threadId}/${SUBCOLLECTIONS.messages}/m2`, 'senderId')).toBe(DELETED_USER_ID);

    const thread = (await db.doc(`${COLLECTIONS.threads}/${threadId}`).get()).data()!;
    expect(thread.participantIds).toContain(ben);
    expect(thread.participantIds).toContain(DELETED_USER_ID);
    expect(thread.participantIds).not.toContain(ada);
    expect(Object.keys(thread.unread)).not.toContain(ada);
    expect(thread.unread[ben]).toBe(2);
    expect(thread.lastSenderId).toBe(DELETED_USER_ID);
  });

  it('removes her reactions and upvotes and leaves everyone else alone', async () => {
    expect(await exists(`${COLLECTIONS.communityPosts}/p-ada/${SUBCOLLECTIONS.reactions}/${ada}`)).toBe(false);
    expect(await exists(`${COLLECTIONS.communityPosts}/p-ada/${SUBCOLLECTIONS.reactions}/${ben}`)).toBe(true);
    expect(await exists(`${COLLECTIONS.sessions}/s1/${SUBCOLLECTIONS.questions}/q-ben/${SUBCOLLECTIONS.upvotes}/${ada}`)).toBe(false);
    expect(await exists(`${COLLECTIONS.sessions}/s1/${SUBCOLLECTIONS.questions}/q-ben/${SUBCOLLECTIONS.upvotes}/${ben}`)).toBe(true);

    expect(await field(`${COLLECTIONS.communityPosts}/p-ada/${SUBCOLLECTIONS.replies}/r-ben`, 'authorId')).toBe(ben);
    expect(await field(`${COLLECTIONS.threads}/${threadId}/${SUBCOLLECTIONS.messages}/m1`, 'senderId')).toBe(ben);
    expect(await exists(`${COLLECTIONS.users}/${ben}`)).toBe(true);
    expect(await exists(`${COLLECTIONS.directory}/${ben}`)).toBe(true);
    expect((await auth.getUser(ben)).uid).toBe(ben);
  });

  it('keeps her order and registration, the money records', async () => {
    expect(await field(`${COLLECTIONS.orders}/order-${ada}`, 'totalCents')).toBe(79900);
    expect(await field(`${COLLECTIONS.registrations}/${ada}`, 'status')).toBe('active');
  });

  it('writes one audit row that names the account but not the email address', async () => {
    const rows = await db.collection(COLLECTIONS.auditLog).where('action', '==', 'account.delete').get();
    expect(rows.size).toBe(1);
    const row = rows.docs[0].data();
    expect(row.targetId).toBe(ada);
    expect(JSON.stringify(row)).not.toContain(ADA);
    expect(row.after).toMatchObject({ posts: 1, replies: 1, questions: 1, messages: 1, threads: 1, reactions: 1, upvotes: 1, profile: true, directory: true, authAccount: true });
  });

  it('can run again: a retry finds nothing left and still succeeds', async () => {
    // Called on the core rather than the route: in emulator mode the Admin SDK
    // refuses any ID token whose user no longer exists, which production does
    // not do without `checkRevoked`. The route adds nothing to a retry beyond
    // that token check, so this is the part worth pinning.
    const counts = await deleteAccountData(auth, db, ada);
    expect(counts).toMatchObject({ posts: 0, replies: 0, questions: 0, messages: 0, reactions: 0, upvotes: 0, profile: false, directory: false, authAccount: false });
    expect(await field(`${COLLECTIONS.communityPosts}/p-ada`, 'authorId')).toBe(DELETED_USER_ID);
  });

  it('lets a later ticket purchase with the same address create a fresh account', async () => {
    const result = await provisionAttendeeAccount(auth, db, { email: ADA, name: 'Ada again' });
    expect(result.status).toBe('created');
    expect(result.uid).toBe(ada);
    expect(result.profileCreated).toBe(true);
    expect((await auth.getUser(ada)).customClaims).toMatchObject({ registered: true });
    expect(await field(`${COLLECTIONS.users}/${ada}`, 'name')).toBe('Ada again');
  });
});

describe('deleting from the web page with an emailed code', () => {
  beforeEach(async () => {
    await clearAll();
    await seedPerson(cy, CY, 'Cy');
    await db.doc(`${COLLECTIONS.otpCodes}/${otpDocId(CY)}`).set({
      eventId: 'kgc-2027',
      email: CY,
      code: '123456',
      attempts: 0,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      createdAt: new Date(),
    });
  });

  it('refuses a wrong code and deletes nothing', async () => {
    const res = await call({ body: { email: CY, code: '000000' } });
    expect(res.status).toBe(400);
    expect(await exists(`${COLLECTIONS.users}/${cy}`)).toBe(true);
    expect((await auth.getUser(cy)).uid).toBe(cy);
  });

  it('deletes with the right code, and the code cannot be used twice', async () => {
    const res = await call({ body: { email: 'Cy@Example.com', code: '123456' } });
    expect(res.status).toBe(200);
    await expect(auth.getUser(cy)).rejects.toMatchObject({ code: 'auth/user-not-found' });
    expect(await exists(`${COLLECTIONS.users}/${cy}`)).toBe(false);
    expect(await exists(`${COLLECTIONS.registrations}/${cy}`)).toBe(true);

    const reuse = await call({ body: { email: CY, code: '123456' } });
    expect(reuse.status).toBe(400);
  });

  it('does not create an account for an address that never had one', async () => {
    await db.doc(`${COLLECTIONS.otpCodes}/${otpDocId('nobody@example.com')}`).set({
      eventId: 'kgc-2027',
      email: 'nobody@example.com',
      code: '654321',
      attempts: 0,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      createdAt: new Date(),
    });
    const res = await call({ body: { email: 'nobody@example.com', code: '654321' } });
    expect(res.status).toBe(200);
    await expect(auth.getUserByEmail('nobody@example.com')).rejects.toMatchObject({ code: 'auth/user-not-found' });
  });
});

describe('signing in with a code still works after the code check was split out', () => {
  beforeEach(async () => {
    await clearAll();
    await db.doc(`${COLLECTIONS.registrations}/${cy}`).set({ email: CY, name: 'Cy', status: 'active', eventId: EVENT_ID });
    await db.doc(`${COLLECTIONS.otpCodes}/${otpDocId(CY)}`).set({
      eventId: EVENT_ID,
      email: CY,
      code: '222333',
      attempts: 0,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      createdAt: new Date(),
    });
  });

  it('signs in, creates the account, and uses the code up', async () => {
    const first = await verifySignInCode(db, auth, CY, '222333', undefined);
    expect(first.ok).toBe(true);
    expect((await auth.getUserByEmail(CY)).customClaims).toMatchObject({ registered: true });
    const again = await verifySignInCode(db, auth, CY, '222333', undefined);
    expect(again).toEqual({ ok: false, reason: 'no-code' });
  });

  it('still counts a wrong code against the address', async () => {
    expect(await verifySignInCode(db, auth, CY, '999999', undefined)).toEqual({ ok: false, reason: 'wrong-code' });
    expect(await field(`${COLLECTIONS.otpCodes}/${otpDocId(CY)}`, 'attempts')).toBe(1);
  });
});
