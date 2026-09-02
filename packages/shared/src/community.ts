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
