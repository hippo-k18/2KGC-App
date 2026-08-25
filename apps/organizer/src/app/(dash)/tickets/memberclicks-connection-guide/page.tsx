import { IntegrationGuide } from '../../integration-guide';

export const dynamic = 'force-dynamic';

/** MemberClicks export guide — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="MemberClicks export guide"
      vendor="MemberClicks"
      whatItIs="The same association management system as under Ticket Setup — Whova lists it twice, once for checkout verification and once for exporting registrations back out."
      whovaDoes="Exports the finished registration list into the AMS after the event, so member records show what they attended."
      ourAnswer={<>
          Nothing — and the export half is the easier one: Analytics &amp; Exports already produces
          exactly this file.
        </>}
      effort="2–3 days for the export direction alone, far less than the checkout check."
      steps={[
        <>
          Export the list you need from{' '}
          <a href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</a> —
          the attendee, order or speaker CSV.
        </>,
        <>Import it into MemberClicks with their own import tool. Every one of these products has one.</>,
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
