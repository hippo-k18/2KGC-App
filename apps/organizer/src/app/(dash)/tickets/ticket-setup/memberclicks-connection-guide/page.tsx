import Link from 'next/link';
import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** MemberClicks connection guide — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="MemberClicks connection guide"
      vendor="MemberClicks"
      whatItIs="An association management system. The membership database, dues and member directory that professional societies run on."
      whovaDoes="Checks a buyer against your member list at checkout so members automatically get the member rate, and syncs registrations back into the AMS."
      ourAnswer={
        <>
          By CSV. For a member rate, give your members a{' '}
          <Link href="/tickets/ticket-setup/discount-codes">discount code</Link>. Membership is not
          checked at checkout, so a code can be passed on to a non-member.
        </>
      }
      effort="5–8 days, most of it their API and the field mapping."
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
