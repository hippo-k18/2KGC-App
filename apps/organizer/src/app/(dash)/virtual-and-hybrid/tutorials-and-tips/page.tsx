import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { EmptyState, GapPanel, PageHeader, Panel } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Tutorials and Tips.
 *
 * In Whova this is not a feature — it is their help centre embedded in the nav:
 * videos about running a hybrid event, produced by Whova, about Whova. It is
 * only a nav entry because they sell to organizers who have never run one.
 *
 * There is no content system behind this screen and none is planned. Guidance
 * for whoever works on this product lives in the repository — `AGENTS.md`,
 * `BUILD-PLAN.md`, `PAYMENTS.md`, `apps/organizer/README.md` — where it is
 * versioned with the code it describes and cannot drift into being a help
 * article about a screen that changed. Listing those filenames on an organizer
 * screen would be a page of prose pointing at a repository the reader does not
 * have, so they are named here instead.
 */
export default async function TutorialsAndTipsPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Tutorials and Tips"
        links={[
          <Link key="s" href="/virtual-and-hybrid/virtual-and-hybrid-setup">
            Virtual &amp; Hybrid Setup
          </Link>,
          <Link key="o" href="/virtual-and-hybrid/other-tools">
            Other Tools
          </Link>,
        ]}
      />

      <Panel>
        <EmptyState>
          <p className="empty-title">Not available yet</p>
          <p className="empty-sub">
            Tutorials and tips are not available yet.
          </p>
        </EmptyState>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No in-app help centre, and none planned.</strong> Documentation for whoever
            builds this product lives in the repository, not in a screen that would need its own
            editor.
          </li>
          <li>
            <strong>No tutorial videos.</strong> Producing them would need the video-hosting
            capability that{' '}
            <Link href="/content/documents-and-videos/video-hosting">Video Hosting</Link> records as
            absent.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
