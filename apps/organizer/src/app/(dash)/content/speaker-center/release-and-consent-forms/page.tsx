import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { consentRegister, listConsentForms } from '@/lib/consents';
import { listSpeakers } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';
// The register is shared with Attendees › Release & Consent Forms, which is
// where the form is authored. Whova nests the same screen twice and the two
// differ only in which audience the form is for — the same arrangement
// `SurveyScreen` has for Surveys and Session Feedback.
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
        tags={
          speakerForms.length > 0 ? (
            <Tag color="blue">{speakerForms.length} speaker form{speakerForms.length === 1 ? '' : 's'}</Tag>
          ) : undefined
        }
        actions={
          <Link href="/attendees/release-and-consent-forms?new=1" className="whova-btn-main">
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
            <strong>No speaker release has been published.</strong> Consent can be recorded in this
            project now — the store, the rules and the signing page are all real — but nothing is
            being collected from speakers until somebody writes the wording. Until then this screen
            counts the size of the job and not a single signature, and no recording should be
            published on the assumption that anybody agreed to it.
          </Banner>

          <StatTiles
            tiles={[
              { label: 'Speakers', value: speakers.length, sub: 'would each need a release' },
              { label: 'On the agenda', value: onAgenda, sub: 'sessions that could be recorded' },
              { label: 'Consents on file', value: 0, sub: 'no form published yet' },
            ]}
          />

          <Panel>
            <EmptyState icon="◌">
              <strong>Write the release, then this becomes a register.</strong>
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                Forms are authored on{' '}
                <Link href="/attendees/release-and-consent-forms?new=1">
                  Attendees › Release &amp; Consent Forms
                </Link>{' '}
                — one screen for all three audiences, because the machinery is the same and only
                the audience differs. Choose <strong>Speakers</strong> and it appears here.
              </div>
            </EmptyState>
          </Panel>
        </>
      ) : !reg ? (
        <>
          <Banner kind="info">
            More than one speaker release is published. Pick the one whose register you want.
          </Banner>
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
        </>
      ) : (
        <>
          <Banner kind="info">
            <strong>{reg.form.title}</strong> — version {reg.form.version}, {reg.form.status}. Each
            signature is stored against the sha256 of the wording as it stood when it was given,
            and no client, this dashboard included, can edit or delete one. A speaker with no
            account signs through the link in their row.
          </Banner>
          {noAddress > 0 && (
            <Banner kind="warning">
              <strong>
                {noAddress} {noAddress === 1 ? 'speaker has' : 'speakers have'} no contact address
                on file.
              </strong>{' '}
              Their signing link exists and there is nowhere to send it. That is a Speaker Manager
              problem before it is a consent problem — a chase that cannot be addressed is a chase
              that silently does not happen.
            </Banner>
          )}
          <ConsentRegisterView register={reg} />
        </>
      )}

      <Panel>
        <h2 className="section-header">What Whova does, and where this differs</h2>
        <p className="body-2">
          Whova uploads a release document, sends it to every speaker, collects a typed signature
          and shows a signed / unsigned column beside the speaker list, chasing the unsigned on a
          schedule. The value is entirely in that column — the document itself is a PDF a lawyer
          wrote once.
        </p>
        <p className="body-2">
          The column is here and it is real. Two things of Whova&rsquo;s are not: the{' '}
          <strong>uploaded document</strong>, because the Storage bucket for this project has never
          been created (<code>OWNER-ACTIONS.md</code> §1), so the wording is typed as plain text
          rather than attached as a PDF — which is also what makes it hashable and diffable between
          versions; and the <strong>chase</strong>, because nothing here sends mail. Message
          Speakers already sends to a segment, and &ldquo;has not signed&rdquo; would be one more
          segment, which is the smallest remaining piece of this feature.
        </p>
        <p className="body-2">
          The honest alternative is still a signing service — DocuSign or Dropbox Sign — with this
          screen holding a link and a status. For forty-five speakers once a year that may be the
          better trade, and what this build buys is the ability to make that decision against a
          working thing rather than against an estimate.
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
            check. A typed name against a hashed body of text is what is stored, and the register
            says <code>by link</code> or <code>in the app</code> rather than implying more.
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
