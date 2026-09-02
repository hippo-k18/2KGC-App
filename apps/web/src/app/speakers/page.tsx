import type { Metadata } from 'next';
import { FEATURED_2026, REST_2026, SPEAKERS_2026 } from '@kgc/scripts/src/lib/speakers-2026';
import { SpeakerCard, SpeakerGrid, ViewAllSpeakers, type SpeakerTile } from '@/components/speaker-grid';
import { listSpeakers } from '@/lib/data';
import { SPEAKERS_PAGE_SOURCE } from '@kgc/shared';

export const metadata: Metadata = {
  title: 'Speakers',
  description:
    'The speakers at the Knowledge Graph Conference, led by the five highlighted on the conference’s own speaker page.',
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
 * ⚠️ **The people it currently publishes are invented.** The collection holds
 * what `npm run seed` wrote: plausible names, plausible employers, invented.
 * That was chosen knowingly over publishing the real KGC 2026 roster on a site
 * that markets 2027 — an obvious placeholder beats a confident falsehood — but
 * it is a placeholder and it is public. Replace it before the site is
 * announced; `npm run import:whova` and `npm run import:speakers-2026` both
 * overwrite the collection.
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
export const dynamic = 'force-dynamic';

export default async function SpeakersPage() {
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
        <h1 className="speakers-head">Our First Speakers</h1>

        {SPEAKERS_2026.length === 0 ? (
          <p className="notice">The speaker list is not published yet.</p>
        ) : (
          <>
            {/* Three across, then the remaining two centred beneath them. */}
            <div className="featured-speakers">
              {tiles(FEATURED_2026).map((s) => (
                <SpeakerCard key={s.id} eager speaker={s} />
              ))}
            </div>

            <ViewAllSpeakers speakers={tiles(REST_2026)} featuredCount={FEATURED_2026.length} />
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The same page, driven by the `speakers` collection.
 *
 * ── It renders the same markup as `Roster2026`, and that is the requirement ──
 *
 * This function used to be deliberately flatter: one surname-sorted grid under
 * an "Speakers" heading, with no highlighted five. The reason was real —
 * `design.highlight_speakers` was an editorial choice made inside a Whova
 * widget, `SpeakerDoc` had no field for it, and picking the first five of a
 * surname sort would have promoted whoever was alphabetically lucky.
 *
 * So the field was added rather than the difference tolerated. `featured` and
 * `displayOrder` are now on the document, `import-speakers-2026.ts` carries
 * both across from the published roster, and an organizer changes either one in
 * Speaker Manager. The heading, the three-then-two block and the "show more"
 * are identical to `Roster2026` above, because the point of moving the roster
 * into the database was to change who can edit the page, not what it looks
 * like.
 *
 * Two behaviours differ, and both only when the data does:
 *
 *   • **No featured speakers** — the five-card block is skipped entirely and
 *     everyone appears in the grid. An organizer who clears every highlight
 *     gets a plain roster, not five arbitrary people.
 *   • **A speaker with no portrait** renders the initials circle `SpeakerCard`
 *     has always had. The roster had a photo for all 137; a person added in the
 *     dashboard may not, and that is not an error state.
 *
 * `listSpeakers()` goes through `safely()`, so an unreachable database renders
 * the same empty state as an unpublished roster rather than a 500.
 */
async function LiveRoster() {
  const speakers = await listSpeakers();

  const tiles: SpeakerTile[] = speakers.map((s) => ({
    id: s.id,
    name: s.name,
    company: s.company,
    // `title` is the person's job title; the card calls that slot `role`.
    role: s.title,
    photoURL: s.photoURL,
    width: s.photoWidth,
    height: s.photoHeight,
  }));

  const featured = tiles.filter((_, i) => speakers[i].featured);
  const rest = tiles.filter((_, i) => !speakers[i].featured);

  return (
    <section style={{ padding: '72px 0 96px' }}>
      <div className="wrap-kgc">
        <h1 className="speakers-head">Our First Speakers</h1>

        {tiles.length === 0 ? (
          <p className="notice">The speaker list is not published yet.</p>
        ) : (
          <>
            {featured.length > 0 ? (
              /* Three across, then the remaining two centred beneath them. */
              <div className="featured-speakers">
                {featured.map((s) => (
                  <SpeakerCard key={s.id} eager speaker={s} />
                ))}
              </div>
            ) : null}

            <ViewAllSpeakers speakers={rest} featuredCount={featured.length} />
          </>
        )}
      </div>
    </section>
  );
}
