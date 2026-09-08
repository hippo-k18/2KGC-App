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
      ourAnswer={<>
          By CSV, in both directions. iMIS deployments are customised per organisation, so a
          connector is rarely a matter of dropping in an API key. It would have to be written
          against this society&rsquo;s particular instance.
        </>}
      effort="8–12 days, and highly dependent on the specific iMIS deployment."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>{' '}. The attendee, order or speaker CSV.
        </>,
        <>Import it into iMIS with their own import tool. Every one of these products has one.</>,
        <>
          Repeat once before the event and once after it. For a conference that happens annually
          that is fresh enough; nothing here goes stale between those two moments.
        </>,
      ]}
      links={[
        { label: 'Analytics & Exports', href: '/attendees/manage-attendees/analytics-and-exports' },
        { label: 'Attendees', href: '/attendees/manage-attendees/attendees' },
      ]}
    />
  );
}
