import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/** Tickets › Campaign Contact List. */
export default async function Page() {
  return (
    <GapScreen
      title="Campaign Contact List"
      lead={<>Not built, and sized honestly rather than promised. What it would actually take is below.</>}
      whova={<>The list a campaign goes to: past attendees, this year&rsquo;s registrants, and anyone who started a registration and stopped.</>}
      needs={<>The lists exist — Attendees › Segments derives them and Analytics &amp; Exports emits them as CSV. What is missing is the campaign tool to point them at, and consent tracking, which is the part that matters legally rather than technically.</>}
      size="2–3 days on top of a campaign tool, most of it consent."
      notBuilt={[
        <><strong>Consent is not modelled.</strong> Nothing records that somebody agreed to marketing email as distinct from a ticket receipt, and those are different permissions.</>,
        <><strong>Past attendees</strong> would need last year&rsquo;s event in the same database.</>,
      ]}
    />
  );
}
