import Link from 'next/link';
import { IntegrationGuide } from '../../integration-guide';

export const dynamic = 'force-dynamic';

/** HubSpot connection guide — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="HubSpot connection guide"
      vendor="HubSpot"
      whatItIs="A CRM and marketing platform. For a conference it is usually where the sponsor and exhibitor pipeline lives."
      whovaDoes="Creates or updates a HubSpot contact for every registrant, and triggers their marketing sequences off it."
      ourAnswer={<>
          By CSV. The attendee export works with HubSpot&rsquo;s contact importer, which maps
          columns and removes duplicates.
        </>}
      effort="3–5 days. The API is well documented and the object model is simple."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>: the attendee, order or speaker CSV.
        </>,
        <>Import it into HubSpot with its contact import tool.</>,
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
