import Link from 'next/link';
import { IntegrationGuide } from '../../integration-guide';

export const dynamic = 'force-dynamic';

/** MemberClicks export guide — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="MemberClicks export guide"
      vendor="MemberClicks"
      whatItIs="The same association management system as under Ticket Setup, listed twice: once for checkout verification and once for exporting registrations back out."
      whovaDoes="Exports the finished registration list into the AMS after the event, so member records show what they attended."
      ourAnswer={<>
          By CSV, and this is the easy direction:{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>{' '}
          already produces exactly the file MemberClicks&rsquo; importer wants.
        </>}
      effort="2–3 days for the export direction alone, far less than the checkout check."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>{' '}. The attendee, order or speaker CSV.
        </>,
        <>Import it into MemberClicks with their own import tool. Every one of these products has one.</>,
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
