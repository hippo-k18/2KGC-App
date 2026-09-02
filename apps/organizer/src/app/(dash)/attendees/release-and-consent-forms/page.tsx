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
        tags={<Tag color="blue">{forms.length} form{forms.length === 1 ? '' : 's'}</Tag>}
        actions={
          showForm || reg ? (
            <Link href={base} className="whova-btn-main secondary">
              Back to forms
            </Link>
          ) : (
            <Link href="?new=1" className="whova-btn-main">
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
            <strong>{reg.form.title}</strong> — version {reg.form.version}, {reg.form.status}
            {reg.form.publishedAt
              ? `, first published ${new Date(reg.form.publishedAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}`
              : ', never published'}
            . Every signature below is stored against the sha256 of the wording as it stood when it
            was given, and no client — this dashboard included — can edit or delete one.
          </Banner>
          <ConsentRegisterView register={reg} />
        </>
      ) : (
        <>
          <Banner kind="info">
            <strong>Consent is recorded here now, and these are its limits.</strong> Signing is
            real: a form has a version and a hash of its wording, a signature records who agreed to
            which version and when, and the record is append-only — nothing in this product can
            edit or delete one. What it does <em>not</em> do: nothing blocks on an unsigned form
            (a ticket still scans, a session still runs), nothing here emails the signing links,
            and there is no withdrawal flow, so a request to withdraw is handled by a person.
          </Banner>

          {forms.length === 0 ? (
            <Panel>
              <EmptyState icon="◌">
                <strong>No consent form has been written yet.</strong>
                <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                  Nothing is being collected until one is published — and until then, nothing on
                  this screen should be read as evidence that anybody agreed to anything.{' '}
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
            <h2 className="section-header">What a consent record has to be, and what this one is</h2>
            <ul className="body-2" style={{ paddingLeft: 18 }}>
              <li>
                <strong>Immutable, and versioned against the text that was agreed.</strong>{' '}
                &ldquo;Jane consented&rdquo; is worthless without the wording she saw. So a form
                carries a version and the sha256 of its body; a signature carries both, pinned to
                what the form actually said at that moment rather than to what the browser claimed;
                and <code>update</code> and <code>delete</code> are closed to every client in{' '}
                <code>firestore.rules</code>. Rewording a form publishes a new version and makes
                the old signatures outstanding — which is the uncomfortable answer and the correct
                one.
              </li>
              <li>
                <strong>Reachable by people who have no account.</strong> Most speakers never buy a
                ticket, so there is nothing for the rules to authenticate. They sign through a
                capability link — the same HMAC pattern <code>/order/&#123;token&#125;</code> uses
                — and the record says <code>channel: link</code> rather than pretending that
                possession of a mailed URL is authentication.
              </li>
              <li>
                <strong>Withdrawable — and this is the part that is not built.</strong> Someone who
                withdraws consent needs their photograph pulled, which is a workflow reaching
                whoever handles the photographs, not a column. Nothing here does that. The signing
                page tells people to email a human, which is honest and is not a feature.
              </li>
              <li>
                <strong>Directory opt-out is not consent.</strong>{' '}
                <code>UserDoc.visibleInDirectory</code> deletes a profile projection and is about
                being findable by other attendees. It is not a photography release, it is not
                versioned, and it must not be reported as one. It never was, and building this
                store did not change it.
              </li>
            </ul>
          </Panel>
        </>
      )}

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Sending the links.</strong> The register mints a per-person signing link and
            nothing mails it. <code>scripts/src/lib/email.ts</code> composes every transactional
            mail this project sends and has no consent template, so today an organizer copies a
            link into a message they write themselves. Chasing the unsigned is then manual, and for
            a thousand attendees that is not a workaround, it is a wall.
          </li>
          <li>
            <strong>Withdrawal.</strong> No revocation record, no way to mark a signature
            superseded by a request to withdraw, and nothing that reaches the people holding the
            photographs. A withdrawal today is an email to a person and a note somewhere this
            system cannot see.
          </li>
          <li>
            <strong>Signature notifications, not the audit trail.</strong> Publishing or revising a
            release now writes <code>consentForm.publish</code> or{' '}
            <code>consentForm.update</code> to the audit log, recording the actor, the version and
            the body hash before and after — so &ldquo;who published the wording this signature
            names&rdquo; survives the next edit, which <code>updatedBy</code> alone did not. What is
            still absent is anything that <em>tells</em> somebody: nothing emails a signing link and
            nothing chases an outstanding one. The links are minted here and copied by hand.
          </li>
          <li>
            <strong>Anything gated on a signature.</strong> Check-in does not look at it, the app
            does not look at it, and no session is marked recordable or not. A release recorded
            here changes nothing that happens at the door — see{' '}
            <code>SessionDoc</code>, which still has no &ldquo;may be recorded&rdquo; field.
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
