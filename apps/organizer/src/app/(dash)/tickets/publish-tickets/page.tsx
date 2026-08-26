import { GapScreen } from '../../gap-screen';

export const dynamic = 'force-dynamic';

/** Tickets › Publish Tickets. */
export default async function Page() {
  return (
    <GapScreen
      title="Publish Tickets"
      lead={<>Not built, and sized honestly rather than promised. What it would actually take is below.</>}
      whova={<>Step 3 of Whova&rsquo;s ticket setup: the switch that makes your tickets buyable.</>}
      needs={<>Nothing to switch. A ticket type is on sale when it is visible and inside its window — both set on Create Tickets, both enforced by <code>catalogue.ts</code> at the moment of purchase. There is no separate published state and adding one would be a second thing to forget.</>}
      size="Not applicable. Publish (the top-level tab) is the pre-flight check that this button implies."
      notBuilt={[
        <><strong>The real check is on Publish</strong> — tickets on sale, payments configured, no programme clashes, pages complete.</>,
        <><strong>Visibility is per tier</strong>, which is finer than a global switch and is what an early-bird or comp rate needs.</>,
      ]}
    />
  );
}
