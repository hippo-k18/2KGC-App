import Link from 'next/link';
import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** iMIS connection guide — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="iMIS connection guide"
      vendor="iMIS"
      whatItIs="An association management system aimed at larger societies. Membership, events, finance and fundraising in one product."
      whovaDoes="The same member-rate check and registration sync as MemberClicks, against an iMIS instance."
      ourAnswer={
        <>
          By CSV, in both directions. A direct connection is not available yet.
        </>
      }
      effort="8–12 days, and highly dependent on the specific iMIS deployment."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>: the attendee, order or speaker CSV.
        </>,
        <>Import it into iMIS with its import tool.</>,
        <>
          Repeat once before the event and once after it.
        </>,
      ]}
      links={[
        { label: 'Analytics & Exports', href: '/attendees/manage-attendees/analytics-and-exports' },
        { label: 'Attendees', href: '/attendees/manage-attendees/attendees' },
      ]}
    />
  );
}
