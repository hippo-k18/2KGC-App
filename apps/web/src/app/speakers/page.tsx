import type { Metadata } from 'next';
import { FEATURED_2026, REST_2026 } from '@kgc/scripts/src/lib/speakers-2026';
import { ViewAllSpeakers, type SpeakerTile } from '@/components/speaker-grid';
import { redirect } from 'next/navigation';
import { ConfirmedSpeakers, type ConfirmedSpeakerTile } from '@/components/confirmed-speakers';
import { listConfirmedSpeakers, shownCall, siteVisibility } from '@/lib/data';
import { SPEAKERS_PAGE_SOURCE } from '@kgc/shared';

export const metadata: Metadata = {
  title: 'Speakers',
  description:
    'The confirmed speakers at the Knowledge Graph Conference, with their bios and the talks they give.',
};

/**
 * A close copy of the live /2026-speakers page.
 *
 * That page is not really a page: its whole body is one embedded Whova speaker
 * widget, which is why these speakers do not appear in search results and
 * cannot be linked to. It renders a single heading, five highlighted people as
 * three cards then two, and a "View All Speakers" button. Everything here is
 * measured from inside that iframe on 2026-08-19 — the 371x350 `#f6f6f6` card
 * at an 8px radius, the 150px circular portrait, 24/700 name over 14/400
 * company over 16/400 role, and the `#2dacee` button.
 *
 * Two deliberate departures, both because the widget is the thing this project
 * replaces. The heading is set in Open Sans rather than the widget's Raleway,
 * which appears nowhere else on knowledgegraph.tech. And the other 132 are
 * revealed on this page rather than behind a navigation to `?view_all=true`,
 * because here they are server-rendered and indexable.
 *
 * ══ WHICH ROSTER THIS PAGE SHOWS IS A ONE-LINE DECISION ══════════════════════
 *
 * `SPEAKERS_PAGE_SOURCE` in `@kgc/shared` picks between the two components
 * below, and its docblock holds the full argument.
 *
 * It reads `'firestore'`, so `LiveRoster` is what ships and this page renders
 * the `speakers` collection — which is what makes it editable in Speaker
 * Manager, the entire reason the roster was moved out of the bundle.
 *
 * Since T304 it publishes confirmed speakers only: listed in Speaker Manager
 * and named on a published session. A seeded or imported person who is on no
 * published session no longer appears.
 *
 * `Roster2026` below is the fallback, not dead code: flipping the constant back
 * renders the published 2026 roster from `@kgc/scripts/src/lib/speakers-2026`.
 *
 * ⚠️ Two claims that used to live here were wrong and are recorded so they are
 * not rediscovered as new findings. The first said the seeded names "must never
 * reach a public page" — the owner has since decided otherwise, and the
 * decision is written down in `packages/shared/src/speakers-page.ts`. The
 * second said the dashboard needs its own copy of the constant because "the two
 * apps are separate installs and neither may import the other": both depend on
 * `@kgc/shared`, there is now exactly one declaration, and `pageReadiness()`
 * imports it.
 *
 * ## Which five come first, and how that was established
 *
 * Whova's own payload names them: `design.highlight_speakers` is an array of
 * exactly five profile ids resolving to Bertails, Hendler, Ivie, Khattar and
 * Pakiman. See `@kgc/scripts/src/lib/speakers-2026.ts`.
 */
/**
 * Rendered once and reused for up to a minute, rather than from scratch on
 * every visit. The roster changes when an organizer edits it, not per visitor.
 *
 * Every page on this site was `force-dynamic`, so nothing was ever cached by
 * anybody: the agenda took 0.81 to 0.95 seconds to first byte on the live site
 * against 0.06 for a page that read nothing. No visitor now pays for a query
 * another visitor has already made.
 *
 * Thirty seconds and not sixty, because this window sits on top of the one in
 * `shared()` and the two add up. See `SHARED_SECONDS` in `lib/data.ts`: thirty
 * over thirty is a change on the site inside a minute, which is what an
 * organizer who saves and switches tab is waiting for.
 */
export const revalidate = 30;

export default async function SpeakersPage() {
  // Hidden: hundreds of old WordPress addresses redirect here, so a hidden page sends
  // them on to the past editions (a temporary 307) rather than a 404.
  if (!(await siteVisibility()).speakers) redirect('/previous-events');
  return SPEAKERS_PAGE_SOURCE === 'firestore' ? <LiveRoster /> : <Roster2026 />;
}

/**
 * The published KGC 2026 roster, rendered from the bundle.
 *
 * Not shipping today — `SPEAKERS_PAGE_SOURCE` reads `'firestore'` — and kept
 * because flipping the constant back is a working fallback.
 *
 * ⚠️ If it is ever shipped again, it needs a disclosure it has never had. This
 * docblock used to end "and it says so", and `ROADMAP.md` said the same; the
 * only heading is "Our First Speakers" and no year appears anywhere in the
 * markup. The claim was written as though the disclosure had been built, and
 * nothing ever built it. That matters more for this component than for
 * `LiveRoster`: these are real people who spoke at a different conference in a
 * different year.
 */
function Roster2026() {
  const tiles = (list: typeof FEATURED_2026): SpeakerTile[] =>
    list.map((s, i) => ({
      // Whova gives no stable public id, so the name is the key. The index
      // disambiguates the two people who share one.
      id: `${s.name}-${i}`,
      name: s.name,
      company: s.company,
      role: s.role,
      photoURL: s.photo,
      width: s.width,
      height: s.height,
    }));

  return (
    <section style={{ padding: '72px 0 96px' }}>
      <div className="wrap-kgc">
        <ViewAllSpeakers featured={tiles(FEATURED_2026)} speakers={tiles(REST_2026)} />
      </div>
    </section>
  );
}

/**
 * The same page, driven by the `speakers` collection: the confirmed speakers
 * only, each with a bio and the talks they give (T304).
 *
 * "Confirmed" is `confirmSpeakers()` in `lib/confirmed-speakers.ts`: listed in
 * Speaker Manager and named on at least one published session. Featured
 * speakers come first. With nobody confirmed yet the page says speakers will
 * be announced soon and points at the call for speakers, rather than showing
 * an empty grid.
 *
 * `ViewAllSpeakers` and its "View All" button stay with `Roster2026`: they
 * page through a 137-person roster, and hide most of it from the HTML until
 * asked. This list is everyone, server-rendered, so every bio and abstract is
 * indexable.
 *
 * Both reads go through `safely()`, so an unreachable database renders the
 * empty state rather than a 500.
 */
async function LiveRoster() {
  const [speakers, call] = await Promise.all([listConfirmedSpeakers(), shownCall()]);

  const tiles: ConfirmedSpeakerTile[] = speakers.map((s) => ({
    id: s.id,
    name: s.name,
    company: s.company,
    // `title` is the person's job title; the card calls that slot `role`.
    role: s.title,
    photoURL: s.photoURL,
    width: s.photoWidth,
    height: s.photoHeight,
    bio: s.bio,
    featured: s.featured,
    talks: s.talks,
  }));

  return (
    <section style={{ padding: '72px 0 96px' }}>
      <div className="wrap-kgc">
        {/* The call shown on the website when there is one, else the speaking section of /sponsor. */}
        <ConfirmedSpeakers speakers={tiles} applyHref={call ? `/submit/${call.id}` : '/sponsor#speak'} />
      </div>
    </section>
  );
}
