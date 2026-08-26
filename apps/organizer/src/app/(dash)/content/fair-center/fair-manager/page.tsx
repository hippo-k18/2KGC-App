import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { exhibitorSummary } from '@/lib/exhibitors';
import { PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Fair Center › Fair Manager.
 *
 * Whova's career fair: employers post roles, attendees apply or drop a CV, and
 * the two are matched into scheduled interview slots. Whova's internal key for
 * it is still `career_fair_manager`, which is the clearer name.
 *
 * The interesting thing about this screen is how close the adjacent parts
 * already are, and how little of the distance that closes. Exhibitors exist with
 * contacts and booths; the recruiters at KGC are mostly already exhibitors. What
 * is entirely absent is the attendee-facing half — a job posting, an application,
 * a CV, and consent to pass a person's details to a company. That last one is
 * not a field, it is a legal position somebody has to take.
 */
export default async function FairManagerPage() {
  await requireOrganizer();

  const summary = await exhibitorSummary();

  return (
    <>
      <PageHeader
        title="Fair Manager"
        links={[
          <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
          <Link key="m" href="/engagement/1-1-meeting-scheduler">
            1-1 Meeting Scheduler
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Exhibitors', value: summary.confirmed, sub: 'some of whom recruit' },
          { label: 'Job postings', value: '—', sub: 'no collection exists' },
          { label: 'Applications', value: '—', sub: 'no collection exists' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Employers publish roles against their booth, attendees browse and apply from the app,
          recruiters review applications and book interview slots, and the organizer sees the volume
          across the whole fair. It is a small job board with a scheduler bolted to it.
        </p>

        <h2 className="section-header">What this would need</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Job postings</strong> attached to an exhibitor — the cheapest piece, a
            subcollection and an editor, and the only one that reuses what exists.
          </li>
          <li>
            <strong>An employer-facing surface.</strong> Exhibitors hold a contact email and no
            account. A recruiter reviewing applications needs a login or a capability link, and this
            project has built that pattern exactly once, for order confirmations.
          </li>
          <li>
            <strong>Applications, and the consent around them.</strong> An application moves an
            attendee&rsquo;s name, address and CV to a third-party company. The attendee directory
            is deliberately a separate projection precisely so a hidden attendee&rsquo;s record
            never leaves the server — handing details to an employer runs directly against that
            design and needs an explicit, recorded consent rather than a checkbox somebody added.
          </li>
          <li>
            <strong>CV upload,</strong> which no screen in this project can do.
          </li>
          <li>
            <strong>Interview scheduling,</strong> which is the 1-1 Meeting Scheduler — also
            unbuilt.
          </li>
        </ul>

        <p className="body-2">
          <strong>8–12 days</strong>, and the consent question is the part to settle before any of
          it. For a research conference whose recruiting is a handful of university groups and two
          vendors, a table of contacts in the exhibitor record does most of the work.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Postings, applications and interviews.</strong> None of the three is modelled.
          </li>
          <li>
            <strong>Employer accounts.</strong> Exhibitors have no login.
          </li>
          <li>
            <strong>Lead capture,</strong> the commercial reason a recruiter buys a booth.{' '}
            <code>sponsors/&#123;id&#125;/leads</code> is modelled for sponsors, exhibitors have
            nothing, and no scanner writes to either.
          </li>
        </ul>
      </Panel>
    </>
  );
}
