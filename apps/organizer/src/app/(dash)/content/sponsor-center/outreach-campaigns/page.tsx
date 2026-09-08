import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSponsors } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles } from '../../../ui';

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
 * the messaging screens. `SponsorDoc` describes a signed sponsor — tier, logo,
 * booth — and there is no shape for a company that has not said yes, no pipeline
 * status, no owner, no next-contact date.
 *
 * Nor is the missing shape the expensive part. Running a campaign against a list
 * somebody typed in is bulk cold mail from `knowledgegraph.tech`, and that is the
 * same sending domain the ticket receipts and Message Speakers depend on. A
 * suppression list is mandatory rather than optional for that, and open and click
 * tracking needs a redirect domain and a pixel, which is a privacy decision as
 * well as a build. Sponsorship sales at this scale is a person with a spreadsheet
 * and their own mailbox.
 */
export default async function SponsorOutreachPage() {
  await requireOrganizer();

  const sponsors = await listSponsors();

  return (
    <>
      <PageHeader
        title="Outreach Campaigns"
        info={
          <>
            <strong>Prospects are not modelled</strong>
            <p>
              <code>SponsorDoc</code> describes a company that has already signed. Mailing the ones
              that have not is cold mail from the domain that carries the ticket receipts, which
              needs a suppression list before it needs a screen.
            </p>
          </>
        }
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
          {
            label: 'Signed sponsors',
            value: sponsors.length,
            sub: 'reachable via Message Sponsors',
          },
          { label: 'Prospects', value: '—', sub: 'not inputted yet' },
        ]}
      />

      <Panel>
        <NotInputted
          what="prospects"
          action={
            <Link className="whova-btn-main" href={ROUTES.messageSponsors}>
              Message the sponsors you have
            </Link>
          }
        />
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
