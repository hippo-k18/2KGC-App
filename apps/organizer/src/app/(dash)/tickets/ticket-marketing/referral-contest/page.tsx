import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/** Tickets › Referral Contest. */
export default async function Page() {
  return (
    <GapScreen
      title="Referral Contest"
      lead={<>Not built, and sized honestly rather than promised. What it would actually take is below.</>}
      whova={<>Attendees get a personal link, and whoever brings the most registrations wins something.</>}
      needs={<>Per-attendee referral codes, attribution through checkout, and a leaderboard. Stripe Checkout can carry a referral in metadata, so attribution is tractable; the rest is new.</>}
      size="5–7 days, and it depends on a campaign tool to distribute the links."
      notBuilt={[
        <><strong>Attribution through a redirect</strong> is the fiddly part — somebody who clicks a link, leaves, and buys a week later.</>,
        <><strong>Discount codes already exist</strong> and are a cruder version of the same idea that works today.</>,
      ]}
    />
  );
}
