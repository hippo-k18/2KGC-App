import Link from 'next/link';
import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** YourMembership connection guide — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="YourMembership connection guide"
      vendor="YourMembership"
      whatItIs="An association management platform for small and mid-sized professional societies."
      whovaDoes="Member verification at checkout, and registrations synced back into the membership record."
      ourAnswer={
        <>
          By CSV, in both directions. For a member rate, give your members a{' '}
          <Link href="/tickets/ticket-setup/discount-codes">discount code</Link>. Membership is not
          checked at checkout, so a code can be passed on to a non-member.
        </>
      }
      effort="5–8 days."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>: the attendee, order or speaker CSV.
        </>,
        <>Import it into YourMembership with its import tool.</>,
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
