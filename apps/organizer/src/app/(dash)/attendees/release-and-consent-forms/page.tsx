import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { consentRegister, listConsentForms } from '@/lib/consents';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, GapPanel, PageHeader, Panel, Table, Tag } from '../../ui';
import { ConsentForm } from './consent-form';
import { ConsentRegisterView } from './register-view';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Release & Consent Forms.
 *
 * Photo and video release, recording consent, a code of conduct acknowledgement
 * — a form somebody signs, and a record that they did. This screen publishes the
 * wording and shows who has agreed to it.
 *
 * ── What changed, and why the old banner is gone ────────────────────────────
 *
 * This screen used to say, in red, that no consent was recorded anywhere in this
 * project — no form, no signature, no timestamp, no per-attendee status. That
 * was true and it is no longer: `consentForms/{id}` holds the published wording
 * with a version and a sha256 of the text, `consentForms/{id}/responses/{id}`
 * holds the signatures, `firestore.rules` makes them append-only, and the
 * register below is built from the real attendee list. The warning is gone
 * because the thing it warned about was fixed, not because it became
 * inconvenient.
 *
 * What has NOT changed is the reason the warning was written so loudly in the
 * first place: consent is the one record where a half-built system is actively
 * dangerous, because an organizer who believes releases are being collected
 * publishes photographs on that belief. So the limits are stated as plainly as
 * the absence used to be — nothing blocks on an unsigned form, nothing sends the
 * link, and there is no withdrawal flow.
 *
 * ── `visibleInDirectory` is still not consent ───────────────────────────────
 *
 * It never was, and building a consent store does not make it one.
 * `UserDoc.visibleInDirectory` deletes a profile projection and governs whether
 * other attendees can find you. It says nothing about photography, it is not
 * versioned, it is not timestamped, and it must never be reported as a release.
 */
export default async function ReleaseAndConsentFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; edit?: string; register?: string }>;
}) {
  await requireOrganizer();
  const { new: creating, edit, register } = await searchParams;

  const forms = await listConsentForms();
  const editing = edit ? forms.find((f) => f.id === edit) : undefined;
  const showForm = Boolean(creating) || Boolean(editing);
  const reg = register ? await consentRegister(register) : null;

  const base = '/attendees/release-and-consent-forms';

  return (
    <>
      <PageHeader
        title="Release & Consent Forms"
        info={
          <>
            <strong>Signatures cannot be edited</strong>
            <p>
              Each signature is kept against the version of the wording that was signed. Publishing
              a form sends everybody who has not signed it their own link. Withdrawals are handled
              by your team.
            </p>
          </>
        }
        tags={<Tag color="blue">{forms.length} form{forms.length === 1 ? '' : 's'}</Tag>}
        actions={
          showForm || reg ? (
            <Link href={base} className="whova-btn-main secondary">
              Back to forms
            </Link>
          ) : (
            <Link href="?new=1" className="whova-btn-main primary">
              + New form
            </Link>
          )
        }
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="s" href="/content/speaker-center/release-and-consent-forms">
            Speaker forms
          </Link>,
          <Link key="v" href="/attendees/call-for-volunteers/release-and-consent-forms">
            Volunteer forms
          </Link>,
        ]}
      />

      {showForm ? (
        <Panel>
          <h2 className="section-header">{editing ? 'Edit form' : 'New consent form'}</h2>
          <ConsentForm existing={editing} />
        </Panel>
      ) : reg ? (
        <>
          <Banner kind="info">
            <strong>{reg.form.title}</strong>. Version {reg.form.version}, {reg.form.status}
            {reg.form.publishedAt
              ? `, first published ${new Date(reg.form.publishedAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}`
              : ', never published'}
            . Signatures below are for this version of the wording.
          </Banner>
          <ConsentRegisterView register={reg} />
        </>
      ) : (
        <>
          {forms.length === 0 ? (
            <Panel>
              <EmptyState icon="◌">
                <strong>No consent form has been written yet.</strong>
                <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                  No consent is collected until a form is published.{' '}
                  <Link href="?new=1">Write one</Link>.
                </div>
              </EmptyState>
            </Panel>
          ) : (
            <Table
              cols={[
                { key: 'title', label: 'Form', className: 'cell-fill' },
                { key: 'audience', label: 'Audience', className: 'cell-sm' },
                { key: 'version', label: 'Version', className: 'cell-sm' },
                { key: 'status', label: 'Status', className: 'cell-sm' },
                { key: 'signed', label: 'Signed', className: 'cell-sm' },
                { key: 'act', label: '', className: 'cell-sm' },
              ]}
              rows={forms.map((f) => [
                <span key="t">
                  <Link href={`?register=${f.id}`}>{f.title}</Link>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {f.required ? 'Required' : 'Optional'}
                    {f.updatedBy ? ` · last edited by ${f.updatedBy}` : ''}
                  </div>
                </span>,
                f.audience,
                `v${f.version}`,
                f.status === 'published' ? (
                  <Tag key="s" color="green">published</Tag>
                ) : f.status === 'draft' ? (
                  <Tag key="s" color="grey">draft</Tag>
                ) : (
                  <Tag key="s" color="red">cancelled</Tag>
                ),
                <span key="c">
                  {f.currentSignatureCount}
                  {f.signatureCount > f.currentSignatureCount ? (
                    <div className="muted" style={{ fontSize: 11 }}>
                      +{f.signatureCount - f.currentSignatureCount} at an older version
                    </div>
                  ) : null}
                </span>,
                <Link key="e" href={`?edit=${f.id}`} style={{ fontSize: 12 }}>
                  Edit
                </Link>,
              ])}
            />
          )}

          <Panel>
            <h2 className="section-header">How signing works</h2>
            <ul className="body-2" style={{ marginBottom: 0, paddingLeft: 18 }}>
              <li>Changing the wording publishes a new version, and earlier signatures count as outstanding.</li>
              <li>People without an account, such as speakers, sign through a personal link.</li>
              <li>
                Publishing a form sends that link to everybody who has not signed it. Anyone added
                to the attendee list afterwards is sent one as they are added.
              </li>
              <li>
                A required form shows as <strong>Form not signed</strong> on the badge sheet and at
                check-in until it is signed. Nobody is turned away.
              </li>
              <li>To withdraw consent, a person writes to the address on the signing page.</li>
              <li>Hiding a profile from the directory is not a consent record.</li>
            </ul>
          </Panel>
        </>
      )}

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Chasing the unsigned.</strong> The link goes out when the form is published and
            when somebody is added, and nothing sends a reminder after that. A second round is the
            register, the per-row link, and a message somebody writes.
          </li>
          <li>
            <strong>Withdrawal.</strong> No revocation record, no way to mark a signature
            superseded by a request to withdraw, and nothing that reaches the people holding the
            photographs. A withdrawal today is an email to a person and a note somewhere this
            system cannot see.
          </li>
          <li>
            <strong>Blocking on a signature.</strong> A required form is reported at the badge sheet
            and at the scan desk and stops nothing. That is deliberate: a door volunteer holding a
            queue cannot adjudicate a release. The app does not look at it either, and no session
            is marked recordable or not — see <code>SessionDoc</code>, which still has no
            &ldquo;may be recorded&rdquo; field.
          </li>
          <li>
            <strong>A signed PDF, or anything a signing service would give you.</strong> There is
            no certificate, no document hash chain and no identity verification. The signature is a
            typed name against a hashed body of text: the standard a paper release meets, and not
            the standard DocuSign meets.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
