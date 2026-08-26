import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/** Tickets › Email Campaign. */
export default async function Page() {
  return (
    <GapScreen
      title="Email Campaign"
      lead={<>Not built, and sized honestly rather than promised. What it would actually take is below.</>}
      whova={<>Bulk email to attendees and prospects, with templates, scheduling, segments and open tracking.</>}
      needs={<>This is deliberately unbuilt, and it is the one gap on this page that is a decision rather than a backlog item. A thousand recipients is a different problem from forty-five speakers: it needs batching, an unsubscribe register, bounce handling and a suppression list, and getting it wrong is how a conference gets its sending domain blocked.</>}
      size="6–9 days done properly, or an afternoon done badly."
      notBuilt={[
        <><strong>Message Speakers and Message Sponsors are built</strong> and send for real, because forty-five is safe.</>,
        <><strong>Mailchimp and Constant Contact already do this</strong> — see the integration guides. Exporting the attendee CSV into a product with a preference centre is the better answer for a once-a-year event.</>,
        <><strong>Tools › App Adoption</strong> gives you the copy to paste into whatever you already mail from.</>,
      ]}
    />
  );
}
