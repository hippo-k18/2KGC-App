import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapPanel, PageHeader, Panel, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Other Tools.
 *
 * Whova's grab-bag: name pronunciation, virtual backgrounds, a countdown, a
 * lobby video, an interpreter channel. Individually small, and that is exactly
 * why the page is worth writing carefully — "it's only a countdown" is how a
 * cut cluster grows back one screen at a time.
 *
 * The useful move is to sort them by whether they depend on streaming at all,
 * because two of them do not and are therefore genuinely cheap.
 */
export default async function OtherToolsPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Other Tools"
        links={[
          <Link key="s" href="/virtual-and-hybrid/virtual-and-hybrid-setup">
            Virtual &amp; Hybrid Setup
          </Link>,
          <Link key="t" href="/virtual-and-hybrid/tutorials-and-tips">
            Tutorials and Tips
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Whova&rsquo;s list, sorted by what it depends on</h2>
        <Table
          cols={[
            { key: 't', label: 'Tool', className: 'cell-md' },
            { key: 'd', label: 'Depends on a stream', className: 'cell-sm' },
            { key: 'n', label: 'Note', className: 'cell-fill' },
          ]}
          rows={[
            [
              'Name pronunciation',
              <Tag key="d" color="green" small>
                No
              </Tag>,
              'A recorded clip or a phonetic spelling on a profile. Genuinely useful at an international conference, and it is a field plus an audio upload — which puts it behind the file-upload blocker, not this one.',
            ],
            [
              'Session countdown',
              <Tag key="d" color="green" small>
                No
              </Tag>,
              'The app already computes now/next from session times on the Home tab. A countdown is a presentation of data that exists.',
            ],
            [
              'Virtual backgrounds',
              <Tag key="d" color="orange" small>
                Yes
              </Tag>,
              'Branded images for speakers to load into their meeting client. Meaningless without a meeting client in the loop.',
            ],
            [
              'Lobby / holding video',
              <Tag key="d" color="orange" small>
                Yes
              </Tag>,
              'What remote attendees see before a session starts. There is no remote view to hold.',
            ],
            [
              'Live interpretation channels',
              <Tag key="d" color="orange" small>
                Yes
              </Tag>,
              'A second audio track per session. In person this is hardware and interpreters, not software.',
            ],
            [
              'Live captioning',
              <Tag key="d" color="orange" small>
                Yes
              </Tag>,
              'A paid third-party service billed per hour, per room. Worth costing separately as an accessibility commitment rather than as a virtual feature.',
            ],
          ]}
        />
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          The two marked <strong>No</strong> are the only ones that would survive cutting this
          cluster, and neither belongs on this screen — pronunciation is a speaker field, the
          countdown is an app concern.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>None of the six exist.</strong> No pronunciation field on{' '}
            <code>SpeakerDoc</code>, no countdown component, no asset library.
          </li>
          <li>
            <strong>The two cheap ones are blocked on something else.</strong> Pronunciation audio
            needs the file-upload pipeline the roadmap lists as blocker 3 — Storage rules exist and
            there is no upload UI anywhere in this project.
          </li>
          <li>
            <strong>Captioning is a budget line, not a screen.</strong> If accessibility captioning
            is wanted it should be decided for the in-person rooms, where it helps the audience
            actually attending —{' '}
            <Link href={ROUTES.sessionManager}>Session Manager</Link> is where those rooms are.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
