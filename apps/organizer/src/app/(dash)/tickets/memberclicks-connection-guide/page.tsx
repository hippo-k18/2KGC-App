import Link from 'next/link';
import { IntegrationGuide } from '../../integration-guide';

export const dynamic = 'force-dynamic';

/** MemberClicks export guide — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="MemberClicks connection guide"
      vendor="MemberClicks"
      whatItIs="An association management system. This guide covers exporting registrations into it. Member checks at checkout are under Ticket Setup."
      whovaDoes="Exports the finished registration list into the AMS after the event, so member records show what they attended."
      ourAnswer={<>
          By CSV.{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>{' '}
          produces a file MemberClicks can import.
        </>}
      effort="2–3 days for the export direction alone, far less than the checkout check."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>: the attendee, order or speaker CSV.
        </>,
        <>Import it into MemberClicks with its import tool.</>,
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
