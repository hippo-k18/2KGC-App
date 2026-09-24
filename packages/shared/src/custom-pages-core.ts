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
  "exhibitor",
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
  "search",
  "sitemap.xml",
  "speaker",
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
 * Addresses the site redirects away before Next ever sees them.
 *
 * `apps/web/public/_redirects` carries the move off WordPress: 926 old
 * addresses, of which these are the ones that are a single segment and would
 * therefore collide with the `[slug]` route a custom page is served at. A
 * redirect is evaluated by the host before any route, so a page published at
 * one of these saves successfully, reports its address back to the organizer,
 * and sends every visitor somewhere else. The branded event slug is printed on
 * badges, which makes it the expensive one to get wrong.
 *
 * Kept separate from the list above because the two are wrong in different
 * ways and the organizer needs to be told which: one is a part of the site,
 * the other is an old address still being honoured.
 *
 * ⚠️ **Maintained by hand against `apps/web/public/_redirects`**, which the
 * dashboard cannot import — the two are separate installs. Nothing here checks
 * it for you at runtime; `tests/parity/reserved-slugs.test.ts` checks it at
 * test time, and is the reason this list cannot quietly fall behind.
 */
export const REDIRECTED_PAGE_SLUGS: readonly string[] = [
  "2022-home",
  "2026-draft",
  "2026-speakers",
  "about-2",
  "about-kgc",
  "ama-with-the-authors-of-the-practitioners-guide-to-graph-data",
  "call-for-speakers",
  "code-of-conduct-2023",
  "come-work-with-us",
  "community-code-of-conduct",
  "conference-2019",
  "conference-2020",
  "conference-2022",
  "conference-2024",
  "conference-2025",
  "conference-terms-and-conditions",
  "data-architecture-catalogs-and-cocktails",
  "feed",
  "finance",
  "from-vision-to-reality",
  "general-admission",
  "get-newsletters",
  "instructor-profile-michael-atkin",
  "join",
  "kgc-2022",
  "kgc-2022-call-for-presentations",
  "kgc-2022-call-for-tool-demonstrations",
  "kgc-2022-call-for-workshops-and-tutorials",
  "kgc-2022-faq",
  "kgc-2022-home",
  "kgc-2022-partner",
  "kgc-2022-program",
  "kgc-2022-tutorial-a-beginners-guide-to-reasoning-how-to-reason-your-way-to-better-data",
  "kgc-2022-tutorial-advancing-un-city-resilience-efforts-using-relational-knowledge-graphs-for-risk-modeling",
  "kgc-2022-tutorial-analysis-of-the-impact-of-covid-19-ontologies",
  "kgc-2022-tutorial-bridging-the-gap-between-business-domains-and-knowledge-graphs",
  "kgc-2022-tutorial-build-on-synergies-and-share-standards-and-technologies-to-boost-your-knowledge-organisation-systems-and-language-resources",
  "kgc-2022-tutorial-dbpedia-knowledge-graph-tech-tutorial-2-0",
  "kgc-2022-tutorial-demystify-graph-and-graph-technologies",
  "kgc-2022-tutorial-detect-fraud-and-recommend-products-with-graphs",
  "kgc-2022-tutorial-developing-and-refining-schemas-for-knowledge-graphs",
  "kgc-2022-tutorial-foundation-for-a-knowledge-graph-taxonomy-design-best-practices",
  "kgc-2022-tutorial-hands-on-automatic-quality-assessment-of-knowledge-graphs",
  "kgc-2022-tutorial-hands-on-experience-defining-and-cataloging-data",
  "kgc-2022-tutorial-knowledge-democratization-a-business-user-tutorial-to-knowledge-graph-modeling",
  "kgc-2022-tutorial-knowledge-graph-data-modelling",
  "kgc-2022-tutorial-knowledge-graph-primer-creating-a-digital-twin-model",
  "kgc-2022-tutorial-knowledge-graph-toolkit",
  "kgc-2022-tutorial-knowledge-infused-reinforcement-learning",
  "kgc-2022-tutorial-low-code-meets-knowledge-graphs",
  "kgc-2022-tutorial-ml-model-with-the-vector-database-weaviate",
  "kgc-2022-tutorial-presentation-of-cellar-eu-publications-office-central-digital-repository",
  "kgc-2022-tutorial-tutorial-in-reasonable-ontology-templates-ottr",
  "kgc-2022-tutorial-validating-semantic-knowledge-graphs-using-shacl",
  "kgc-2022-workshop-agile-practices-for-knowledge-graph-engineering",
  "kgc-2022-workshop-agile-practices-for-knowledge-graph-engineering-2",
  "kgc-2022-workshop-application-of-reasoning-on-complex-and-evolving-data-methods-and-use-cases",
  "kgc-2022-workshop-building-ontologies-and-knowledge-graphs",
  "kgc-2022-workshop-geospatial-knowledge-graphs",
  "kgc-2022-workshop-graph-systems-thinking",
  "kgc-2022-workshop-healthcare-and-life-sciences-symposium",
  "kgc-2022-workshop-kgc-community-education",
  "kgc-2022-workshop-knowledge-graphs-for-interoperability-in-the-transportation-domain",
  "kgc-2022-workshop-network-effects-in-web3",
  "kgc-2022-workshop-representing-and-reasoning-with-imperfect-knowledge",
  "kgc-2023",
  "kgc-2023-conference-policy-terms-and-conditions",
  "kgc-2023-faq",
  "kgc-2023-home",
  "kgc-2023-speakers",
  "kgc-2024-conference-policy-terms-and-conditions",
  "kgc-2024-startup-pitch-event",
  "kgc-2025-conference-policy-terms-and-conditions",
  "kgc-23-registration-fees",
  "kgc-bookclub-demystifying-owl-for-the-enterprise-with-michael-uschold",
  "kgc-home",
  "kgc2021",
  "kgc2022-tutorial-dbpedia-knowledge-graph-tech-tutorial-2-0",
  "kgc2025",
  "knowledge-graph-industry-survey-2022",
  "knowledge-graph-learning-program",
  "knowledge-graph-learning-program-individual",
  "knowledge-graph-learning-program-organization",
  "learning-material",
  "life-sciences",
  "modeling-sustainability",
  "nlp-for-kgs",
  "nsfs-okn-innovation-sprint",
  "partner",
  "partner-with-us",
  "privacy-policy",
  "privacy-policy-2023",
  "program",
  "schedule-at-a-glance",
  "services",
  "session-by-track",
  "speakers-2021",
  "speakers-2022-page",
  "standardization-efforts-for-knowledge-graphs",
  "the-business-case-for-semantic-data-management",
  "the-knowledge-graph-conference-kgc",
  "the-knowledge-graph-learning-program-pending-approval",
  "transactions",
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
  if (REDIRECTED_PAGE_SLUGS.includes(slug)) {
    return `/${slug} already sends visitors to an older page, so nobody would reach this one. Pick another address.`;
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
