import Link from 'next/link';
import { requireAccess } from '@/lib/auth';
import { IntegrationGuide } from '../../integration-guide';
import { Panel } from '../../ui';

export const dynamic = 'force-dynamic';

/** Export to AMS/CRM — a documentation screen, as it is in Whova. */
export default async function Page() {
  // Tickets › HubSpot is owners only, so finance sees the name without a link that would bounce them.
  const { roles } = await requireAccess();
  const owner = roles.includes('owner');
  return (
    <IntegrationGuide
      title="Export to AMS/CRM"
      vendor="AMS/CRM"
      whatItIs="An association management system or CRM: the system that holds your member and contact records."
      whovaDoes="Offers a native HubSpot integration, and a Zapier trigger so a new registration can fire an action in any of thousands of other products."
      native={
        <Panel>
          <h2 className="section-header" style={{ marginTop: 0 }}>Native direct integration</h2>
          <p className="body-2">
            {owner ? (
              <Link href="/tickets/hubspot-connection-guide">
                <strong>HubSpot</strong>
              </Link>
            ) : (
              <strong>HubSpot</strong>
            )}
            : creates or updates a HubSpot contact for every registrant, with the fields you choose.
            {owner ? null : ' An owner sets it up.'}
          </p>
        </Panel>
      }
      ourAnswer={<>
          For HubSpot, use the native integration above. For any other system, export a file
          and import it into your AMS or CRM.
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
