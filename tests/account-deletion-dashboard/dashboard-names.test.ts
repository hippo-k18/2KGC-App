/**
 * After an account is deleted, the dashboard must name that person
 * "Deleted user", never the raw `deleted-user` marker, on the four screens that
 * list people's content: Engagement › Community, the moderation board, Q&A
 * moderation and the organizer desk inbox.
 *
 * Runs the real deletion (`deleteAccountData`) and then the dashboard's own data
 * functions, against the private emulator from `npm run test:account-deletion`.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, DELETED_USER_ID, DELETED_USER_NAME, EVENT_ID, SUBCOLLECTIONS } from '@kgc/shared';

vi.mock('../../apps/organizer/node_modules/next/cache.js', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (f: unknown) => f,
}));

import { deleteAccountData } from '../../apps/web/src/lib/account-deletion-core';
import { listCommunityPosts } from '../../apps/organizer/src/lib/engagement';
import { DESK_UID, deskThread, listDeskThreads } from '../../apps/organizer/src/lib/messaging';
import { listBoardForModeration, listQaSessions } from '../../apps/organizer/src/lib/moderation';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-account-deletion';
const ada = 'ada-dashboard-uid';
const ben = 'ben-dashboard-uid';

let db: Firestore;
let auth: Auth;

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Run with npm run test:account-deletion.');
  }
  const app = getApps().find((a) => a.name === 'dashboard-names') ?? initializeApp({ projectId: PROJECT }, 'dashboard-names');
  db = getFirestore(app);
  auth = getAuth(app);

  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

  await auth.createUser({ uid: ada, email: 'ada.dash@example.com' });
  for (const [uid, name] of [[ada, 'Ada'], [ben, 'Ben']]) {
    await db.doc(`${COLLECTIONS.users}/${uid}`).set({ eventId: EVENT_ID, name, email: `${uid}@example.com` });
    await db.doc(`${COLLECTIONS.directory}/${uid}`).set({ eventId: EVENT_ID, uid, name, interests: [] });
  }

  const at = new Date('2027-05-04T15:00:00Z');
  await db.doc(`${COLLECTIONS.communityPosts}/p-ada`).set({ eventId: EVENT_ID, authorId: ada, category: 'general', title: 'Post by Ada', body: 'x', status: 'visible', replyCount: 0, reactionCount: 0, createdAt: at });
  await db.doc(`${COLLECTIONS.communityPosts}/p-ben`).set({ eventId: EVENT_ID, authorId: ben, category: 'general', title: 'Post by Ben', body: 'y', status: 'visible', replyCount: 1, reactionCount: 0, createdAt: at });
  await db.doc(`${COLLECTIONS.communityPosts}/p-ben/${SUBCOLLECTIONS.replies}/r-ada`).set({ authorId: ada, body: 'Reply by Ada', status: 'visible', createdAt: at });

  await db.doc(`${COLLECTIONS.sessions}/s1`).set({ eventId: EVENT_ID, title: 'Keynote', status: 'scheduled' });
  await db.doc(`${COLLECTIONS.sessions}/s1/${SUBCOLLECTIONS.questions}/q-ada`).set({ eventId: EVENT_ID, authorId: ada, body: 'Slides?', state: 'pending', answered: false, upvoteCount: 0, createdAt: at });

  const threadId = [DESK_UID, ada].sort().join('_');
  await db.doc(`${COLLECTIONS.threads}/${threadId}`).set({ eventId: EVENT_ID, participantIds: [DESK_UID, ada].sort(), lastMessage: 'Thanks', lastMessageAt: at, lastSenderId: ada, unread: { [DESK_UID]: 1, [ada]: 0 } });
  await db.doc(`${COLLECTIONS.threads}/${threadId}/${SUBCOLLECTIONS.messages}/m1`).set({ senderId: ada, body: 'Thanks', sentAt: at });

  await deleteAccountData(auth, db, ada);
});

/** Nothing the dashboard returns may contain the marker as a name. */
const noMarkerName = (rows: unknown) => expect(JSON.stringify(rows)).not.toMatch(/"(authorName|name|correspondentName)":"deleted-user"/);

describe('dashboard names for a deleted person', () => {
  it('Engagement › Community', async () => {
    const rows = await listCommunityPosts();
    expect(rows.find((r) => r.title === 'Post by Ada')?.authorName).toBe(DELETED_USER_NAME);
    expect(rows.find((r) => r.title === 'Post by Ben')?.participants.map((p) => p.name)).toEqual([DELETED_USER_NAME]);
    noMarkerName(rows);
  });

  it('the moderation board', async () => {
    const posts = await listBoardForModeration();
    expect(posts.find((p) => p.title === 'Post by Ada')?.authorName).toBe(DELETED_USER_NAME);
    expect(posts.find((p) => p.title === 'Post by Ben')?.replies[0].authorName).toBe(DELETED_USER_NAME);
    // The id stays the marker, so moderation actions still find the record.
    expect(posts.find((p) => p.title === 'Post by Ada')?.authorId).toBe(DELETED_USER_ID);
    noMarkerName(posts);
  });

  it('Q&A moderation', async () => {
    const { questions } = await listQaSessions();
    expect(questions.find((q) => q.body === 'Slides?')?.authorName).toBe(DELETED_USER_NAME);
    noMarkerName(questions);
  });

  it('the organizer desk inbox and the conversation', async () => {
    const rows = await listDeskThreads();
    expect(rows).toHaveLength(1);
    expect(rows[0].correspondentName).toBe(DELETED_USER_NAME);
    expect(rows[0].correspondentUid).toBe(DELETED_USER_ID);
    const convo = await deskThread(rows[0].threadId);
    expect(convo?.correspondentName).toBe(DELETED_USER_NAME);
    noMarkerName(rows);
  });

  it('leaves living people named as before', async () => {
    const rows = await listCommunityPosts();
    expect(rows.find((r) => r.title === 'Post by Ben')?.authorName).toBe('Ben');
  });
});
