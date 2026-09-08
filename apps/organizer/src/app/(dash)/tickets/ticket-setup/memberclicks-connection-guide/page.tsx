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
      ourAnswer={<>
          By CSV, and member pricing is a{' '}
          <Link href="/tickets/ticket-setup/discount-codes">discount code</Link>: you issue one to
          your members and Stripe validates it at checkout. &#9888;&#65039; A code can be forwarded
          to somebody who is not a member, where a live membership check could not, so a member
          rate sold this way is enforced by trust rather than by the system.
        </>}
      effort="5–8 days, most of it their API and the field mapping."
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
