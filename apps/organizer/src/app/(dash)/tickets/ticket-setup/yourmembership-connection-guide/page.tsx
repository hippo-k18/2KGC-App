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
          By CSV in both directions, with a{' '}
          <Link href="/tickets/ticket-setup/discount-codes">discount code</Link> standing in for the
          member rate. &#9888;&#65039; A code can be forwarded to a non-member; nothing checks
          membership.
        </>
      }
      effort="5–8 days."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>{' '}. The attendee, order or speaker CSV.
        </>,
        <>Import it into YourMembership with their own import tool. Every one of these products has one.</>,
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
