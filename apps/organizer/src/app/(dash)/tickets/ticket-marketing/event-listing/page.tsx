import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/** Tickets › Event Listing. */
export default async function Page() {
  return (
    <GapScreen
      title="Event Listing"
      lead={<>Not built, and sized honestly rather than promised. What it would actually take is below.</>}
      whova={<>Lists your event in public directories so strangers can find it.</>}
      needs={<>Nothing, and it is worth being clear this is close to worthless for KGC. Attendees arrive through the mailing list, speakers&rsquo; networks and sponsors — PAYMENTS.md makes the same point about why a marketplace platform is not the right shape for this conference.</>}
      size="Not planned."
      notBuilt={[
        <><strong>Whova Listing is separate</strong> and is genuinely not applicable — see Marketing › Whova Listing.</>,
        <><strong>Open Graph and structured data</strong> on the public site would do more than any directory.</>,
      ]}
    />
  );
}
