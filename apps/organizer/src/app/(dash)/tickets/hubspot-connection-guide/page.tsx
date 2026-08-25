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
          Nothing. The attendee CSV imports cleanly into HubSpot&rsquo;s own contact importer, which
          maps columns interactively and deduplicates better than a one-way push would.
        </>}
      effort="3–5 days. The API is well documented and the object model is simple."
      steps={[
        <>
          Export the list you need from{' '}
          <a href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</a> —
          the attendee, order or speaker CSV.
        </>,
        <>Import it into HubSpot with their own import tool. Every one of these products has one.</>,
        <>
          Repeat before the event and after it. Twice is usually enough — Whova&rsquo;s sync runs
          every 24 hours, which is not meaningfully fresher for an event that happens once a year.
        </>,
      ]}
      links={[
        { label: 'Analytics & Exports', href: '/attendees/manage-attendees/analytics-and-exports' },
        { label: 'Attendees', href: '/attendees/manage-attendees/attendees' },
      ]}
    />
  );
}
