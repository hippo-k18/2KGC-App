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
      ourAnswer={<>Nothing. Same answer: a discount code for the member rate, and a CSV in both directions.</>}
      effort="5–8 days."
      steps={[
        <>
          Export the list you need from{' '}
          <a href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</a> —
          the attendee, order or speaker CSV.
        </>,
        <>Import it into YourMembership with their own import tool. Every one of these products has one.</>,
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
