import Link from 'next/link';
import { IntegrationGuide } from '../../integration-guide';

export const dynamic = 'force-dynamic';

/** Export to AMS/CRM — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="Export to AMS/CRM"
      vendor="Zapier"
      whatItIs="Middleware that connects products to each other without code. A trigger in one, an action in another."
      whovaDoes="Offers a Zapier trigger so a new registration can fire an action in any of thousands of other products."
      ourAnswer={<>
          By CSV. Zapier receives an inbound webhook and fans it out, so one outbound webhook fired
          at fulfilment would answer this guide and most of the others at once. Until that exists,
          the exports below carry the same data on the schedule a conference actually needs.
        </>}
      effort="1–2 days for an outbound webhook, which subsumes most of this list."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>{' '}. The attendee, order or speaker CSV.
        </>,
        <>Import it into Zapier with their own import tool. Every one of these products has one.</>,
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
