import Link from 'next/link';
import { ROUTES } from '@/lib/nav';
import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** Constant Contact — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="Constant Contact"
      vendor="Constant Contact"
      whatItIs="An email marketing platform."
      whovaDoes="The same audience sync."
      ourAnswer={<>There is no automatic sync. Export a CSV here and import it into Constant Contact.</>}
      effort="The same audience sync as Mailchimp, against a second API. Nothing here is novel once one of them exists."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href={ROUTES.analyticsExports}>Analytics &amp; Exports</Link> as a
          CSV file.
        </>,
        <>In Constant Contact, import the file into your contact list.</>,
        <>Repeat when the list changes, for example before and after the event.</>,
      ]}
      links={[
        { label: 'Analytics & Exports', href: '/attendees/manage-attendees/analytics-and-exports' },
        { label: 'Attendees', href: '/attendees/manage-attendees/attendees' },
      ]}
    />
  );
}
