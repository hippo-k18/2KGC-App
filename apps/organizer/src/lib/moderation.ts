import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  type CommunityPostDoc,
  type CommunityReplyDoc,
  type SessionDoc,
  type SessionQuestionDoc,
  type UserDoc,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * Moderation queues for the community board and session Q&A.
 *
 * `gaps.ts` records this as "the community board is built and unmoderated. A
 * hide flag plus a queue over communityPosts is small and would matter the
 * first time it matters." The flag already existed — `CommunityPostDoc.status`
 * and `CommunityReplyDoc.status` are both `visible | hidden | removed`, and the
 * reply one carries a comment explaining that without it an abusive reply on a
 * board read by 1,000 attendees has no remedy at all. Nothing read them.
 *
 * ── Hidden, never deleted ───────────────────────────────────────────────────
 *
 * Every action here is a status change. Three reasons, and the third is the one
 * that decides it:
 *
 *   `replyCount` and `reactionCount` are derived from documents that still have
 *   to exist for the arithmetic to work.
 *
 *   An organizer will hide the wrong thing at some point, at speed, during an
 *   event. `removed` is recoverable; a delete is not.
 *
 *   If a post is hidden because it was abusive, **the post is the evidence.**
 *   Deleting it destroys the only record of what happened, which is exactly
 *   what a code-of-conduct process needs.
 *
 * ── Author names are resolved, not shown as uids ────────────────────────────
 *
 * A moderation queue where every row says `demo_014` is a queue nobody can act
 * on. One read of `users` joins them; at conference volumes that is one query.
 *
 * ── `replyCount` is recomputed, not read off the stored counter ─────────────
 *
 * `communityPosts/{id}.replyCount` is trigger-owned (`onReplyWrite`,
 * functions/SPEC.md #1) and the trigger is unbuilt (Spark plan), so the stored
 * value holds whatever the seed wrote and never moves — reading it here would
 * show a moderator a number the underlying replies no longer support. Counted
 * instead from `replySnap.size` below, which this function already fetches for
 * the `replies` array, so this costs no extra read.
 *
 * This count is **not** filtered to `status === 'visible'`, unlike
 * `engagement.ts`'s `listCommunityPosts()`, which deliberately shows attendees
 * only the visible count. Two different numbers for two different audiences,
 * on purpose: SPEC.md #1 says the trigger "must not decrement on a status
 * change (hidden/removed) — hiding a reply must not orphan the counter; only a
 * real delete... changes the count", so the true stored value once deployed
 * will include hidden and removed replies, and a moderator specifically needs
 * that total — it is the record of how much got hidden, not just what
 * survived. Matching `replySnap.size` here is what makes this value converge
 * on the deployed trigger's own number rather than on a different, smaller one.
 */

export interface ModeratedPost {
  id: string;
  category: CommunityPostDoc['category'];
  title: string;
  body: string;
  authorName: string;
  authorId: string;
  status: CommunityPostDoc['status'];
  replyCount: number;
  reactionCount: number;
  createdAt: string;
  /** Replies are moderated individually — an abusive reply on a fine post. */
  replies: ModeratedReply[];
}

export interface ModeratedReply {
  id: string;
  postId: string;
  body: string;
  authorName: string;
  /**
   * The uid, carried alongside the resolved name.
   *
   * A moderator reads the name; anything that *joins* a reply to a person needs
   * the id, because names are not unique in a room of a thousand and matching
   * on one would attribute an abusive reply to the wrong Chen. Attendee
   * Activity joins on this.
   */
  authorId: string;
  status: CommunityReplyDoc['status'];
  createdAt: string;
}

function iso(t: { toDate(): Date } | undefined): string {
  try {
    return t?.toDate().toISOString() ?? new Date(0).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

async function authorNames(): Promise<Map<string, string>> {
  const snap = await db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get();
  return new Map(snap.docs.map((d) => [d.id, (d.data() as UserDoc).name || d.id]));
}

/**
 * The board, with every reply, for moderation.
 *
 * Reads replies for all posts in parallel. At six posts that is trivial; if the
 * board ever ran to hundreds this would want paging, and the comment is here so
 * whoever notices knows it was a considered limit rather than an oversight.
 */
export async function listBoardForModeration(): Promise<ModeratedPost[]> {
  const [postSnap, names] = await Promise.all([
    db().collection(COLLECTIONS.communityPosts).where('eventId', '==', EVENT_ID).get(),
    authorNames(),
  ]);

  const posts = await Promise.all(
    postSnap.docs.map(async (d) => {
      const p = d.data() as CommunityPostDoc;
      const replySnap = await d.ref.collection(SUBCOLLECTIONS.replies).get();

      const replies: ModeratedReply[] = replySnap.docs
        .map((r) => {
          const rep = r.data() as CommunityReplyDoc;
          return {
            id: r.id,
            postId: d.id,
            body: rep.body,
            authorName: names.get(rep.authorId) ?? rep.authorId,
            authorId: rep.authorId,
            status: rep.status ?? 'visible',
            createdAt: iso(rep.createdAt),
          };
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      return {
        id: d.id,
        category: p.category,
        title: p.title,
        body: p.body,
        authorName: names.get(p.authorId) ?? p.authorId,
        authorId: p.authorId,
        status: p.status ?? 'visible',
        replyCount: replySnap.size,
        reactionCount: p.reactionCount ?? 0,
        createdAt: iso(p.createdAt),
        replies,
      };
    }),
  );

  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Session Q&A
// ---------------------------------------------------------------------------

export interface QaSessionRow {
  id: string;
  title: string;
  day: string;
  startsAtLocal: string;
  qaEnabled: boolean;
  pollsEnabled: boolean;
  status: SessionDoc['status'];
  questionCount: number;
  pendingCount: number;
  hiddenCount: number;
}

export interface QaQuestion {
  id: string;
  sessionId: string;
  sessionTitle: string;
  body: string;
  authorName: string;
  state: SessionQuestionDoc['state'];
  answered: boolean;
  /** Upvote documents actually present. This is the true number. */
  upvoteCount: number;
  /** `SessionQuestionDoc.upvoteCount` as stored — trigger-owned, and frozen. */
  storedUpvotes: number;
  createdAt: string;
}

/**
 * Sessions with their Q&A settings and question counts.
 *
 * ── The votes are counted here, never read off the question ─────────────────
 *
 * `SessionQuestionDoc.upvoteCount` is written by the `onQuestionUpvoteWrite`
 * trigger, and the triggers in `functions/` are written, tested and undeployed
 * (`OWNER-ACTIONS.md` §3). So that field holds whatever the seed wrote and does
 * not move, while the upvotes themselves land correctly, one document per voter,
 * in the `upvotes` subcollection. This screen read the frozen field, which is
 * why a moderator watched a question collect votes and saw zero.
 *
 * Counted instead, the same way `lib/polls.ts` counts ballots and the app's
 * `useUpvoteCounts` counts these: one `count()` aggregation per question, which
 * returns a number rather than the documents and so costs nothing at question
 * volumes. The stored figure comes back alongside as `storedUpvotes`, because
 * it is a genuinely different fact — it is what a phone that reads the question
 * document shows — and the queue orders by the counted one.
 */
export async function listQaSessions(): Promise<{ sessions: QaSessionRow[]; questions: QaQuestion[] }> {
  const [sessionSnap, names] = await Promise.all([
    db().collection(COLLECTIONS.sessions).where('eventId', '==', EVENT_ID).get(),
    authorNames(),
  ]);

  const live = sessionSnap.docs.filter((d) => {
    const s = d.data() as SessionDoc;
    return s.status !== 'cancelled' && !s.deletedAt;
  });

  const questions: QaQuestion[] = [];
  const sessions: QaSessionRow[] = [];

  await Promise.all(
    live.map(async (d) => {
      const s = d.data() as SessionDoc;
      const qSnap = await d.ref.collection(SUBCOLLECTIONS.questions).get();

      let pending = 0;
      let hidden = 0;
      const upvotes = await Promise.all(
        qSnap.docs.map((q) => q.ref.collection(SUBCOLLECTIONS.upvotes).count().get()),
      );

      qSnap.docs.forEach((q, i) => {
        const doc = q.data() as SessionQuestionDoc;
        if (doc.state === 'pending') pending++;
        if (doc.state === 'hidden') hidden++;
        questions.push({
          id: q.id,
          sessionId: d.id,
          sessionTitle: s.title,
          body: doc.body,
          authorName: names.get(doc.authorId) ?? doc.authorId,
          state: doc.state ?? 'pending',
          answered: Boolean(doc.answered),
          upvoteCount: upvotes[i].data().count,
          storedUpvotes: doc.upvoteCount ?? 0,
          createdAt: iso(doc.createdAt),
        });
      });

      sessions.push({
        id: d.id,
        title: s.title,
        day: s.day,
        startsAtLocal: s.startsAtLocal,
        qaEnabled: Boolean(s.qaEnabled),
        pollsEnabled: Boolean(s.pollsEnabled),
        status: s.status,
        questionCount: qSnap.size,
        pendingCount: pending,
        hiddenCount: hidden,
      });
    }),
  );

  /*
   * Newest first, still, now that the counts are real and could be sorted on.
   * A moderation queue answers "what just came in and is anybody waiting on
   * me", and the vote ranking is the *speaker's* question — the app already
   * ranks the approved board by votes, so ordering this list the same way would
   * bury a question asked thirty seconds ago beneath one that has been up for
   * an hour, which is the only thing a moderator is here to act on.
   */
  return {
    sessions: sessions.sort((a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal)),
    questions: questions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
