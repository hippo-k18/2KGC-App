import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { exhibitorSummary } from '@/lib/exhibitors';
import { GapPanel, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Exhibitor Center › Outreach Campaigns.
 *
 * The exhibitor twin of the sponsor screen, and the same argument applies with
 * one extra edge: Whova's suggested exhibitor list is drawn from companies that
 * have exhibited at *other* events on their platform, which is the closest thing
 * they sell to a trade-show directory. A single conference has no directory and
 * no way to build one.
 *
 * Worth being blunt about the value here rather than sizing it politely. KGC's
 * hall is mostly recruiters, university groups and a handful of vendors, all of
 * whom are already known to the organizers by name. A prospecting tool for a
 * list of twelve companies is not a tool.
 */
export default async function ExhibitorOutreachPage() {
  await requireOrganizer();

  const summary = await exhibitorSummary();

  return (
    <>
      <PageHeader
        title="Outreach Campaigns"
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
          { label: 'Exhibitors signed', value: summary.confirmed, sub: `${summary.provisional} provisional` },
          { label: 'Prospects', value: '—', sub: 'no prospect record exists' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Suggests companies that have exhibited at comparable events elsewhere on their platform,
          and sends them a templated invitation to book a booth, with follow-ups to anyone who does
          not open it.
        </p>

        <h2 className="section-header">Why this one is worth cutting rather than building</h2>
        <p className="body-2">
          The suggestion list is the whole product and it is a network effect: it works because
          thousands of events share the platform. We have one event, so the list would be typed in
          by hand — and a hand-typed list of a dozen companies is better worked from a mailbox than
          from a dashboard.
        </p>
        <p className="body-2">
          Building it anyway costs about the same as the sponsor version —{' '}
          <strong>4–5 days</strong> for prospect records, a pipeline status, a templated send over
          the existing sender, and a suppression list. The suppression list is mandatory rather than
          optional, because this is cold mail and the sending domain is the same one that carries
          ticket receipts.
        </p>
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
          <li>
            <strong>Messaging the exhibitors we do have.</strong> Also unbuilt, but only just — see
            Message Exhibitors, which is about a day&rsquo;s work.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
