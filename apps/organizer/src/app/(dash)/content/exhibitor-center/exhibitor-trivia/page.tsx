import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/** Content › Exhibitor Center › Exhibitor Trivia. */
export default async function ExhibitorTriviaPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Exhibitor Trivia"
        links={[
          <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
          <Link key="p" href="/content/exhibitor-center/passport-contest">
            Passport Contest
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Each exhibitor sets a question about their product. An attendee has to visit the booth to
          answer it, and correct answers feed a leaderboard. It is the passport contest with a
          reason to talk to somebody rather than just scan and walk away — which is what the
          exhibitor actually wants.
        </p>

        <h2 className="section-header">What this would need</h2>
        <p className="body-2">
          Everything the passport contest needs, plus a question bank each exhibitor authors
          themselves — which means an exhibitor-facing login. There is none: exhibitors have a
          contact email and no account, and building one is a second auth surface with its own
          rules, its own recovery flow and its own attack surface.
        </p>
        <p className="body-2">
          That makes this one of the more expensive items on the unbuilt list and among the least
          valuable for KGC&rsquo;s format. <code>ROADMAP.md</code> lists it with the trade-show
          mechanics as a candidate to cut rather than build.
        </p>
      </Panel>
    </>
  );
}
