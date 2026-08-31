import Link from 'next/link';
import { ROUTES } from '@/lib/nav';
import { IntegrationGuide } from '../../../integration-guide';

export const dynamic = 'force-dynamic';

/** Mailchimp — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="Mailchimp"
      vendor="Mailchimp"
      whatItIs="An email marketing platform. Most conferences already run their announcement list on one."
      whovaDoes="Syncs attendees into a Mailchimp audience so the mailing list and the attendee list stay in step."
      ourAnswer={<>
          Nothing — and note that KGC&rsquo;s transactional email runs on Resend, which is a
          different job. Resend sends receipts and organizer messages; Mailchimp sends campaigns
          with unsubscribe handling and a preference centre, which is exactly what{' '}
          <code>tickets/ticket-marketing/email-campaign</code> is unbuilt for want of.
        </>}
      effort="2–4 days. The audience API is straightforward; the subtlety is consent, not code."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href={ROUTES.analyticsExports}>Analytics &amp; Exports</Link> —
          the attendee, order or speaker CSV.
        </>,
        <>Import it into Mailchimp with their own import tool. Every one of these products has one.</>,
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
