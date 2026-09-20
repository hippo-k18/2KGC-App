import type { Metadata } from 'next';
import Link from 'next/link';
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
            {SITE.datesLong} at {SITE.venue}. A few hundred people who build knowledge graphs for a
            living, in one place for five days.
          </>
        ),
        points: [
          {
            title: 'Brand placement',
            body: 'Placement depends on tier: the app, the stage, the badge lanyards, the reception. Every tier is shown to every attendee for all five days.',
          },
          {
            title: 'A sponsored session',
            body: 'The upper tiers include a session on the programme, listed in the agenda.',
          },
          {
            title: 'Conference passes for your team',
            body: 'Included with every tier. Full tickets: workshops, sessions, recordings.',
          },
          {
            title: 'Attendee data',
            body: 'Aggregate demographics, plus the contacts who opt in through the app.',
          },
        ],
        emptyHint: (
          <>
            <strong>Sponsorship tiers have not been published yet.</strong> The prospectus at{' '}
            <Link href="/sponsor">/sponsor</Link> describes what is on offer while pricing is finalised.
          </>
        ),
      }}
    />
  );
}
