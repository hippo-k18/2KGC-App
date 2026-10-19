/**
 * The community board's categories — the ids *and* the words printed beside
 * them, in one declaration.
 *
 * ── Why the labels moved here ───────────────────────────────────────────────
 *
 * The ids were shared and the labels were not, so three installs each kept
 * their own copy and two of them had already drifted: the app called `meetup`
 * "Meet-ups" and `ride-share` "Travel", while the dashboard's moderation queue
 * and its engagement lib both said "Meet-up" and "Ride share". An organizer
 * deciding whether to hide a post was therefore reading a category name that
 * appears nowhere in the app, which is precisely the wrong moment to be looking
 * at a different product from the person who wrote the post.
 *
 * The app's wording wins because the app is where a human chooses one. These
 * strings are on the filter chips, in the composer's picker and on the badge at
 * the top of every post detail; the dashboard only ever renders them back to
 * staff. When two surfaces disagree about a name, the one an attendee typed
 * under is the name.
 *
 * ── One list, not a list and a union ────────────────────────────────────────
 *
 * `CommunityCategory` is derived from this array rather than written out beside
 * it, and `CommunityPostDoc.category` is that type. A seventh category is one
 * line here and the type, the labels and every exhaustive `Record` follow — the
 * shape of drift this file exists to remove, rather than a smaller copy of it.
 *
 * Presentation beyond the name stays out. The app keys its icons and tints off
 * these ids in `community/index.tsx` and deliberately does not fold them in:
 * the importer and any future Cloud Function read the ids too and have no
 * business knowing what a `storefront` is.
 */
export const COMMUNITY_CATEGORIES = [
  { id: "meetup", label: "Meet-ups" },
  { id: "ride-share", label: "Travel" },
  { id: "jobs", label: "Jobs" },
  { id: "questions", label: "Questions" },
  { id: "lost-and-found", label: "Lost & found" },
  { id: "ice-breakers", label: "Ice breakers" },
] as const;

/** The stored value of `CommunityPostDoc.category`. */
export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number]["id"];

/**
 * Category id → printed name.
 *
 * A `Record` keyed by the union, so a category added to the array above without
 * a label is a type error rather than a screen that prints an id.
 */
export const COMMUNITY_CATEGORY_LABEL: Record<CommunityCategory, string> =
  Object.fromEntries(COMMUNITY_CATEGORIES.map((c) => [c.id, c.label])) as Record<
    CommunityCategory,
    string
  >;

/**
 * The label for a category id that came out of Firestore.
 *
 * Takes a plain `string` and falls back to it, because a stored document can
 * hold a category this build has never heard of — a seed from a later version,
 * or one that was removed. Printing the raw id is ugly and honest; printing
 * nothing hides a post.
 */
export function communityCategoryLabel(id: string): string {
  return COMMUNITY_CATEGORY_LABEL[id as CommunityCategory] ?? id;
}

/**
 * Whether a reply should be shown to an attendee.
 *
 * ── What enforces this, and what this function is for ───────────────────────
 *
 * ⚠️ This block used to say a `list` could not be constrained by rules and that
 * this function was the only thing taking a hidden reply off the board. Both
 * halves were wrong, and while they stood the hide was a courtesy. A rules
 * `list` is evaluated against the fields the QUERY constrains, so
 * `firestore.rules` can require — and does require — that a reply query carry
 * `where('status', '==', 'visible')`. A hidden reply is not returned to an
 * attendee by any query, and `allow get` keeps it from being fetched on its
 * own. `tests/rules/firestore.test.ts` pins both verbs.
 *
 * So this is the second filter, not the only one. It still earns its place:
 * the dashboard reads the board with the Admin SDK, which bypasses rules
 * entirely, and a reader that widens its query one day should not start
 * printing moderated text.
 *
 * It tolerates an absent `status` because a reply written before the field
 * existed is a visible reply, not a hidden one. Such a reply is in no filtered
 * query at all — Firestore cannot ask for a field that is absent — which is
 * what `scripts/ops/backfill-reply-status.ts` is for.
 *
 * It lives here rather than in the app so there is one sentence deciding it —
 * the dashboard's moderation screen reasons about the same field, and a second
 * copy that read `status === 'visible'` would quietly drop the older replies.
 */
export function replyIsVisible(reply: { status?: string }): boolean {
  return !reply.status || reply.status === "visible";
}
