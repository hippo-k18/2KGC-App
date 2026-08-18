import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { SPEAKERS_2026 } from '@/lib/speakers-2026';
import { SpeakerGrid } from '@/components/speaker-grid';

export const metadata: Metadata = {
  title: 'Speakers',
  description:
    'The people speaking at the Knowledge Graph Conference 2027, from the conference database.',
};

/**
 * The speaker list.
 *
 * ## Why this shows 2026 people on a 2027 site, and says so
 *
 * The 2027 programme has not been selected — the seeded `speakers` collection
 * holds invented names, which is the right thing for testing the app and the
 * wrong thing for a public page. So this renders the **real KGC 2026 roster**,
 * scraped from the live site, and the copy states plainly which year these
 * people spoke in. Showing 137 real practitioners under an accurate label is
 * worth more than 45 invented ones under a flattering one, and quietly
 * presenting last year's line-up as this year's would be the exact defect this
 * repository keeps finding in itself.
 *
 * ## The joke in the provenance
 *
 * The incumbent site's speaker page is not a page. It is an embedded **Whova**
 * widget, which is why those speakers do not appear in search results and cannot
 * be linked to — and Whova is the product this whole project replaces. Here the
 * same people are server-rendered, indexable and linkable. See
 * `lib/speakers-2026.ts` for how the data was actually obtained.
 */
export const dynamic = 'force-dynamic';

export default async function SpeakersPage() {
  const speakers = SPEAKERS_2026;

  return (
    <section>
      {/*
        Centred, matching the live speakers page — and matching the cards below,
        which are themselves centred. A left-aligned heading over a centred grid
        was the "framing" that read as wrong: at a desktop width the heading and
        its lede sat in the left two-thirds with a large empty right side, above
        a grid that was balanced.
      */}
      <div className="wrap page-head-centred">
        <p className="eyebrow">KGC 2026</p>
        <h1>Speakers</h1>
        <p className="lede">
          The {speakers.length} people who spoke at KGC 2026, listed by surname. The {SITE.year}{' '}
          programme is still with the committee — when it is settled it appears here and on the{' '}
          <Link href="/agenda">agenda</Link>.
        </p>

        {speakers.length === 0 ? (
          <p className="notice">
            The speaker list is not published yet. Check back shortly — or{' '}
            <Link href="/tickets">register</Link> and we will mail you when it goes live.
          </p>
        ) : (
          <SpeakerGrid
            speakers={speakers.map((s, i) => ({
              // Whova gives no stable public id, so the name is the key. The
              // index disambiguates the two people who share one.
              id: `${s.name}-${i}`,
              name: s.name,
              company: s.company,
              role: s.role,
              photoURL: s.photo,
              width: s.width,
              height: s.height,
            }))}
          />
        )}
      </div>
    </section>
  );
}
