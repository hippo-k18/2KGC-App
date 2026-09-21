/**
 * Custom content pages — the venue note, the travel directions, the FAQ.
 *
 * The rules about a page's *address* live here rather than in the dashboard
 * action, because three places need the same answer and only one of them is a
 * form: the action validates, the website resolves `/{slug}` against the same
 * reserved list, and the seed builds its fixtures with the same normaliser. A
 * slug that the form accepts and the site cannot serve is a page an organizer
 * publishes and nobody can open.
 *
 * `rich-text-core.ts` is the other half of the feature: this file decides where
 * a page lives, that one decides what its body may contain.
 */

import type { BaseDoc } from "./models.js";

/**
 * `pages/{id}` — one organizer-authored page.
 *
 * ── Why `published` is a boolean and not a `PublishStatus` ──────────────────
 *
 * Every other authored thing here carries `draft | published | cancelled`,
 * because an attendee may already have saved it and a withdrawal has to be
 * distinguishable from a mistake. A page is copy at an address: there is
 * nothing to save and nothing to withdraw, and the third value would only ever
 * mean what `draft` already means. The screen calls it a switch and the field
 * is a switch.
 *
 * `slug` is stored lower-cased and normalised. It is not the document id: an
 * organizer renaming the address of a page they have already linked to should
 * not orphan every reference to it inside this database, and an id that can
 * change is an id nothing may point at.
 */
export interface PageDoc extends BaseDoc {
  title: string;
  /** Lower-case, hyphenated, unique. The website serves it at `/{slug}`. */
  slug: string;
  /** Markdown, in the subset `rich-text-core.ts` parses. No raw HTML. */
  body: string;
  /** One line under the title, on the list and in the page's meta description. */
  summary?: string;
  published: boolean;
  /** Low numbers first, in the app's list and on the website. */
  order: number;
}

/**
 * Addresses the website already answers, which a page may therefore not claim.
 *
 * Next resolves a static segment before the dynamic `[slug]` route, so a page
 * seeded at `agenda` would never be reached — the agenda would win, silently,
 * and the organizer would see a published page and a URL showing them something
 * else entirely. Refusing it at the form is the only place that failure is
 * legible.
 *
 * ⚠️ **This list has to be maintained by hand against `apps/web/src/app/`.**
 * The dashboard and the website are separate installs and neither imports the
 * other, so nothing checks it for you. When a top-level route is added to the
 * site, add its segment here in the same commit.
 */
export const RESERVED_PAGE_SLUGS: readonly string[] = [
  "about",
  "agenda",
  "announcements",
  "api",
  "blog",
  "call-for-posters",
  "checkout",
  "code-of-conduct",
  "community",
  "consent",
  "documents",
  "exhibitors",
  "favicon.ico",
  "hcls",
  "kgc-lifetime-achievement-awards",
  "learn",
  "order",
  "previous-events",
  "privacy",
  "r",
  "review",
  "robots.txt",
  "rooms",
  "sitemap.xml",
  "speakers",
  "sponsor",
  "startup-pitch",
  "submit",
  "team",
  "tickets",
  "tickets1",
  "u",
];

/**
 * A title turned into an address, or a typed address tidied.
 *
 * Accents are folded rather than dropped — `Café` becomes `cafe`, not `caf` —
 * because the alternative produces an address that reads like a typo. Anything
 * that is still not a letter, digit or hyphen becomes a hyphen, and runs
 * collapse.
 */
export function normaliseSlug(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** The longest a page body may be. Roughly four screens of prose. */
export const PAGE_BODY_MAX = 20000;

/**
 * What is wrong with a slug, in words an organizer can act on, or `null`.
 *
 * `taken` is passed in rather than queried here so this stays a pure function
 * the tests can drive; the action supplies the slugs already in use, minus the
 * page being edited.
 */
export function slugProblem(slug: string, taken: readonly string[] = []): string | null {
  if (slug === "") return "Give the page a web address. Letters, numbers and hyphens.";
  if (slug.length < 2) return "The web address is too short. Use at least two characters.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return "Use lower-case letters, numbers and single hyphens only.";
  }
  if (RESERVED_PAGE_SLUGS.includes(slug)) {
    return `The website already uses /${slug}. Pick another address.`;
  }
  if (taken.includes(slug)) return "Another page already has that address.";
  return null;
}

/**
 * The order pages are listed in, everywhere.
 *
 * Sorted in memory rather than in the query, for the reason
 * `app/src/lib/data/documents.ts` gives about `order`: a document written
 * without the field is absent from the index entirely, so ordering by it in
 * Firestore drops pages rather than sorting them last. Title breaks ties.
 *
 * The comparator is exported beside the sort because the app's `useCollection`
 * takes one and the two other surfaces take a list. Three copies of "order,
 * then title" is three chances for the phone to show a different sequence from
 * the website.
 */
export function comparePages(
  a: { title: string; order?: number },
  b: { title: string; order?: number },
): number {
  return (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title);
}

export function sortPages<T extends { title: string; order?: number }>(pages: T[]): T[] {
  return [...pages].sort(comparePages);
}
