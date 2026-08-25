import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  type CommunityPostDoc,
  type CommunityReplyDoc,
  type UserDoc,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * Engagement › Community, and Attendee Matchmaking.
 *
 * Whova presents four features here — Meet-ups, Discussion Topics, Social
 * Groups and Attendee Matchmaking. Three of them are one feature wearing three
 * hats: a board of posts sorted by category. `CommunityPostDoc.category` already
 * exists, the app's Community tab already writes it, and the moderation queue
 * already reads it, so these are three **views** over `communityPosts` rather
 * than three collections.
 *
 * Inventing `meetups`, `discussionTopics` and `socialGroups` would have meant
 * three more write paths in an app that already has one, three more rules
 * blocks, and — the part that actually bites — three more places a post can
 * stay visible after an organizer hides it, because the moderation queue only
 * knows about `communityPosts`.
 *
 * ── One equality per query, sort in memory ──────────────────────────────────
 *
 * Every read below is a single `where('eventId', '==', EVENT_ID)` and nothing
 * else. That equality is served by Firestore's automatic single-field index, so
 * it needs no entry in `firestore.indexes.json`. Add an `orderBy` and it
 * becomes a composite query needing an index this repo does not declare — and
 * the emulator **does not enforce indexes**, so such a query passes every local
 * run and fails with `failed-precondition` against the real project. AGENTS.md
 * records that exact bug shipping twice, unnoticed, because the callers render
 * an empty state on error. Six posts and fifty attendees sort in microseconds;
 * the index is not worth adding until there is a reason to page in the query.
 *
 * ── The stored counters are ignored on purpose ──────────────────────────────
 *
 * `CommunityPostDoc.replyCount` and `.reactionCount` are trigger-owned, and the
 * triggers do not exist (Spark plan). They hold whatever the seed wrote and
 * never move. `replyCount` here is counted from the replies subcollection at
 * read time, which is correct and costs one extra read per post; reactions have
 * no equivalent recount, so nothing in these screens displays them.
 */

export type CommunityCategory = CommunityPostDoc['category'];

export const CATEGORY_LABEL: Record<CommunityCategory, string> = {
  meetup: 'Meet-up',
  'ride-share': 'Ride share',
  jobs: 'Jobs',
  questions: 'Questions',
  'lost-and-found': 'Lost & found',
  'ice-breakers': 'Ice breakers',
};

/**
 * Which categories each of Whova's three screens is a view of.
 *
 * Meet-ups and Discussion Topics map cleanly. Social Groups does not: it is the
 * remainder, and the screen says so rather than pretending `ride-share` is a
 * group somebody joined.
 */
export const MEET_UP_CATEGORIES: readonly CommunityCategory[] = ['meetup'];
export const DISCUSSION_CATEGORIES: readonly CommunityCategory[] = ['questions', 'ice-breakers'];
export const SOCIAL_CATEGORIES: readonly CommunityCategory[] = [
  'ride-share',
  'jobs',
  'lost-and-found',
];

export interface CommunityParticipant {
  name: string;
  createdAt: string;
}

export interface CommunityPostRow {
  id: string;
  category: CommunityCategory;
  title: string;
  body: string;
  authorName: string;
  authorId: string;
  status: CommunityPostDoc['status'];
  /** Counted from the subcollection, not read off the frozen stored counter. */
  replyCount: number;
  hiddenReplyCount: number;
  createdAt: string;
  /** ISO of the newest visible reply, or null. The only liveness signal here. */
  lastReplyAt: string | null;
  /**
   * Reply authors, deduped, oldest first. This is the nearest thing the data
   * has to an attendee list for a meet-up — it is not an RSVP, and every screen
   * that shows it labels it as replies rather than as attendance.
   */
  participants: CommunityParticipant[];
}

function iso(t: { toDate(): Date } | undefined): string {
  try {
    return t?.toDate().toISOString() ?? new Date(0).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/**
 * The whole board, newest first, with replies resolved.
 *
 * One function rather than one per screen: the three category views each want
 * the totals of the other two for their cross-links, and splitting this into
 * three filtered reads would triple the work to serve a number each page needs
 * anyway. Callers filter on `category`.
 *
 * Replies are fetched per post in parallel — six posts today. If the board ever
 * ran to hundreds this wants paging before it wants an index, and the same note
 * is on `listBoardForModeration()` for the same reason.
 */
export async function listCommunityPosts(): Promise<CommunityPostRow[]> {
  const [postSnap, userSnap] = await Promise.all([
    db().collection(COLLECTIONS.communityPosts).where('eventId', '==', EVENT_ID).get(),
    db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get(),
  ]);

  // A board where every row says `demo_014` is a board nobody can act on.
  const names = new Map(userSnap.docs.map((d) => [d.id, (d.data() as UserDoc).name || d.id]));

  const rows = await Promise.all(
    postSnap.docs.map(async (d) => {
      const p = d.data() as CommunityPostDoc;
      const replySnap = await d.ref.collection(SUBCOLLECTIONS.replies).get();

      const replies = replySnap.docs
        .map((r) => {
          const rep = r.data() as CommunityReplyDoc;
          return {
            authorId: rep.authorId,
            status: rep.status ?? 'visible',
            createdAt: iso(rep.createdAt),
          };
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      const visible = replies.filter((r) => r.status === 'visible');
      const participants: CommunityParticipant[] = [];
      const seen = new Set<string>();
      for (const r of visible) {
        if (seen.has(r.authorId)) continue;
        seen.add(r.authorId);
        participants.push({ name: names.get(r.authorId) ?? r.authorId, createdAt: r.createdAt });
      }

      const row: CommunityPostRow = {
        id: d.id,
        category: p.category,
        title: p.title,
        body: p.body,
        authorName: names.get(p.authorId) ?? p.authorId,
        authorId: p.authorId,
        status: p.status ?? 'visible',
        replyCount: visible.length,
        hiddenReplyCount: replies.length - visible.length,
        createdAt: iso(p.createdAt),
        lastReplyAt: visible.length > 0 ? visible[visible.length - 1].createdAt : null,
        participants,
      };
      return row;
    }),
  );

  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Posts in the given categories, preserving the newest-first order above. */
export function inCategories(
  posts: CommunityPostRow[],
  categories: readonly CommunityCategory[],
): CommunityPostRow[] {
  return posts.filter((p) => categories.includes(p.category));
}

// ---------------------------------------------------------------------------
// Attendee Matchmaking
// ---------------------------------------------------------------------------

export interface ClusterMember {
  uid: string;
  name: string;
  title?: string;
  company?: string;
  /**
   * An organizer reading this console sees every profile, because the Admin SDK
   * bypasses rules. Whether the attendee agreed to be *seen by other attendees*
   * is a different question, and it decides whether they may be suggested as an
   * introduction below.
   */
  visibleInDirectory: boolean;
}

export interface InterestCluster {
  interest: string;
  members: ClusterMember[];
}

export interface SharedInterestPair {
  a: ClusterMember;
  b: ClusterMember;
  shared: string[];
}

export interface MatchmakingRead {
  clusters: InterestCluster[];
  pairs: SharedInterestPair[];
  totalAttendees: number;
  withInterests: number;
  optedOut: number;
  /** How many pairs cleared the threshold, before the display cap. */
  pairsFound: number;
}

/** Two shared interests, not one — see the pairing note. */
const MIN_SHARED = 2;

/** Rendered pairs. The arithmetic is uncapped; the table is not. */
const MAX_PAIRS = 60;

/**
 * Interest clusters over `users`, and the pairs who share them.
 *
 * Reads `users` rather than `directory`. `directory/{uid}` is the slim
 * projection attendees read, written by a `mirrorDirectory` trigger that does
 * not exist yet — so it is stale by construction and would undercount. `users`
 * is the source of truth, and `visibleInDirectory` on it is the same consent
 * flag the mirror would have honoured.
 *
 * ── Pairing is O(n²), knowingly ─────────────────────────────────────────────
 *
 * Fifty attendees is 1,225 comparisons of two short arrays. A thousand — the
 * number this event is sized for — is roughly half a million, still well under
 * a second on one request, and this page is `force-dynamic` so it runs per
 * view. That is the ceiling: beyond it this needs precomputing, not tuning.
 *
 * The threshold is two shared interests rather than one on purpose. Everyone
 * picks from the same eleven topics, so a single overlap is close to noise —
 * with one shared interest 226 of the 1,225 seed pairs qualify and the list
 * stops meaning anything.
 *
 * ── Opted-out attendees are counted but never suggested ─────────────────────
 *
 * Someone who turned off directory visibility still shows in the cluster
 * counts, because an organizer planning a topic table needs to know how many
 * people care about a subject. They are excluded from suggested introductions,
 * because an introduction is the one output here whose whole purpose is to be
 * passed on to another attendee.
 */
export async function readMatchmaking(): Promise<MatchmakingRead> {
  const snap = await db().collection(COLLECTIONS.users).where('eventId', '==', EVENT_ID).get();

  const people = snap.docs.map((d) => {
    const u = d.data() as UserDoc;
    return {
      member: {
        uid: d.id,
        name: u.name || d.id,
        title: u.title,
        company: u.company,
        visibleInDirectory: Boolean(u.visibleInDirectory),
      } satisfies ClusterMember,
      interests: (u.interests ?? []).filter(Boolean),
    };
  });

  const byInterest = new Map<string, ClusterMember[]>();
  for (const p of people) {
    for (const i of p.interests) {
      const bucket = byInterest.get(i);
      if (bucket) bucket.push(p.member);
      else byInterest.set(i, [p.member]);
    }
  }

  const clusters: InterestCluster[] = [...byInterest.entries()]
    .map(([interest, members]) => ({
      interest,
      members: members.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.members.length - a.members.length || a.interest.localeCompare(b.interest));

  const pairable = people.filter((p) => p.member.visibleInDirectory && p.interests.length > 0);
  const all: SharedInterestPair[] = [];
  for (let i = 0; i < pairable.length; i++) {
    const a = pairable[i];
    const aSet = new Set(a.interests);
    for (let j = i + 1; j < pairable.length; j++) {
      const b = pairable[j];
      const shared = b.interests.filter((x) => aSet.has(x));
      if (shared.length >= MIN_SHARED) {
        all.push({ a: a.member, b: b.member, shared: shared.sort() });
      }
    }
  }
  all.sort(
    (x, y) => y.shared.length - x.shared.length || x.a.name.localeCompare(y.a.name),
  );

  return {
    clusters,
    pairs: all.slice(0, MAX_PAIRS),
    totalAttendees: people.length,
    withInterests: people.filter((p) => p.interests.length > 0).length,
    optedOut: people.filter((p) => !p.member.visibleInDirectory).length,
    pairsFound: all.length,
  };
}
