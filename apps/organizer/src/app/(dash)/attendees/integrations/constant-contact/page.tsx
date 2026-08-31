import Link from 'next/link';
import { ROUTES } from '@/lib/nav';
import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** Constant Contact — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="Constant Contact"
      vendor="Constant Contact"
      whatItIs="An email marketing platform in the same category as Mailchimp, and common among associations."
      whovaDoes="The same audience sync."
      ourAnswer={<>Nothing. Their importer takes the attendee CSV directly.</>}
      effort="2–4 days."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href={ROUTES.analyticsExports}>Analytics &amp; Exports</Link> —
          the attendee, order or speaker CSV.
        </>,
        <>Import it into Constant Contact with their own import tool. Every one of these products has one.</>,
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
