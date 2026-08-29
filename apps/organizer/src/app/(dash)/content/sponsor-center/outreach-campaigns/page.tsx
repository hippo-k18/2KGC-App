import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSponsors } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Sponsor Center › Outreach Campaigns.
 *
 * Easy to mistake for Message Sponsors, which is built. The difference is the
 * recipient list: Message Sponsors emails the companies who have already signed.
 * Outreach emails the ones who have not — **prospects**, who are not in our
 * database at all.
 *
 * That is the whole feature, and it is why this one cannot simply be copied from
 * the messaging screens. Whova's version is valuable because Whova has thousands
 * of events' worth of past sponsors and exhibitors to suggest from; the tool is a
 * thin wrapper over a marketplace we do not have and cannot build. Running a
 * campaign against a list we type in ourselves is a mailing list, not a
 * marketplace — and mailing a list of strangers from the conference's sending
 * domain is how that domain's reputation gets spent.
 */
export default async function SponsorOutreachPage() {
  await requireOrganizer();

  const sponsors = await listSponsors();

  return (
    <>
      <PageHeader
        title="Outreach Campaigns"
        links={[
          <Link key="m" href={ROUTES.messageSponsors}>
            Message Sponsors
          </Link>,
          <Link key="s" href={ROUTES.sponsorManager}>
            Sponsor Manager
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Signed sponsors', value: sponsors.length, sub: 'reachable via Message Sponsors' },
          { label: 'Prospects', value: '—', sub: 'no prospect record exists' },
        ]}
      />

      <Banner kind="info">
        <strong>Message Sponsors is the built one.</strong> It emails the sponsors you already have,
        with segments for the two things worth chasing — a missing logo and an unassigned booth.
        This screen is about the ones you do not have yet.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Suggests prospective sponsors and exhibitors drawn from other events on their platform,
          lets an organizer select from that list, and sends a templated pitch with open and click
          tracking and an automatic follow-up to non-openers.
        </p>

        <h2 className="section-header">Why this is not a screen we can build</h2>
        <p className="body-2">
          The suggestions are the product. They come from Whova&rsquo;s cross-event database, which
          exists because thousands of conferences run on it — one conference has no such list and no
          way to acquire one. Strip that out and what remains is bulk email to addresses somebody
          pasted in, which is a different and much worse thing: cold mail from{' '}
          <code>knowledgegraph.tech</code> risks the sending reputation that the ticket receipts and
          Message Speakers depend on.
        </p>
        <p className="body-2">
          The honest position is that sponsorship sales at this scale is a person with a
          spreadsheet and their own mailbox, and that this is one of the screens where Whova is
          selling network effects rather than software.
        </p>

        <h2 className="section-header">If it were built anyway</h2>
        <p className="body-2">
          A prospects collection with a pipeline status, a templated send reusing the existing
          sender, and a suppression list — <strong>4–5 days</strong>, and the suppression list is
          not the optional part. Open and click tracking needs a redirect domain and a pixel, which
          is a further two days and a privacy decision.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Prospect records.</strong> <code>SponsorDoc</code> describes a signed sponsor —
            tier, logo, booth. There is no shape for a company that has not said yes.
          </li>
          <li>
            <strong>A pipeline.</strong> No status, no owner, no next-contact date, no notes.
          </li>
          <li>
            <strong>Open and click tracking.</strong> <code>emailLog</code> records sent, failed and
            skipped, and stops there deliberately.
          </li>
          <li>
            <strong>Unsubscribe handling.</strong> Required for cold mail in most of the world, and
            entirely absent.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
