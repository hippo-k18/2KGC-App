/**
 * Which roster the public `/speakers` page renders. **This is the switch.**
 *
 * ── Why it lives here and not in either app ─────────────────────────────────
 *
 * It used to live twice: once in `apps/web/src/lib/site.ts` and once, copied by
 * hand, in `apps/organizer/src/lib/webpages.ts`. Both copies carried a comment
 * explaining that the two apps are separate installs and neither may import the
 * other, so the decision had to be written down in both places and kept in step
 * by whoever remembered.
 *
 * That premise was wrong. Both apps already depend on `@kgc/shared` — this
 * package — and on `@kgc/scripts`, and both already import shared logic across
 * that boundary (`validateAnswers` is the obvious precedent). There was never
 * a reason for two copies, and the cost of having them was concrete: while the
 * website rendered a checked-in roster, the dashboard's readiness screen went
 * on counting Firestore speakers with no headshot and reporting them as
 * problems with a page that rendered none of those records.
 *
 * One declaration, imported by both. The class of bug is now unavailable.
 *
 * ── The two values ──────────────────────────────────────────────────────────
 *
 * `'firestore'` — the live `speakers` collection. **This is the shipping
 * value**, set 2026-09-01 at the owner's direction, and it is the reason the
 * page is editable at all: Speaker Manager writes these documents, and the
 * public page renders what it writes.
 *
 * ⚠️ **What that publishes right now.** The `speakers` collection holds the
 * speakers `npm run seed` writes, and those people are invented — plausible
 * names, plausible employers, invented. They are on the public internet under
 * the heading "Our First Speakers". This was raised and the owner chose it
 * knowingly: the alternative was publishing the real KGC 2026 roster on a site
 * that markets 2027, and a placeholder that is obviously a placeholder was
 * judged the lesser of the two. **Replace them before the site is announced** —
 * `npm run import:whova` or `npm run import:speakers-2026` both overwrite this
 * collection, and the second one exists for exactly that.
 *
 * `'2026-roster'` — the real, published KGC 2026 speakers, checked in as data
 * at `@kgc/scripts/src/lib/speakers-2026`. This was the shipping value while
 * the page could not be edited from the dashboard at all. It is kept because it
 * is a working fallback, not because it is expected to be used again.
 *
 * Both render paths exist in `apps/web/src/app/speakers/page.tsx` and produce
 * the same markup; flipping this constant is the entire change.
 *
 * ⚠️ `ROADMAP.md`'s Phase 5 bullet records the same decision in prose and is
 * not enforced by anything. It is the one remaining copy.
 */
export type SpeakersPageSource = "2026-roster" | "firestore";

export const SPEAKERS_PAGE_SOURCE: SpeakersPageSource = "firestore";
