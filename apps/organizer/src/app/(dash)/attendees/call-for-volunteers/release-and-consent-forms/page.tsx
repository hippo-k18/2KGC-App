import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, NotBuilt, PageHeader, Panel, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Call for Volunteers › Release & Consent Forms.
 *
 * Whova nests a second copy of the consent screen under volunteers, and the
 * duplication is not accidental: a volunteer signs a different document from an
 * attendee. An attendee agrees to be photographed; a volunteer agrees to
 * handle a radio, stand on a ladder, or be listed as a responsible adult, and
 * an organizer needs to know *before* the shift starts whether that signature
 * exists.
 *
 * Both are missing here, and this one is missing twice over — there is no
 * consent store and no volunteer to attach one to. Saying so on both screens is
 * deliberate: an organizer who lands here from the volunteer tree should not
 * have to visit the attendee screen to learn that nothing is recorded.
 */
export default async function VolunteerConsentFormsPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Release & Consent Forms"
        tags={<Tag color="grey">not built</Tag>}
        links={[
          <Link key="v" href="/attendees/call-for-volunteers/volunteer-manager">
            Volunteer Manager
          </Link>,
          <Link key="a" href="/attendees/release-and-consent-forms">
            Attendee forms
          </Link>,
          <Link key="l" href={ROUTES.attendees}>
            Attendees
          </Link>,
        ]}
      />

      <Banner kind="danger">
        <strong>Two things are absent, not one.</strong> No consent of any kind is stored in this
        project, and no volunteer exists to attach one to — there is no{' '}
        <code>volunteers</code> collection and no volunteer role. Nothing here tracks who has signed
        what, and no shift is or could be gated on a signature.
      </Banner>

      <Panel>
        <EmptyState icon="◌">
          <strong>No volunteers, no forms, no signatures.</strong>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            <Link href="/attendees/call-for-volunteers/volunteer-manager">Volunteer Manager</Link>{' '}
            explains the missing roster model;{' '}
            <Link href="/attendees/release-and-consent-forms">Release &amp; Consent Forms</Link>{' '}
            explains the missing consent record. This screen is the intersection of the two.
          </div>
        </EmptyState>
      </Panel>

      <Panel>
        <h2 className="section-header">Why a volunteer form is the harder of the two</h2>
        <p className="body-2">
          An attendee release is one document signed once. A volunteer pack is several — a liability
          waiver, a code of conduct, sometimes a background check or a proof of age — each with its
          own expiry and its own consequence for being missing. That makes the useful unit
          &ldquo;which requirements does this shift have, and which does this person satisfy
          today&rdquo;, which is a small compliance matrix rather than a signed/unsigned column.
        </p>
        <p className="body-2">
          It also has a hard edge the attendee version does not: a volunteer without a signed waiver
          should not be rostered, so the check belongs in the assignment path rather than in a
          report somebody reads afterwards. Building the register without that gate produces a
          screen that is accurate and useless.
        </p>
      </Panel>

      <NotBuilt
        whova="Release and consent forms attached to the volunteer call, with per-volunteer signed status and reminders before the event."
        needs="A volunteer and shift model, a submission-and-response store, and an append-only consent record versioned against the wording agreed."
        size="Both gaps together, roughly 8–10 days; neither is useful without the other"
        refs="ROADMAP.md — the submission-form capability shared with Call for Speakers and Question Forms"
      />

      <Panel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Everything on this screen.</strong> No form is published, no signature is
            stored, and no volunteer record exists to hold one.
          </li>
          <li>
            <strong>Blocking a shift on a missing waiver.</strong> There are no shifts.
          </li>
          <li>
            <strong>Expiry and renewal.</strong> Requires a consent record with a date on it, which
            is the first missing piece above.
          </li>
        </ul>
      </Panel>
    </>
  );
}
