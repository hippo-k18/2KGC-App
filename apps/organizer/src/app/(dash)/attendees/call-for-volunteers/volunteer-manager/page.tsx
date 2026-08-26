import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, NotBuilt, PageHeader, Panel, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Call for Volunteers › Volunteer Manager.
 *
 * There is no volunteer anywhere in this project. Not a collection, not a
 * field, not a role — `Role` in `packages/shared/src/models.ts` is the list the
 * custom claim mirrors, and a volunteer is not in it.
 *
 * So this screen has nothing to show, and it shows nothing rather than an empty
 * table with column headers. A table implies rows will arrive; the truthful
 * shape of "this entity does not exist" is a sentence.
 *
 * Worth naming what the gap actually is, because it is bigger than a CRUD
 * screen: a volunteer is someone with a *shift*, and a shift is a time, a
 * place, a required headcount and a person who did or did not turn up. That is
 * a small rostering product, not a list of names — which is why the estimate
 * below is not the two days a plain entity screen would cost.
 */
export default async function VolunteerManagerPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Volunteer Manager"
        tags={<Tag color="grey">not built</Tag>}
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="c" href="/attendees/call-for-volunteers/release-and-consent-forms">
            Release &amp; Consent Forms
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>No volunteer model exists.</strong> There is no <code>volunteers</code> collection,
        no volunteer role on <code>UserDoc.roles</code>, and no shift anywhere in the schema.
        Nothing on this screen is stored, filtered or exported, because there is nothing to store.
      </Banner>

      <Panel>
        <EmptyState icon="◌">
          <strong>Nothing to manage yet.</strong>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Volunteers today are people in the <Link href={ROUTES.attendees}>attendee list</Link>{' '}
            who someone knows to be helping. That knowledge lives in a spreadsheet or a head, and
            this dashboard has no view of it.
          </div>
        </EmptyState>
      </Panel>

      <Panel>
        <h2 className="section-header">What building it would involve</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>A volunteer is an attendee with a shift, not a separate person.</strong> Modelling
            them as their own collection duplicates the name, the email and the check-in; the
            cheaper shape is a <code>shifts</code> collection referencing{' '}
            <code>registrationId</code>, so a volunteer badge, a volunteer check-in and a volunteer
            message all reuse what already works.
          </li>
          <li>
            <strong>Roster arithmetic is the real feature.</strong> Required headcount per shift
            against confirmed, clashes against the agenda, and a view by person and by slot. The
            conflict-detection code in <code>lib/conflicts-core.ts</code> is the nearest thing here
            and it is about sessions, not people.
          </li>
          <li>
            <strong>Recruitment needs a public form.</strong> A call for volunteers is a submission
            portal, which is the same missing capability that blocks Call for Speakers and
            registration Question Forms. Building any one of the three is most of the work for all
            three.
          </li>
        </ul>
      </Panel>

      <NotBuilt
        whova="A call-for-volunteers form, a volunteer list with roles and shifts, and bulk messaging to volunteers."
        needs="A shifts collection keyed to registrations, a public submission form, and roster views. The submission form is shared with Call for Speakers and Question Forms."
        size="5–7 days, of which the generic submission form is roughly half"
        refs="ROADMAP.md — the five missing capabilities that each block a cluster of screens"
      />

      <Panel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Everything on this screen.</strong> No volunteer is stored, listed, assigned or
            contacted from here.
          </li>
          <li>
            <strong>Volunteer check-in.</strong> The door scanner checks in whoever holds a ticket;
            it has no concept of arriving for a shift.
          </li>
          <li>
            <strong>Consent and release forms.</strong> A separate gap with its own screen — see{' '}
            <Link href="/attendees/release-and-consent-forms">Release &amp; Consent Forms</Link>.
          </li>
        </ul>
      </Panel>
    </>
  );
}
