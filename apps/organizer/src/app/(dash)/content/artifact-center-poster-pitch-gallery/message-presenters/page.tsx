import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Artifact Center › Message Presenters.
 *
 * Blocked twice over, and the order matters. Message Exhibitors is one edit away
 * from working because exhibitors exist and carry an address; this one is not,
 * because **presenters do not exist**. There is no artifact collection, so there
 * is nobody to resolve an audience against — the audience union in
 * `src/lib/messaging.ts` is the second obstacle, not the first.
 */
export default async function MessagePresentersPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Message Presenters"
        links={[
          <Link key="a" href="/content/artifact-center-poster-pitch-gallery/artifact-manager">
            Artifact Manager
          </Link>,
          <Link key="s" href={ROUTES.messageSpeakers}>
            Message Speakers
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>No presenters are stored anywhere.</strong> This is not a missing send button — it
        is a missing collection. Artifact Manager explains the shape that would have to exist first.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Bulk email to poster and demo presenters, with the segments that actually get used:
          presenters who have not uploaded their file, and presenters who have not confirmed they
          are coming. Both are chase lists, which is what every messaging screen in this product
          really is.
        </p>

        <h2 className="section-header">The order it would have to be built in</h2>
        <ol className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            An <code>artifacts</code> collection with presenter records carrying an address —{' '}
            <strong>6–8 days</strong>, and Artifact Manager is where that is sized.
          </li>
          <li>
            A third value on <code>AudienceId</code> in <code>src/lib/messaging.ts</code> plus a
            resolver — <strong>about a day</strong>. The sender, the per-recipient{' '}
            <code>emailLog</code> and the compose screen already work and are used by two live
            screens.
          </li>
        </ol>
        <p className="body-2">
          Doing the second without the first produces a working screen that resolves to nobody,
          which is the shape of defect this codebase already has fourteen recorded instances of.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Presenters.</strong> No collection, no addresses.
          </li>
          <li>
            <strong>Sending.</strong> No compose box and no sent history for this audience.
          </li>
          <li>
            <strong>Upload-chasing segments,</strong> which need uploads to exist to be missing.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
