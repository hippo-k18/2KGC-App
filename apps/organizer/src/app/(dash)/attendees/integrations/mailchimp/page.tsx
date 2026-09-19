import Link from 'next/link';
import { ROUTES } from '@/lib/nav';
import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** Mailchimp — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="Mailchimp"
      vendor="Mailchimp"
      whatItIs="An email marketing platform."
      whovaDoes="Syncs attendees into a Mailchimp audience so the mailing list and the attendee list stay in step."
      ourAnswer={<>There is no automatic sync. Export a CSV here and import it into Mailchimp.</>}
      effort="One audience-sync call per import. The subtlety is consent, not code. An address that unsubscribed from the newsletter must not be re-added by a ticket export."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href={ROUTES.analyticsExports}>Analytics &amp; Exports</Link>
          as a CSV file.
        </>,
        <>In Mailchimp, import the file into your audience.</>,
        <>Repeat when the list changes, for example before and after the event.</>,
      ]}
      links={[
        { label: 'Analytics & Exports', href: '/attendees/manage-attendees/analytics-and-exports' },
        { label: 'Attendees', href: '/attendees/manage-attendees/attendees' },
      ]}
    />
  );
}
