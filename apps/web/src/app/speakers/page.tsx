import type { Metadata } from 'next';
import Link from 'next/link';
import { listSpeakers } from '@/lib/data';
import { SpeakerGrid } from '@/components/speaker-grid';

export const metadata: Metadata = {
  title: 'Speakers',
  description:
    'The people speaking at the Knowledge Graph Conference 2027, from the conference database.',
};

/**
 * The speaker list, rendered from the `speakers` collection.
 *
 * The incumbent site embeds this from Whova in an iframe, which is why it does
 * not appear in search results and cannot be linked to. Here it is server
 * rendered from our own data: the same documents the mobile app reads, so a
 * correction in the organizer console shows up in both places at once.
 */
export const dynamic = 'force-dynamic';

export default async function SpeakersPage() {
  const speakers = await listSpeakers();

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
        <p className="eyebrow">2027 programme</p>
        <h1>Speakers</h1>
        <p className="lede">
          {speakers.length} confirmed so far, listed by surname, and growing as the programme
          committee works through the submissions. Sessions for each speaker are on the{' '}
          <Link href="/agenda">agenda</Link>.
        </p>

        {speakers.length === 0 ? (
          <p className="notice">
            The speaker list is not published yet. Check back shortly — or{' '}
            <Link href="/tickets">register</Link> and we will mail you when it goes live.
          </p>
        ) : (
          <SpeakerGrid
            speakers={speakers.map((s) => ({
              id: s.id,
              name: s.name,
              company: s.company,
              role: s.title,
              photoURL: s.photoURL,
            }))}
          />
        )}
      </div>
    </section>
  );
}
