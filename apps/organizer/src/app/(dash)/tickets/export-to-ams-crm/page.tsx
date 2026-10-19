import Link from 'next/link';
import { IntegrationGuide } from '../../integration-guide';

export const dynamic = 'force-dynamic';

/** Export to AMS/CRM — a documentation screen, as it is in Whova. */
export default async function Page() {
  return (
    <IntegrationGuide
      title="Export to AMS/CRM"
      vendor="AMS/CRM"
      whatItIs="An association management system or CRM: the system that holds your member and contact records."
      whovaDoes="Offers a Zapier trigger so a new registration can fire an action in any of thousands of other products."
      ourAnswer={<>
          By CSV. Automatic export is not available yet. Export a file here and import it into
          your AMS or CRM.
        </>}
      effort="1–2 days for an outbound webhook, which subsumes most of this list."
      steps={[
        <>
          Export the list you need from{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>: the attendee, order or speaker CSV.
        </>,
        <>Import it into your AMS or CRM with its own import tool.</>,
        <>
          Repeat once before the event and once after it.
        </>,
      ]}
      links={[
        { label: 'Analytics & Exports', href: '/attendees/manage-attendees/analytics-and-exports' },
        { label: 'Attendees', href: '/attendees/manage-attendees/attendees' },
      ]}
    />
  );
}
