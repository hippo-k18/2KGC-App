import type { Metadata } from 'next';
import { FEATURED_2026, REST_2026, SPEAKERS_2026 } from '@/lib/speakers-2026';
import { SpeakerCard, ViewAllSpeakers } from '@/components/speaker-grid';

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
 * ## Why 2026 people are shown on a 2027 site
 *
 * The 2027 programme has not been selected, and the seeded `speakers`
 * collection holds invented names — right for testing the app, wrong for a
 * public page. These are the real KGC 2026 roster, and the page says so.
 *
 * ## Which five come first, and how that was established
 *
 * Whova's own payload names them: `design.highlight_speakers` is an array of
 * exactly five profile ids resolving to Bertails, Hendler, Ivie, Khattar and
 * Pakiman. See `lib/speakers-2026.ts`.
 */
export const dynamic = 'force-dynamic';

export default function SpeakersPage() {
  const tiles = (list: typeof FEATURED_2026) =>
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
