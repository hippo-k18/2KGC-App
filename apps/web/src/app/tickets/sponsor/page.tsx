import type { Metadata } from 'next';
import { SITE } from '@/lib/site';
import { AudienceTicketsPage } from '../audience-page';

export const metadata: Metadata = {
  title: 'Sponsor KGC 2027',
  description:
    'Sponsorship packages for the Knowledge Graph Conference 2027 at Cornell Tech, Roosevelt Island.',
};

export const dynamic = 'force-dynamic';

/**
 * `/tickets/sponsor` — the sponsor half of the registration flow.
 *
 * Note that `/sponsor` already exists and is a *prospectus*: what sponsorship
 * is, who comes, why it is worth it. This page is the checkout at the end of
 * that conversation, and the two link to each other rather than one replacing
 * the other. Merging them would put a card form under a pitch, which is the
 * wrong shape for a purchase somebody's marketing director has to approve.
 */
export default async function SponsorTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  return (
    <AudienceTicketsPage
      searchParams={searchParams}
      copy={{
        audience: 'sponsor',
        noun: 'sponsor',
        heading: `Sponsor ${SITE.shortName} ${SITE.year}`,
        lede: (
          <>
            {SITE.datesLong} at {SITE.venue}. KGC is the room where the knowledge-graph field talks
            to itself — a few hundred people who build this for a living, rather than a few thousand
            collecting tote bags.
          </>
        ),
        points: [
          {
            title: 'Your name where the week happens',
            body: 'Tier decides placement: the app, the stage, the badge lanyards, the reception. Every tier is visible to every attendee for five days.',
          },
          {
            title: 'Sessions, not just signage',
            body: 'The upper tiers include a sponsored session on the programme, listed in the agenda like any other — because a talk people choose to attend outperforms a banner people walk past.',
          },
          {
            title: 'Conference passes for your team',
            body: 'Included with every tier, and they are full tickets: workshops, sessions, recordings.',
          },
          {
            title: 'The attendee list, properly',
            body: 'Aggregate demographics and the contacts who opt in through the app. Not a scraped list — a consented one, which is the only kind worth having.',
          },
        ],
        emptyHint: (
          <>
            <strong>Sponsorship tiers have not been published yet.</strong> The prospectus at{' '}
            <a href="/sponsor">/sponsor</a> describes what is on offer while pricing is finalised.
          </>
        ),
      }}
    />
  );
}
