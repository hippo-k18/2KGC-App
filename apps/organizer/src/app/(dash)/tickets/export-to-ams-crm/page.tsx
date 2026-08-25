import { IntegrationGuide } from '../../integration-guide';

export const dynamic = 'force-dynamic';

/** Export to AMS/CRM — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="Export to AMS/CRM"
      vendor="Zapier"
      whatItIs="Middleware that connects products to each other without code — a trigger in one, an action in another."
      whovaDoes="Offers a Zapier trigger so a new registration can fire an action in any of thousands of other products."
      ourAnswer={<>
          Nothing yet — and this is the one worth building first if any of them are. A single
          outbound webhook fired on fulfilment would answer this guide and most of the others at
          once, because Zapier receives a webhook and fans it out. Roughly a day, against five to
          twelve for any individual integration.
        </>}
      effort="1–2 days for an outbound webhook, which subsumes most of this list."
      steps={[
        <>
          Export the list you need from{' '}
          <a href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</a> —
          the attendee, order or speaker CSV.
        </>,
        <>Import it into Zapier with their own import tool. Every one of these products has one.</>,
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
