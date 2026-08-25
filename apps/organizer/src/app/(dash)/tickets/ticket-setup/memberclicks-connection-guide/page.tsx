import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** MemberClicks connection guide — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="MemberClicks connection guide"
      vendor="MemberClicks"
      whatItIs="An association management system — the membership database, dues and member directory that professional societies run on."
      whovaDoes="Checks a buyer against your member list at checkout so members automatically get the member rate, and syncs registrations back into the AMS."
      ourAnswer={<>
          Nothing. Member pricing is a{' '}
          <a href="/tickets/ticket-setup/discount-codes">discount code</a> today — you issue one to
          your members and Stripe validates it at checkout. That is materially weaker: a code can be
          forwarded to somebody who is not a member, where a live membership check cannot. If KGC
          ever sells a genuine member rate at scale, that gap is the reason to build this.
        </>}
      effort="5–8 days, most of it their API and the field mapping."
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
