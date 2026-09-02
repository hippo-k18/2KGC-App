import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listConsentForms } from '@/lib/consents';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, GapPanel, GapTag, NotBuilt, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Call for Volunteers › Release & Consent Forms.
 *
 * Whova nests a second copy of the consent screen under volunteers, and the
 * duplication is not accidental: a volunteer signs a different document from an
 * attendee. An attendee agrees to be photographed; a volunteer agrees to handle
 * a radio, stand on a ladder, or be listed as a responsible adult, and an
 * organizer needs to know *before* the shift starts whether that signature
 * exists.
 *
 * ── One of the two gaps closed; the other is untouched ──────────────────────
 *
 * This screen used to say two things were absent, not one: no consent store,
 * and no volunteer to attach one to. The first is now built — `consentForms`
 * takes a `volunteer` audience, the wording is versioned and hashed, and a
 * waiver published here can genuinely be signed by anybody sent a link.
 *
 * **The second is exactly as absent as it was.** There is no `volunteers`
 * collection, no volunteer role and no shift model anywhere in this project, so
 * there is no roster to show a signed/unsigned column against and nothing to
 * gate on a signature. This screen therefore lists published volunteer waivers
 * and refuses to render a register, because a register of nobody and a register
 * with nobody outstanding look identical and mean opposite things.
 *
 * That refusal is the whole content of this screen and it is deliberate: an
 * organizer who lands here from the volunteer tree must not leave believing
 * volunteer consent is being tracked.
 */
export default async function VolunteerConsentFormsPage() {
  await requireOrganizer();

  const forms = await listConsentForms();
  const volunteerForms = forms.filter((f) => f.audience === 'volunteer');
  const signatures = volunteerForms.reduce((n, f) => n + f.signatureCount, 0);

  return (
    <>
      <PageHeader
        title="Release & Consent Forms"
        tags={<GapTag>no volunteer roster</GapTag>}
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
        <strong>A waiver can be signed here. Nothing tracks who has signed it.</strong> Consent
        itself is real now — versioned wording, an append-only signature record, a public signing
        link — but there is no <code>volunteers</code> collection and no volunteer role in this
        project, so there is no list of people to mark signed or unsigned and no shift that could
        be gated on one. Treat the count below as &ldquo;signatures received&rdquo;, never as
        &ldquo;volunteers cleared&rdquo;: this system does not know who the volunteers are, so it
        cannot tell you who is missing.
      </Banner>

      {volunteerForms.length === 0 ? (
        <Panel>
          <EmptyState icon="◌">
            <strong>No volunteer waiver has been published.</strong>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              Write one on{' '}
              <Link href="/attendees/release-and-consent-forms?new=1">
                Attendees › Release &amp; Consent Forms
              </Link>{' '}
              and choose the <strong>Volunteers</strong> audience — one screen authors all three,
              because only the audience differs.{' '}
              <Link href="/attendees/call-for-volunteers/volunteer-manager">Volunteer Manager</Link>{' '}
              explains the missing roster model, which is the half of this screen that is still
              absent.
            </div>
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Table
            cols={[
              { key: 'title', label: 'Waiver', className: 'cell-fill' },
              { key: 'version', label: 'Version', className: 'cell-sm' },
              { key: 'status', label: 'Status', className: 'cell-sm' },
              { key: 'signed', label: 'Signatures', className: 'cell-sm' },
            ]}
            rows={volunteerForms.map((f) => [
              <span key="t">
                <Link href={`/attendees/release-and-consent-forms?edit=${f.id}`}>{f.title}</Link>
                <div className="muted" style={{ fontSize: 11 }}>
                  {f.required ? 'Required' : 'Optional'}
                </div>
              </span>,
              `v${f.version}`,
              f.status === 'published' ? (
                <Tag key="s" color="green">published</Tag>
              ) : (
                <Tag key="s" color="grey">{f.status}</Tag>
              ),
              f.currentSignatureCount,
            ])}
          />
          <Banner kind="warning">
            <strong>
              {signatures} {signatures === 1 ? 'signature has' : 'signatures have'} been received,
              out of an unknown number expected.
            </strong>{' '}
            The denominator does not exist. Without a volunteer roster there is no
            &ldquo;outstanding&rdquo; to compute, so this number can never be a percentage and must
            not be read as progress.
          </Banner>
        </>
      )}

      <Panel>
        <h2 className="section-header">Why the volunteer version is the harder of the two</h2>
        <p className="body-2">
          An attendee release is one document signed once, and that is the shape now built. A
          volunteer pack is several — a liability waiver, a code of conduct, sometimes a background
          check or a proof of age — each with its own expiry and its own consequence for being
          missing. The useful unit is &ldquo;which requirements does this shift have, and which does
          this person satisfy today&rdquo;, which is a small compliance matrix rather than a
          signed/unsigned column. The consent store handles the second half of that (several forms,
          each versioned, each with its own signatures); it has nothing to say about the first.
        </p>
        <p className="body-2">
          It also has a hard edge the attendee version does not: a volunteer without a signed
          waiver should not be rostered, so the check belongs in the assignment path rather than in
          a report somebody reads afterwards. There is no assignment path here to put it in.
          Building the register without that gate would produce a screen that is accurate and
          useless.
        </p>
        <p className="body-2">
          ⚠️ Expiry is genuinely absent, not merely unbuilt-here.{' '}
          <code>ConsentFormDoc</code> has a version and a publication date and no notion of a
          signature going stale after twelve months. A waiver that expires needs that field and a
          job that acts on it, and neither exists.
        </p>
      </Panel>

      <NotBuilt
        whova="Release and consent forms attached to the volunteer call, with per-volunteer signed status and reminders before the event."
        needs="A volunteer and shift model — the consent record itself now exists and is versioned, append-only and signable through a public link. Also an expiry on a signature, and a check in the rostering path."
        size="3–5 days for the roster and shifts; the consent half is done"
        refs="ROADMAP.md — the volunteer roster, which Call for Speakers and Segments also wait on"
      />

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Volunteers.</strong> No collection, no role, no roster. This is the gap that
            makes the rest of the screen impossible, and it is unchanged.
          </li>
          <li>
            <strong>Signed / unsigned status.</strong> Needs a list of expected signatories. There
            is none, so the register is deliberately not rendered rather than rendered empty.
          </li>
          <li>
            <strong>Blocking a shift on a missing waiver.</strong> There are no shifts.
          </li>
          <li>
            <strong>Expiry and renewal.</strong> A signature here has a date and no expiry, and
            nothing re-asks after one.
          </li>
          <li>
            <strong>Reminders.</strong> Nothing in this project mails a consent link, for any
            audience.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
