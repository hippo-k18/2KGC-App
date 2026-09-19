import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { consentRegister, listConsentForms } from '@/lib/consents';
import { ROUTES } from '@/lib/nav';
import { listVolunteers, summariseRoster } from '@/lib/volunteers';
import { EmptyState, PageHeader, Panel, Table, Tag } from '../../../ui';
import { ConsentRegisterView } from '../../release-and-consent-forms/register-view';

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
 * ── Both halves of this screen are now real ─────────────────────────────────
 *
 * It used to say two things were absent: no consent store, and no volunteer to
 * attach one to. The first was closed when `consentForms` was built; the second
 * when `volunteers` was. So the register renders — signed, outstanding, and the
 * uncomfortable third state where somebody signed wording that has since been
 * revised — against the roster on Volunteer Manager rather than against nobody.
 *
 * ⚠️ What is still true, and is in the header tip rather than on the page: a
 * missing signature blocks nothing. Nothing in the assignment path checks it,
 * because the honest place for that check is where a shift is given out, and
 * putting it in a report somebody reads afterwards would be a screen that is
 * accurate and useless. A waiver here also has no expiry — `ConsentFormDoc`
 * carries a version and a publication date and no notion of a signature going
 * stale after twelve months.
 */
export default async function VolunteerConsentFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ register?: string }>;
}) {
  await requireOrganizer();

  const { register } = await searchParams;

  const [forms, roster] = await Promise.all([listConsentForms(), listVolunteers()]);
  const volunteerForms = forms.filter((f) => f.audience === 'volunteer');
  const summary = summariseRoster(roster);

  /*
    Only a volunteer form may be opened from this screen. The register component
    is audience-agnostic and would happily render the attendee one, which is how
    a screen under the volunteer tree ends up reporting attendee coverage.
  */
  const selected = register ? volunteerForms.find((f) => f.id === register) : undefined;
  const reg = selected ? await consentRegister(selected.id) : null;

  return (
    <>
      <PageHeader
        title="Release & Consent Forms"
        info={
          <>
            <strong>Waivers are recorded only</strong>
            <p>A missing waiver does not block a shift or check-in. Signatures do not expire.</p>
          </>
        }
        tags={
          <Tag color="blue">
            {volunteerForms.length} waiver{volunteerForms.length === 1 ? '' : 's'}
          </Tag>
        }
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

      {reg && selected ? (
        <>
          <Panel>
            <h2 className="section-header">{selected.title}</h2>
            <p className="body-2">
              Version {selected.version}, {selected.status}. Signatures cannot be edited or deleted.{' '}
              <Link href="/attendees/call-for-volunteers/release-and-consent-forms">
                Back to waivers
              </Link>
              .
            </p>
          </Panel>
          <ConsentRegisterView register={reg} />
        </>
      ) : volunteerForms.length === 0 ? (
        <Panel>
          <EmptyState icon="◌">
            <strong>No volunteer waiver has been published.</strong>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              Write one on{' '}
              <Link href="/attendees/release-and-consent-forms?new=1">
                Attendees › Release &amp; Consent Forms
              </Link>{' '}
              and choose the <strong>Volunteers</strong> audience.
            </div>
          </EmptyState>
        </Panel>
      ) : (
        <Table
          cols={[
            { key: 'title', label: 'Waiver', className: 'cell-fill' },
            { key: 'version', label: 'Version', className: 'cell-sm' },
            { key: 'status', label: 'Status', className: 'cell-sm' },
            { key: 'signed', label: 'Signed', className: 'cell-sm' },
          ]}
          rows={volunteerForms.map((f) => [
            <span key="t">
              <Link href={`?register=${f.id}`}>{f.title}</Link>
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
            <span key="c">
              {f.currentSignatureCount}
              <div className="muted" style={{ fontSize: 11 }}>
                of {summary.people} on the roster
              </div>
            </span>,
          ])}
        />
      )}
    </>
  );
}
