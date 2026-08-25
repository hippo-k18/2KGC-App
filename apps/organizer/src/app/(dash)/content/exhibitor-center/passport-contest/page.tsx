import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { exhibitorSummary } from '@/lib/exhibitors';
import { PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Exhibitor Center › Passport Contest.
 *
 * An honest gap note rather than a stub. The point of these screens is that an
 * organizer evaluating the move can click any nav item and get a straight
 * answer — what Whova does, what we would need, roughly how big — instead of a
 * spinner or an empty table that implies "this half-works".
 */
export default async function PassportContestPage() {
  await requireOrganizer();
  const s = await exhibitorSummary();

  return (
    <>
      <PageHeader
        title="Passport Contest"
        links={[
          <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Exhibitors', value: s.confirmed, sub: 'confirmed, would be stops' },
          { label: 'Booths assigned', value: s.confirmed - s.withoutBooth, sub: `${s.withoutBooth} without` },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Attendees collect a stamp at each booth — scanned from the exhibitor&rsquo;s device or the
          attendee&rsquo;s — and a full passport enters a prize draw. It exists to push footfall
          into the quiet corners of the hall, which is what exhibitors on those stands are paying
          for and complaining about.
        </p>

        <h2 className="section-header">What this would need</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>A scan path per booth.</strong> The check-in scanner reads one thing —{' '}
            <code>qrSecret</code> — and writes an event-door check-in. A booth stamp is a different
            scan by a different person in the other direction, and neither the app nor the desk has
            it.
          </li>
          <li>
            <strong>A stamps subcollection</strong> under each attendee, plus a rule letting a
            booth write one without letting an attendee stamp their own passport — which is the
            whole security question and is not trivial.
          </li>
          <li>
            <strong>A prize draw</strong> somebody has to run, and terms somebody has to write.
          </li>
        </ul>

        <p className="body-2">
          Roughly a week, and it depends on lead scanning existing first — the same scan, pointed
          at a different collection. <code>ROADMAP.md</code> puts both in the long tail: real
          features, low value for a research conference whose exhibitors are mostly recruiters and
          university groups rather than a trade-show floor.
        </p>
      </Panel>
    </>
  );
}
