import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { exhibitorSummary } from '@/lib/exhibitors';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Exhibitor Center › Outreach Campaigns.
 *
 * Prospecting: mailing companies that have *not* booked a booth. The exhibitor
 * twin of the sponsor screen, and the same argument applies — `ExhibitorDoc`
 * describes a company that has already signed, so there is no record shape for
 * a prospect and no directory to draw one from.
 *
 * Worth being blunt about the value rather than sizing it politely. KGC's hall
 * is mostly recruiters, university groups and a handful of vendors, all of whom
 * are already known to the organizers by name. A prospecting tool for a list of
 * twelve companies is not a tool, and cold mail from the domain that carries the
 * ticket receipts is a sending reputation spent on it.
 *
 * Mailing the exhibitors who *have* signed is built — Message Exhibitors.
 */
export default async function ExhibitorOutreachPage() {
  await requireOrganizer();

  const summary = await exhibitorSummary();

  return (
    <>
      <PageHeader
        title="Outreach Campaigns"
        info={
          <>
            <strong>Prospects are not modelled</strong>
            <p>
              <code>ExhibitorDoc</code> describes a company that has already booked. There is no
              record for one that has not, and cold mail would go out from the domain that carries
              the ticket receipts.
            </p>
          </>
        }
        links={[
          <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
          <Link key="m" href="/content/exhibitor-center/message-exhibitors">
            Message Exhibitors
          </Link>,
          <Link key="s" href="/content/sponsor-center/outreach-campaigns">
            Sponsor Outreach
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          {
            label: 'Exhibitors signed',
            value: summary.confirmed,
            sub: `${summary.provisional} provisional`,
          },
          { label: 'Prospects', value: '—', sub: 'not inputted yet' },
        ]}
      />

      <Panel>
        <NotInputted
          what="prospects"
          action={
            <Link className="whova-btn-main" href="/content/exhibitor-center/message-exhibitors">
              Message the exhibitors you have
            </Link>
          }
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Prospect records.</strong> <code>ExhibitorDoc</code> describes a company that
            has already booked — booth, passes, status. There is no shape for one that has not.
          </li>
          <li>
            <strong>A directory to prospect from.</strong> Structurally unavailable to a single
            conference.
          </li>
          <li>
            <strong>Tracking and unsubscribes.</strong> Neither exists; <code>emailLog</code>{' '}
            records delivery outcomes only.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
