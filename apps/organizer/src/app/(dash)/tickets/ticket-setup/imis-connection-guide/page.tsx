import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** iMIS connection guide — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="iMIS connection guide"
      vendor="iMIS"
      whatItIs="An association management system aimed at larger societies — membership, events, finance and fundraising in one product."
      whovaDoes="The same member-rate check and registration sync as MemberClicks, against an iMIS instance."
      ourAnswer={<>
          Nothing, and the same workaround. iMIS deployments are usually customised per
          organisation, so an integration is rarely a matter of dropping in an API key — which makes
          it the least worthwhile of these to build speculatively.
        </>}
      effort="8–12 days, and highly dependent on the specific iMIS deployment."
      steps={[
        <>
          Export the list you need from{' '}
          <a href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</a> —
          the attendee, order or speaker CSV.
        </>,
        <>Import it into iMIS with their own import tool. Every one of these products has one.</>,
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
