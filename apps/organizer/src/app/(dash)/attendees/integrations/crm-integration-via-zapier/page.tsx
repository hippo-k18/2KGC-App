import Link from 'next/link';
import { ROUTES } from '@/lib/nav';
import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** CRM Integration via Zapier — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="CRM Integration via Zapier"
      vendor="Zapier"
      whatItIs="A service that connects one product to another, such as registrations to a CRM."
      whovaDoes="Provides a Zapier trigger on new registrations, which an organizer wires to whatever CRM they use."
      ourAnswer={<>There is no Zapier connection yet. Export a CSV here and import it into your CRM.</>}
      effort="One outbound webhook on fulfilment, at the point the registration is written, and it subsumes most of the other nine guides."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href={ROUTES.analyticsExports}>Analytics &amp; Exports</Link> as a
          CSV file.
        </>,
        <>Import the file into your CRM with its contact import.</>,
        <>Repeat when the list changes, for example before and after the event.</>,
      ]}
      links={[
        { label: 'Analytics & Exports', href: '/attendees/manage-attendees/analytics-and-exports' },
        { label: 'Attendees', href: '/attendees/manage-attendees/attendees' },
      ]}
    />
  );
}
