import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { PageHeader, Panel } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Tutorials and Tips.
 *
 * In Whova this is not a feature — it is their help centre embedded in the
 * nav: videos about running a hybrid event, produced by Whova, about Whova.
 * `ROADMAP.md` makes the same observation about the six connection guides, and
 * the conclusion is the same: reproducing it would mean writing documentation
 * for a product that does not exist yet.
 *
 * What can honestly go here is a pointer to the documentation this project
 * *does* have, which is unusually good and lives in the repo rather than in a
 * help centre.
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
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Hosts a library of short videos and articles on running a virtual or hybrid event, with
          the product&rsquo;s own screens in them. It is marketing and onboarding rather than a
          capability, and it is only a nav entry because Whova sells to organizers who have never
          run one.
        </p>

        <h2 className="section-header">Where this project&rsquo;s documentation actually is</h2>
        <ul className="body-2" style={{ lineHeight: 1.8, paddingLeft: 18 }}>
          <li>
            <code>AGENTS.md</code> — the stack, the data model, the security model, and a list of
            gotchas that have each already caused a real bug.
          </li>
          <li>
            <code>ROADMAP.md</code> — what is built, what is left, and the five missing capabilities
            that each block a cluster. It is where the argument for cutting these fifteen screens
            is made.
          </li>
          <li>
            <code>PAYMENTS.md</code> and <code>SETUP-PAYMENTS.md</code> — why Stripe rather than a
            ticketing platform, and the accounts and keys that turn it on.
          </li>
          <li>
            <code>apps/organizer/README.md</code> — this dashboard, including the rule that where
            the nav tree and the research notes disagree, the nav tree wins.
          </li>
        </ul>
        <p className="muted" style={{ fontSize: 13 }}>
          Every one of those is a file in the repository, so it is versioned with the code it
          describes and cannot drift into being a help article about a screen that changed.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No in-app help centre, and none planned.</strong> Documentation for organizers
            lives in the repository, not in a screen that would need its own editor.
          </li>
          <li>
            <strong>No tutorial videos.</strong> Producing them would need the video-hosting
            capability that{' '}
            <Link href="/content/documents-and-videos/video-hosting">Video Hosting</Link> records as
            absent — the same missing piece, pointed the other way.
          </li>
          <li>
            <strong>No contextual tips on other screens.</strong> Screens in this dashboard explain
            their own gaps in prose instead, which is the same idea without a content system behind
            it — see <Link href={ROUTES.report}>Report</Link> for the fullest example.
          </li>
        </ul>
      </Panel>
    </>
  );
}
