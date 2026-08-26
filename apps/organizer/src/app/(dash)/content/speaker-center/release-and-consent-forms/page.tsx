import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSpeakers } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Speaker Center › Release & Consent Forms.
 *
 * The consent that matters here is the one that lets the conference record a
 * talk and publish it. KGC records its sessions, so this is not a hypothetical
 * screen — it is the difference between a video library and forty emails asking
 * whether a particular talk may go out.
 *
 * **Nothing in the data model records consent.** `SpeakerDoc` has a name, a bio,
 * a photo, a contact address and a list of sessions. There is no field for a
 * signature, no document for a form, no timestamp for when it was agreed and no
 * store for the PDF. That is why the counts below are speakers, not consents:
 * they say how big the job is, not how much of it is done, because how much of
 * it is done is not knowable from this system.
 */
export default async function ReleaseAndConsentFormsPage() {
  await requireOrganizer();

  const speakers = await listSpeakers();
  const contactable = speakers.length;
  const onAgenda = speakers.filter((s) => s.sessionCount > 0).length;

  return (
    <>
      <PageHeader
        title="Release & Consent Forms"
        links={[
          <Link key="s" href={ROUTES.speakerManager}>
            Speaker Manager
          </Link>,
          <Link key="m" href={ROUTES.messageSpeakers}>
            Message Speakers
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>No consent is recorded anywhere in this system.</strong> If releases have been
        collected they live in somebody&rsquo;s inbox or a signing service, and this dashboard
        cannot tell you who has signed. Do not read the numbers below as progress.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Speakers', value: contactable, sub: 'would each need a release' },
          { label: 'On the agenda', value: onAgenda, sub: 'sessions that could be recorded' },
          { label: 'Consents on file', value: '—', sub: 'not modelled' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Uploads a release document, sends it to every speaker, collects a typed signature and
          shows a signed / unsigned column beside the speaker list. It chases the unsigned ones on a
          schedule. The value is entirely in that column — the document itself is a PDF a lawyer
          wrote once.
        </p>

        <h2 className="section-header">What this would need</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>A consent record</strong> — who agreed, to which version of which document, at
            what time, from what address. Versioning is not optional: a release signed against last
            year&rsquo;s wording is a release for last year&rsquo;s wording.
          </li>
          <li>
            <strong>A speaker-facing page.</strong> Speakers do not have dashboard accounts, so this
            is the personal-link pattern — a capability token in a URL, the same shape as the order
            confirmation page in <code>apps/web</code>, which is the one piece already built and
            proven.
          </li>
          <li>
            <strong>Storage for the document,</strong> which no screen in this project can write to.
          </li>
          <li>
            <strong>A chase loop,</strong> which is nearly free: Message Speakers already sends to a
            segment, and &ldquo;has not signed&rdquo; would be one more segment.
          </li>
        </ul>

        <p className="body-2">
          Roughly <strong>4–6 days</strong>, and the honest alternative is a signing service —
          DocuSign or Dropbox Sign — with this screen holding nothing but a link and a status
          somebody pastes in. For forty-five speakers once a year that is the better trade, and it
          is worth deciding before building the first version.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Signatures.</strong> Nothing captures, stores or verifies one.
          </li>
          <li>
            <strong>Photo and recording consent as a per-session flag.</strong>{' '}
            <code>SessionDoc</code> has no &ldquo;may be recorded&rdquo; field, so the app cannot
            hide a recording it is not allowed to show — which is the failure this feature exists to
            prevent.
          </li>
          <li>
            <strong>Attendee consent.</strong> A separate question with a separate answer, usually
            asked at registration. Question Forms are unbuilt, so it is not asked.
          </li>
        </ul>
      </Panel>
    </>
  );
}
