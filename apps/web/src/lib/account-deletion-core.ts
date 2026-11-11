import type { Auth } from 'firebase-admin/auth';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, DELETED_USER_ID, EVENT_ID, SUBCOLLECTIONS } from '@kgc/shared';

/**
 * Deleting an app account (App Store guideline 5.1.1(v), Google Play's
 * account-deletion policy).
 *
 * Takes `auth` and `db` as arguments, like `app-account-core.ts`, so the
 * emulator suite in `tests/account-deletion` runs exactly this code.
 *
 * ── What goes, what stays ───────────────────────────────────────────────────
 *
 * Goes: the Auth account (and with it every way to sign in), `users/{uid}` and
 * everything under it (saved sessions and contacts, notifications, push tokens,
 * entitlements, gatherings, and blocks once they exist), `directory/{uid}`,
 * the person's reactions on community posts and upvotes on session questions.
 *
 * Stays, re-attributed to `DELETED_USER_ID`: their community posts and
 * replies, their session questions, and their messages. Other people replied to
 * those or still have the thread, so removing them would rewrite somebody
 * else's conversation. The text stays; the link to the person does not.
 *
 * Stays as it is: `orders` and `registrations`. They are the record of a sale,
 * which KGC must keep for accounting and refunds whether or not the buyer still
 * has an app account, and they are what lets a later purchase with the same
 * address work: `provisionAttendeeAccount` finds no Auth user and no profile,
 * and creates both again under the same derived uid.
 *
 * ── Order, and why it can be run twice ──────────────────────────────────────
 *
 * Anonymise first, then delete the profile, then the Auth account last. If
 * anything throws half way, the person can still sign in and try again, and
 * every step finds nothing left to do for the parts already done. A second call
 * for an account that is fully gone reports zero of everything and succeeds.
 *
 * ── Queries ─────────────────────────────────────────────────────────────────
 *
 * Every query here is on a single collection with one equality filter, which
 * Firestore indexes automatically. Collection-group queries (all replies, all
 * messages) would be shorter, but they need indexes that are not enabled by
 * default; an emulator never notices, and the live route would fail the first
 * time somebody used it. Walking posts, threads and sessions costs a few
 * hundred reads at KGC's size, once per deletion.
 */

export interface DeletionCounts {
  posts: number;
  replies: number;
  questions: number;
  messages: number;
  threads: number;
  reactions: number;
  upvotes: number;
  profile: boolean;
  directory: boolean;
  authAccount: boolean;
}

/** Firestore allows 500 writes in a batch; stay under it with room to spare. */
const BATCH_LIMIT = 400;

class Writer {
  private batch;
  private pending = 0;
  constructor(private readonly db: Firestore) {
    this.batch = db.batch();
  }
  async update(ref: DocumentReference, data: Record<string, unknown>) {
    this.batch.update(ref, data);
    await this.tick();
  }
  async delete(ref: DocumentReference) {
    this.batch.delete(ref);
    await this.tick();
  }
  private async tick() {
    this.pending += 1;
    if (this.pending >= BATCH_LIMIT) await this.flush();
  }
  async flush() {
    if (this.pending === 0) return;
    await this.batch.commit();
    this.batch = this.db.batch();
    this.pending = 0;
  }
}

/**
 * Remove an account and everything personal attached to it.
 *
 * `uid` must already be proven to belong to the caller (an ID token, or an
 * emailed code matched to the address): this function trusts it.
 */
export async function deleteAccountData(auth: Auth, db: Firestore, uid: string): Promise<DeletionCounts> {
  if (!uid || uid === DELETED_USER_ID || uid.includes('/')) throw new Error('Not a deletable account id.');

  const counts: DeletionCounts = {
    posts: 0,
    replies: 0,
    questions: 0,
    messages: 0,
    threads: 0,
    reactions: 0,
    upvotes: 0,
    profile: false,
    directory: false,
    authAccount: false,
  };
  const w = new Writer(db);

  // Community: posts they wrote, replies they wrote anywhere, their reactions.
  const posts = await db.collection(COLLECTIONS.communityPosts).get();
  for (const post of posts.docs) {
    if (post.get('authorId') === uid) {
      await w.update(post.ref, { authorId: DELETED_USER_ID });
      counts.posts += 1;
    }
    const replies = await post.ref.collection(SUBCOLLECTIONS.replies).where('authorId', '==', uid).get();
    for (const r of replies.docs) {
      await w.update(r.ref, { authorId: DELETED_USER_ID });
      counts.replies += 1;
    }
    const reaction = await post.ref.collection(SUBCOLLECTIONS.reactions).doc(uid).get();
    if (reaction.exists) {
      await w.delete(reaction.ref);
      counts.reactions += 1;
    }
  }

  // Session Q&A: questions they asked, and their upvotes on anyone's question.
  const sessions = await db.collection(COLLECTIONS.sessions).get();
  for (const session of sessions.docs) {
    const questions = await session.ref.collection(SUBCOLLECTIONS.questions).get();
    for (const q of questions.docs) {
      if (q.get('authorId') === uid) {
        await w.update(q.ref, { authorId: DELETED_USER_ID });
        counts.questions += 1;
      }
      const upvote = await q.ref.collection(SUBCOLLECTIONS.upvotes).doc(uid).get();
      if (upvote.exists) {
        await w.delete(upvote.ref);
        counts.upvotes += 1;
      }
    }
  }

  // Messages: the other person keeps the thread; this side becomes "Deleted user".
  const threads = await db.collection(COLLECTIONS.threads).where('participantIds', 'array-contains', uid).get();
  for (const thread of threads.docs) {
    const sent = await thread.ref.collection(SUBCOLLECTIONS.messages).where('senderId', '==', uid).get();
    for (const m of sent.docs) {
      await w.update(m.ref, { senderId: DELETED_USER_ID });
      counts.messages += 1;
    }
    const data = thread.data() as { participantIds?: string[]; unread?: Record<string, number>; lastSenderId?: string };
    const unread = { ...(data.unread ?? {}) };
    delete unread[uid];
    unread[DELETED_USER_ID] = 0;
    await w.update(thread.ref, {
      participantIds: (data.participantIds ?? []).map((p) => (p === uid ? DELETED_USER_ID : p)),
      unread,
      ...(data.lastSenderId === uid ? { lastSenderId: DELETED_USER_ID } : {}),
    });
    counts.threads += 1;
  }
  await w.flush();

  // The profile and everything under it, and the directory card.
  const profileRef = db.collection(COLLECTIONS.users).doc(uid);
  counts.profile = (await profileRef.get()).exists;
  await db.recursiveDelete(profileRef);

  const directoryRef = db.collection(COLLECTIONS.directory).doc(uid);
  counts.directory = (await directoryRef.get()).exists;
  if (counts.directory) await directoryRef.delete();

  // Last, so a failure above leaves the person able to sign in and retry.
  try {
    await auth.deleteUser(uid);
    counts.authAccount = true;
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
  }

  await db.collection(COLLECTIONS.auditLog).add({
    eventId: EVENT_ID,
    // Not a person: the account holder asked, and the website did it. Their
    // email is deliberately not recorded, since removing it is the point.
    actor: 'website',
    action: 'account.delete',
    targetPath: `${COLLECTIONS.users}/${uid}`,
    targetId: uid,
    before: {},
    after: { ...counts },
    // A plain Date, not a sentinel: the emulator suite hands in a store built
    // by another copy of firebase-admin, and sentinels fail `instanceof` across
    // copies (AGENTS.md, gotcha 8).
    at: new Date(),
  });

  return counts;
}

/**
 * Which uid an emailed-code deletion should remove.
 *
 * The Auth account under that address if there is one (a person who signed in
 * with a code before buying may have an Auth-generated uid), otherwise the uid
 * derived from the address, so leftover profile data from a provisioned
 * account whose Auth record is already gone is still cleaned up.
 */
export async function uidForDeletion(auth: Auth, email: string, derivedUid: string): Promise<string> {
  const user = await auth.getUserByEmail(email).catch((err: { code?: string }) => {
    if (err.code === 'auth/user-not-found') return null;
    throw err;
  });
  return user?.uid ?? derivedUid;
}
