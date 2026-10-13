import Link from 'next/link';
import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** Neon CRM connection guide — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="Neon CRM connection guide"
      vendor="Neon CRM"
      whatItIs="A nonprofit CRM: donors, members and events, with fundraising as the centre of gravity."
      whovaDoes="Pushes registrations into Neon as constituent records, so ticket buyers land in the same database as donors."
      ourAnswer={
        <>
          By CSV. The orders export has the buyer, the amount and the date.
        </>
      }
      effort="4–6 days. Neon's API is the friendliest of these four."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>: the attendee, order or speaker CSV.
        </>,
        <>Import it into Neon CRM with its import tool.</>,
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
