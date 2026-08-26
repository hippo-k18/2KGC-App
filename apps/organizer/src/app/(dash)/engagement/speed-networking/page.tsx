import { GapScreen } from '../../gap-screen';

export const dynamic = 'force-dynamic';

/** Engagement › Speed Networking. */
export default async function Page() {
  return (
    <GapScreen
      title="Speed Networking"
      lead={<>Not built, and honestly sized rather than promised. The note below is what it would actually take.</>}
      whova={<>Runs timed rounds during a session — pairs attendees, counts down, rotates. Whova does it in the app with a host control panel.</>}
      needs={<>Real-time coordination across a thousand devices. Firestore can do it, but the pairing algorithm, the shared clock and the host controls are all new, and none of the primitives exist.</>}
      size="10–15 days, and it is the most demo-dependent feature on the list: it is either flawless or a room full of confused people."
      notBuilt={[
        <><strong>A shared clock.</strong> Every device must agree on when a round ends, offline included. The badge QR docblock in AGENTS.md works through why that is harder than it sounds.</>,
        <><strong>A fallback when it fails.</strong> Speed networking that breaks mid-session strands a room.</>,
      ]}
    />
  );
}
