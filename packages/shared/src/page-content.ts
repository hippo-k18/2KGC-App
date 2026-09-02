/**
 * The `pageContent/{pageId}` contract — which prose pages on the public
 * website can be edited without a deploy, and exactly which of their fields.
 *
 * ── Who writes it ───────────────────────────────────────────────────────────
 *
 * The dashboard, at Content › Basics › Website Copy —
 * `apps/organizer/src/app/(dash)/content/basics/website-copy/`, over
 * `apps/organizer/src/lib/page-content.ts`. Both sides use the Admin SDK, which
 * is why this collection has no `match` block in `firestore.rules` and needs
 * none. All three reading pages are `force-dynamic`, so a save is on the public
 * site on the next request: "without a deploy" is literal.
 *
 * ⚠️ For a long time there was **no writer at all** — this file described an
 * editor, `apps/web` read the store from three pages, and nothing anywhere
 * wrote it, so every field silently rendered from the constant beside it. That
 * is the shape of defect worth naming: a contract is not a capability until
 * something on the other end of it can write.
 *
 * ── Why this is not "a CMS" ─────────────────────────────────────────────────
 *
 * Thirteen of the website's twenty-one pages hold their copy in React, and the
 * tempting reading of that number is "move all thirteen into Firestore". That
 * would be wrong twice over. Most of those pages are *layout* — `/about` is
 * five hand-measured bands with per-band colours and a paragraph set in a
 * different typeface from everything around it — so storing them as text loses
 * the design, and storing them as HTML makes an organizer's text box a script
 * injection point on a public page. And most of that copy is history: when the
 * conference was founded, at which university, by whom. A field that changes
 * once a decade is not better in a database; it is the same string, further
 * from the code that renders it, with a network round trip in front of it.
 *
 * So this is deliberately **field-level, not page-level**. Each page declares
 * the handful of values that genuinely go stale between editions, and nothing
 * else. The pages that carry none of those are not represented here at all —
 * a key with no reader is a promise that an editor is coming, and this repo has
 * been bitten by reserved keys before (see the three that `settings.ts` had to
 * delete).
 *
 * ── The defaults are NOT here ───────────────────────────────────────────────
 *
 * Only the key names and the shapes live in `@kgc/shared`, because those are
 * what two installs that cannot import each other must agree on. The copy
 * itself stays beside the page that renders it, and the reader takes it as a
 * required argument — so there is no code path in which a page renders empty.
 * `site.ts` makes the same call about "3–7 May 2027": presentation strings
 * belong to the presentation, not to the shared model.
 *
 * ── What a document looks like ──────────────────────────────────────────────
 *
 *   pageContent/call-for-posters
 *     { eventId, values: { dates: [...] }, updatedAt, updatedBy }
 *
 * `values` is a **partial** bag: an editor that only ever changed the deadlines
 * writes only `dates`, and every other field keeps the page's own constant.
 * That is what makes the store additive rather than a switch — there is no
 * "migrate the copy in" step, and a document written by a future editor that
 * knows about a field this version does not is ignored rather than rendered.
 */

/**
 * Every page that can be edited without a deploy.
 *
 * The value is the Firestore document id and is also the page's URL path,
 * because an organizer looking at a document id should be able to tell which
 * page they are about to change.
 */
export const PAGE_CONTENT_KEYS = {
  codeOfConduct: "code-of-conduct",
  callForPosters: "call-for-posters",
  startupPitch: "startup-pitch",
} as const;

export type PageContentKey = (typeof PAGE_CONTENT_KEYS)[keyof typeof PAGE_CONTENT_KEYS];

/** One dated line on a call page: a deadline and what falls due on it. */
export interface CallMilestone {
  /** Written out as it is printed — "March 25, 2027". Free text on purpose. */
  when: string;
  /** What happens then. One line. */
  what: string;
}

/**
 * A page that invites a submission and states when it closes.
 *
 * Shared by the poster track and the startup pitch, which are the same page
 * with different words: an outbound submission link, and a calendar that is
 * provisional until somebody confirms it. Both currently ship deadlines marked
 * PLACEHOLDER in the source and submission URLs that still carry `2026` — the
 * exact pair of mistakes that a deploy-to-edit page accumulates.
 */
export interface CallPageContent {
  /** Where a submission is made. An absolute URL; a blank one hides the button. */
  submitUrl: string;
  /** The button's label, because "Submit on EasyChair" names a third party that can change. */
  submitLabel: string;
  /**
   * Whether the calendar is settled.
   *
   * A boolean rather than an inference from the dates, because "provisional"
   * is a claim only a human can make: a fully populated list of plausible
   * dates is indistinguishable from a confirmed one, and an author planning
   * their year around a date we invented is the failure this flag prevents.
   */
  datesConfirmed: boolean;
  /** The deadlines, in the order they are printed. */
  dates: CallMilestone[];
}

/**
 * The parts of the code of conduct that go stale — and only those.
 *
 * ⚠️ **The policy text is deliberately absent and must stay absent.** The body
 * of the code of conduct is the instrument attendees are told they have agreed
 * to and that organizers enforce against; changing it is a legal act, and it
 * should leave a reviewable history in git rather than happening in a text box
 * with no approval step. What does change between editions is the *reporting
 * route* — who you contact when something happens — and a stale name there is
 * the one part of this page that fails a person at the moment they need it.
 */
export interface CodeOfConductContent {
  /** The address an incident is reported to. Lower case. */
  reportEmail: string;
  /** The Executive Committee, one "Name, Role" line each, in the order printed. */
  committee: string[];
}

/** Page id → the shape of that page's editable fields. */
export interface PageContentValues {
  "code-of-conduct": CodeOfConductContent;
  "call-for-posters": CallPageContent;
  "startup-pitch": CallPageContent;
}

/**
 * The stored document.
 *
 * `eventId` leads it for the same reason it leads every other top-level
 * document here: KGC 2028 gets its own copy rather than overwriting this one.
 * A reader that finds a different `eventId` must fall back to its constants
 * rather than render another year's deadlines.
 */
export interface PageContentDoc<K extends PageContentKey = PageContentKey> {
  eventId: string;
  /** A partial bag — see the header. Never assume a field is present. */
  values: Partial<PageContentValues[K]>;
  updatedAt?: unknown;
  updatedBy?: string;
}
