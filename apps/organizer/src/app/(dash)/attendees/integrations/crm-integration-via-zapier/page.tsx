import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** CRM Integration via Zapier — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="CRM Integration via Zapier"
      vendor="Zapier"
      whatItIs="Middleware that lets one product trigger an action in another with no code on either side."
      whovaDoes="Provides a Zapier trigger on new registrations, which an organizer wires to whatever CRM they use."
      ourAnswer={<>
          Nothing yet — but this is the highest-leverage integration on the list. One outbound
          webhook on fulfilment answers this guide and most of the others at once, and the
          fulfilment path already has the exact hook point: the Stripe webhook, where the
          registration is written.
        </>}
      effort="1–2 days, and it subsumes most of the other nine guides."
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
