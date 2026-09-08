import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { exhibitorSummary } from '@/lib/exhibitors';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Fair Center › Fair Manager.
 *
 * The career fair: employers post roles, attendees apply or drop a CV, and the
 * two are matched into scheduled interview slots.
 *
 * The interesting thing about this screen is how close the adjacent parts
 * already are, and how little of the distance that closes. Exhibitors exist with
 * contacts and booths, and the recruiters at KGC are mostly already exhibitors.
 * What is entirely absent is the attendee-facing half — a job posting, an
 * application, a CV, and consent to pass a person's details to a company.
 *
 * That last one is not a field, it is a position somebody has to take. An
 * application moves an attendee's name, address and CV to a third party, and the
 * attendee directory is deliberately a separate projection precisely so a hidden
 * attendee's record never leaves the server. Handing details to an employer runs
 * directly against that design and needs an explicit, recorded consent rather
 * than a checkbox somebody added — so the consent question is settled before any
 * of the rest is built, not after.
 */
export default async function FairManagerPage() {
  await requireOrganizer();

  const summary = await exhibitorSummary();

  return (
    <>
      <PageHeader
        title="Fair Manager"
        info={
          <>
            <strong>Consent comes before code</strong>
            <p>
              An application hands an attendee&rsquo;s name, address and CV to a third-party
              company. Nothing in this product has asked anybody&rsquo;s permission for that, and
              the answer is a recorded consent rather than a checkbox.
            </p>
          </>
        }
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
          { label: 'Job postings', value: '—', sub: 'not inputted yet' },
          { label: 'Applications', value: '—', sub: 'not inputted yet' },
        ]}
      />

      <Panel>
        <NotInputted
          what="job postings"
          action={
            <Link className="whova-btn-main" href="/content/exhibitor-center/exhibitor-manager">
              The companies in the hall
            </Link>
          }
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Postings, applications and interviews.</strong> None of the three is modelled.
            Postings are the cheapest — a subcollection under an exhibitor and an editor — and the
            only piece that reuses what exists.
          </li>
          <li>
            <strong>Employer accounts.</strong> Exhibitors hold a contact email and no login. A
            recruiter reviewing applications needs one, or a capability link — a pattern this
            project has built exactly once, for order confirmations.
          </li>
          <li>
            <strong>Lead capture,</strong> the commercial reason a recruiter buys a booth.{' '}
            <code>sponsors/&#123;id&#125;/leads</code> is modelled for sponsors, exhibitors have
            nothing, and no scanner writes to either.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
