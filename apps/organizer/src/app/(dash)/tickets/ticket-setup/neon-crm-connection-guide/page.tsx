import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** Neon CRM connection guide — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="Neon CRM connection guide"
      vendor="Neon CRM"
      whatItIs="A nonprofit CRM — donors, members and events, with fundraising as the centre of gravity."
      whovaDoes="Pushes registrations into Neon as constituent records, so ticket buyers land in the same database as donors."
      ourAnswer={<>
          Nothing. The orders CSV carries the buyer, the amount and the date, which is what a
          constituent record needs.
        </>}
      effort="4–6 days. Neon's API is the friendliest of these four."
      steps={[
        <>
          Export the list you need from{' '}
          <a href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</a> —
          the attendee, order or speaker CSV.
        </>,
        <>Import it into Neon CRM with their own import tool. Every one of these products has one.</>,
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
