import type { Metadata } from 'next';
import { SITE } from '@/lib/site';
import { AudienceTicketsPage } from '../audience-page';

export const metadata: Metadata = {
  title: 'Exhibit at KGC 2027',
  description:
    'Booth packages for the Knowledge Graph Conference 2027 at Bryant Park, New York.',
};

/** Per-request, and it has to be. Prices, for the reason `tickets/page.tsx` gives. */
export const dynamic = 'force-dynamic';

/** `/tickets/exhibitor` — the exhibitor half of the registration flow. */
export default async function ExhibitorTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  return (
    <AudienceTicketsPage
      searchParams={searchParams}
      copy={{
        audience: 'exhibitor',
        noun: 'exhibitor',
        heading: `Exhibit at ${SITE.shortName} ${SITE.year}`,
        /*
          No dates or venue in the lede. `AudienceTicketsPage` prints them on
          their own line directly above this paragraph, so putting them here too
          gives the page "3–7 May 2027" twice in three lines. The round-one
          review asked for one such line; it is that one.
        */
        lede: (
          <>
            The people walking your booth are the ones deciding what their
            organisation&rsquo;s graph runs on next year: practitioners and the architects who sign
            for them.
          </>
        ),
        points: [
          {
            title: 'A staffed booth for the whole week',
            body: 'In the exhibition hall, where the coffee is served.',
          },
          {
            title: 'Badges for your team',
            body: 'Full conference passes for booth staff, as ordinary attendee tickets. Your people can sit in sessions.',
          },
          {
            title: 'Lead capture through the app',
            body: 'Scan an attendee badge from the KGC app and the contact lands in your exhibitor portal. No rented scanner, no per-lead fee.',
          },
          {
            /*
             * ⚠️ This bullet used to promise "your profile, materials and booth
             * number in the app every attendee already has open". Nothing read
             * `exhibitors` or `booths` on any public surface when that was
             * written, and the app still does not — audit E flags it as one of
             * the fourteen capability claims this project makes and cannot
             * keep, and it was on a page that takes money.
             *
             * It now describes `/exhibitors`, which exists and is Firestore-
             * driven, and it names nothing else. "Materials" is gone because
             * `ExhibitorDoc` has no field for one and no upload path exists;
             * the app is not mentioned because the app half of this is not
             * built. Add it back the day `app/src` reads the collection.
             */
            title: 'A listing attendees can find',
            body: 'Your logo, description, website and booth number on the public exhibitor listing.',
          },
        ],
        emptyHint: (
          <>
            <strong>Exhibitor packages have not been published yet.</strong> Pricing for KGC 2027 is
            still being set.
          </>
        ),
      }}
    />
  );
}
