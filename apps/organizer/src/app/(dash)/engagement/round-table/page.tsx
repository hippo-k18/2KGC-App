import Link from 'next/link';
import { GatheringScreen } from '../gathering-screen';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Round Table.
 *
 * Whova's round tables are joinable from the app, with a cap and a host. Ours
 * are the organizer's plan for the same thing: the topics, who runs each one,
 * where they sit and who has been placed there. That is what gets printed on
 * the table cards and handed to the front desk, and it is useful without an app
 * — which is fortunate, because the app has no surface for joining one.
 */
export default async function RoundTablePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  return (
    <GatheringScreen
      kind="round-table"
      title="Round Table"
      searchParams={searchParams}
      links={[
        <Link key="s" href="/engagement/speed-networking">
          Speed Networking
        </Link>,
      ]}
      info={
        <>
          <strong>Table plan</strong>
          <p>Topics, hosts, rooms and who sits where, for the front desk and the table cards.</p>
          <p>
            Attendees do not see this in the app yet, so tell people where they are seated. For
            sign-ups attendees run themselves, use Meet-ups.
          </p>
        </>
      }
      formCopy={{
        noun: 'Tables',
        titleLabel: 'Topic',
        titlePlaceholder: 'Ontology governance in regulated industries',
        hostLabel: 'Host',
        capacityHint: 'Seats at the table.',
        defaultCapacity: 8,
      }}
      notBuilt={[
        <li key="rotate">
          <strong>No rotation.</strong> Whova can move people between tables between rounds. That is
          the same computation{' '}
          <Link href="/engagement/speed-networking">Speed Networking</Link> does, and pointing the
          two at one model is the obvious next piece.
        </li>,
        <li key="print">
          <strong>No printable table cards.</strong> The data is here; a print stylesheet or a PDF
          is not. Today this is a screen somebody prints from the browser.
        </li>,
      ]}
    />
  );
}
