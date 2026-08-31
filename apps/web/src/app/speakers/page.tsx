import type { Metadata } from 'next';
import { FEATURED_2026, REST_2026, SPEAKERS_2026 } from '@/lib/speakers-2026';
import { SpeakerCard, SpeakerGrid, ViewAllSpeakers, type SpeakerTile } from '@/components/speaker-grid';
import { listSpeakers } from '@/lib/data';
import { SPEAKERS_PAGE_SOURCE } from '@/lib/site';

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
 * `SPEAKERS_PAGE_SOURCE` in `lib/site.ts` picks between the two components
 * below, and its docblock holds the full argument. In short: it ships as
 * `'2026-roster'` because the 2027 programme has not been selected and the
 * seeded `speakers` collection holds **invented names**, which must never reach
 * a public page. `listSpeakers()` is not missing and this page is not
 * unfinished — `LiveRoster` below is written, and flipping that constant is the
 * entire change.
 *
 * ⚠️ The organizer dashboard does not know that. `pageReadiness()` in
 * `apps/organizer/src/lib/webpages.ts` counts Firestore speakers with no photo
 * or bio and reports them as problems with "your speakers page" — true only
 * once the constant reads `'firestore'`. That half is fixed in that file; the
 * two apps are separate installs and neither may import the other.
 *
 * ## Which five come first, and how that was established
 *
 * Whova's own payload names them: `design.highlight_speakers` is an array of
 * exactly five profile ids resolving to Bertails, Hendler, Ivie, Khattar and
 * Pakiman. See `lib/speakers-2026.ts`.
 */
export const dynamic = 'force-dynamic';

export default async function SpeakersPage() {
  return SPEAKERS_PAGE_SOURCE === 'firestore' ? <LiveRoster /> : <Roster2026 />;
}

/** The shipping page: the real, published KGC 2026 roster, and it says so. */
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

            <ViewAllSpeakers speakers={tiles(REST_2026)} />
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The same page driven by the `speakers` collection, for the day a real 2027
 * roster exists in Firestore.
 *
 * Flatter than `Roster2026` on purpose. The five-then-the-rest split is Whova's
 * `design.highlight_speakers`, an editorial choice made in a widget we do not
 * run; `SpeakerDoc` has no equivalent field, and inventing one by taking the
 * first five of a surname sort would promote whoever is alphabetically unlucky.
 * So this renders one grid in `listSpeakers()`'s order — surname-ish, the same
 * order the agenda and the dashboard show — behind the same "show more" the
 * 2026 page uses below its highlights.
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
  }));

  return (
    <section style={{ padding: '72px 0 96px' }}>
      <div className="wrap-kgc">
        <h1 className="speakers-head">Speakers</h1>

        {tiles.length === 0 ? (
          <p className="notice">The speaker list is not published yet.</p>
        ) : (
          <SpeakerGrid speakers={tiles} initial={24} />
        )}
      </div>
    </section>
  );
}
