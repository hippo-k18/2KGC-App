import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { consentRegister, listConsentForms } from '@/lib/consents';
import { listSpeakers } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';
// The register is shared with Attendees › Release & Consent Forms, which is
// where the form is authored. The same screen is nested twice in the navigation
// and the two differ only in which audience the form is for — the same
// arrangement `SurveyScreen` has for Surveys and Session Feedback.
import { ConsentRegisterView } from '../../../attendees/release-and-consent-forms/register-view';

export const dynamic = 'force-dynamic';

/**
 * Content › Speaker Center › Release & Consent Forms.
 *
 * The consent that matters here is the one that lets the conference record a
 * talk and publish it. KGC records its sessions, so this is not a hypothetical
 * screen — it is the difference between a video library and forty emails asking
 * whether a particular talk may go out.
 *
 * ── This screen used to count speakers because it could not count consents ──
 *
 * It said so plainly: nothing in the data model recorded consent, so the tiles
 * were speakers rather than signatures — how big the job was, not how much of it
 * was done. That is no longer the case. `consentForms` and its append-only
 * `responses` subcollection exist, and the register below is a real signed /
 * unsigned column against the real speaker list.
 *
 * ── The speaker-shaped problem, and how it is solved ────────────────────────
 *
 * Speakers have no dashboard accounts and mostly no accounts at all — a
 * `SpeakerDoc` comes from the programme committee's CSV, and most speakers never
 * buy a ticket. There is nothing for `firestore.rules` to authenticate. So each
 * row here mints a capability link: the pattern `/order/{token}` already uses,
 * argued out in `scripts/src/lib/consent-token.ts`, and honoured by
 * `/consent/{token}` on the public site. That was named on this screen as the
 * one piece already built and proven; it is now the one being reused.
 *
 * ── The DocuSign question is still open, and still worth asking ─────────────
 *
 * What this does not have is a countersigned PDF, a certificate of completion,
 * or identity verification. For forty-five speakers once a year, a signing
 * service with this screen holding a link and a status may still be the better
 * trade. Nothing below pretends that decision was made.
 *
 * ── The wording is typed, not attached ──────────────────────────────────────
 *
 * Storage uploads work now, so a PDF release *could* be attached. It is
 * deliberately not: a hash over plain text is what makes a signature bind to
 * wording that can be diffed between versions, and a countersigned PDF is the
 * signing-service question above rather than a file field here.
 */
export default async function ReleaseAndConsentFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ register?: string }>;
}) {
  await requireOrganizer();
  const { register } = await searchParams;

  const [forms, speakers] = await Promise.all([listConsentForms(), listSpeakers()]);
  const speakerForms = forms.filter((f) => f.audience === 'speaker');

  /*
   * One form: show its register straight away rather than making an organizer
   * click through a list of one. Several: they pick. The `?register=` parameter
   * is honoured either way so the link from the attendee screen still lands.
   */
  const chosenId = register ?? (speakerForms.length === 1 ? speakerForms[0].id : undefined);
  const reg = chosenId ? await consentRegister(chosenId) : null;

  const onAgenda = speakers.filter((s) => s.sessionCount > 0).length;
  const noAddress = speakers.filter((s) => !s.contactEmail).length;

  return (
    <>
      <PageHeader
        title="Release & Consent Forms"
        info={
          <>
            <strong>Signatures bind to the wording</strong>
            <p>
              Each signature is kept with the exact wording the speaker agreed to, and it cannot be
              edited or deleted. A speaker with no account signs through the link in their row.
            </p>
          </>
        }
        tags={
          speakerForms.length > 0 ? (
            <Tag color="blue">{speakerForms.length} speaker form{speakerForms.length === 1 ? '' : 's'}</Tag>
          ) : undefined
        }
        actions={
          <Link href="/attendees/release-and-consent-forms?new=1" className="whova-btn-main primary">
            + New form
          </Link>
        }
        links={[
          <Link key="s" href={ROUTES.speakerManager}>
            Speaker Manager
          </Link>,
          <Link key="m" href={ROUTES.messageSpeakers}>
            Message Speakers
          </Link>,
          <Link key="a" href="/attendees/release-and-consent-forms">
            All consent forms
          </Link>,
        ]}
      />

      {speakerForms.length === 0 ? (
        <>
          <Banner kind="warning">
            <strong>No speaker release has been published.</strong> No consent is being collected,
            so do not publish recordings yet.
          </Banner>

          <StatTiles
            tiles={[
              { label: 'Speakers', value: speakers.length, sub: 'would each need a release' },
              { label: 'On the agenda', value: onAgenda, sub: 'sessions that could be recorded' },
              { label: 'Consents on file', value: 0, sub: 'no form published yet' },
            ]}
          />

          <Panel>
            <NotInputted
              what="speaker releases"
              action={
                <Link href="/attendees/release-and-consent-forms?new=1" className="whova-btn-main primary">
                  Write the release
                </Link>
              }
            />
            <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
              Forms are authored on{' '}
              <Link href="/attendees/release-and-consent-forms">
                Attendees › Release &amp; Consent Forms
              </Link>
              . Choose <strong>Speakers</strong> as the audience and the form appears here.
            </p>
          </Panel>
        </>
      ) : !reg ? (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>
            More than one speaker release is published. Pick a register
          </h2>
          <Table
            cols={[
              { key: 'title', label: 'Form', className: 'cell-fill' },
              { key: 'version', label: 'Version', className: 'cell-sm' },
              { key: 'status', label: 'Status', className: 'cell-sm' },
              { key: 'signed', label: 'Signed', className: 'cell-sm' },
            ]}
            rows={speakerForms.map((f) => [
              <Link key="t" href={`?register=${f.id}`}>
                {f.title}
              </Link>,
              `v${f.version}`,
              f.status,
              f.currentSignatureCount,
            ])}
          />
        </Panel>
      ) : (
        <>
          <p className="body-2">
            <strong>{reg.form.title}</strong>. Version {reg.form.version}, {reg.form.status}.
          </p>
          {noAddress > 0 && (
            <Banner kind="warning">
              <strong>
                {noAddress} {noAddress === 1 ? 'speaker has' : 'speakers have'} no contact address
                on file.
              </strong>{' '}
              Add an address in <Link href={ROUTES.speakerManager}>Speaker Manager</Link> so their
              signing link can be sent.
            </Banner>
          )}
          <ConsentRegisterView register={reg} />
        </>
      )}

      <Panel>
        <h2 className="section-header">Chasing a signature</h2>
        <p className="body-2">
          Each unsigned row has its own signing link. Copy it into a message and the speaker
          signs without an account. <Link href={ROUTES.messageSpeakers}>Message Speakers</Link>{' '}
          cannot filter by who has not signed yet, so send each link yourself.
        </p>
        <p className="body-2">
          A signature is a typed name, not a countersigned PDF or an identity check.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Sending or chasing.</strong> Links are minted per row and copied by hand.{' '}
            <code>scripts/src/lib/email.ts</code> has no consent template and Message Speakers has
            no &ldquo;unsigned&rdquo; segment.
          </li>
          <li>
            <strong>Photo and recording consent as a per-session flag.</strong>{' '}
            <code>SessionDoc</code> still has no &ldquo;may be recorded&rdquo; field, so a signed
            release is not something the app can act on — it cannot hide a recording it is not
            allowed to show, which is the failure this feature exists to prevent. A speaker
            release is per person; permission to publish is per talk, and the two are not the same
            question.
          </li>
          <li>
            <strong>A verifiable signed document.</strong> No PDF, no certificate, no identity
            check.
          </li>
          <li>
            <strong>Withdrawal.</strong> The record is append-only by design; there is no
            revocation flow, and nothing reaches whoever holds the video files.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
