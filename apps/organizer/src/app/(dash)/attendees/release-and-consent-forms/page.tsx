import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, NotBuilt, PageHeader, Panel, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Release & Consent Forms.
 *
 * Photo and video release, recording consent, a code of conduct acknowledgement
 * — a form an attendee signs, and a record that they did.
 *
 * Nothing here stores a consent. That absence is worth stating loudly rather
 * than softening, because consent is the one record where a half-built system
 * is actively dangerous: an organizer who believes releases are being collected
 * publishes photographs on that belief. A screen that looks like a consent
 * register and is not would be the worst version of the defect class AGENTS.md
 * names as this codebase's recurring one.
 *
 * The nearest real thing in the project is `UserDoc.visibleInDirectory`, and it
 * is deliberately not dressed up as consent below: it governs one profile
 * projection and says nothing about photography.
 */
export default async function ReleaseAndConsentFormsPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Release & Consent Forms"
        tags={<Tag color="grey">not built</Tag>}
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="v" href="/attendees/call-for-volunteers/release-and-consent-forms">
            Volunteer forms
          </Link>,
        ]}
      />

      <Banner kind="danger">
        <strong>No consent is recorded anywhere in this project.</strong> There is no form, no
        signature, no timestamp and no per-attendee status. If photography or recording consent is
        being collected for KGC 2027, it is being collected somewhere other than here — and nothing
        on this screen should be read as evidence that anybody agreed to anything.
      </Banner>

      <Panel>
        <EmptyState icon="◌">
          <strong>No forms, and no responses to show.</strong>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            The registration flow at <code>apps/web</code> collects a name, an email and a payment.
            It asks nothing else, so there is no answer to carry forward into a consent record.
          </div>
        </EmptyState>
      </Panel>

      <Panel>
        <h2 className="section-header">What a consent record has to be</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Immutable, and versioned against the text that was agreed.</strong> &ldquo;Jane
            consented&rdquo; is worthless without the wording she saw; a consent store that lets the
            wording change afterwards records nothing that could be relied on. That makes it an
            append-only collection with a document hash, not a boolean on the attendee.
          </li>
          <li>
            <strong>Withdrawable, and withdrawal has to travel.</strong> Someone who withdraws
            consent needs their photograph pulled, which means the record has to be readable by
            whoever handles the photographs — a workflow, not a column.
          </li>
          <li>
            <strong>Blocked behind the same missing piece as everything else in this cluster.</strong>{' '}
            A form an attendee fills in is Question Forms, which is also what Segments, Call for
            Speakers and Call for Volunteers are waiting on. One generic submission-and-response
            store unblocks all of them.
          </li>
        </ul>
      </Panel>

      <NotBuilt
        whova="Uploadable release and consent forms attendees sign during registration or from the app, with per-attendee signed/unsigned status and a reminder to the unsigned."
        needs="A question-and-response store, an append-only consent record versioned against the agreed wording, and a reminder sender."
        size="3–5 days on top of question forms, which is the prerequisite"
        refs="ROADMAP.md — Phase 2 generic entity CRUD and the submission-form capability"
      />

      <Panel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Collecting a consent.</strong> No form is published and no response is stored.
          </li>
          <li>
            <strong>Signed / unsigned status.</strong> Nothing to derive it from, so the attendee
            list carries no such column.
          </li>
          <li>
            <strong>Reminders to the unsigned.</strong> A sender exists for ticket receipts and
            speaker messages; the audience for this one does not.
          </li>
          <li>
            <strong>Directory opt-out is not consent.</strong>{' '}
            <code>UserDoc.visibleInDirectory</code> deletes a profile projection and is about
            being findable by other attendees. It is not a photography release and must not be
            reported as one.
          </li>
        </ul>
      </Panel>
    </>
  );
}
