import { GapScreen } from '../../gap-screen';

export const dynamic = 'force-dynamic';

/** Engagement › Round Table. */
export default async function Page() {
  return (
    <GapScreen
      title="Round Table"
      lead={<>Not built, and honestly sized rather than promised. The note below is what it would actually take.</>}
      whova={<>Topic tables an attendee joins for a session, with a cap per table and a host assigned to each.</>}
      needs={<>A table model with membership and a cap. The community board&rsquo;s meet-up posts are the closest thing and are genuinely different — a post with replies, no joining and no limit.</>}
      size="4–6 days once a generic joinable-group model exists; the same model would serve Social Groups."
      notBuilt={[
        <><strong>Enforcing a cap.</strong> The same problem as session capacity, which the model claims is enforced in a transaction and is not — see <code>attendees/session-cap</code>.</>,
        <><strong>Assigning hosts.</strong> Needs a role the rules can read.</>,
      ]}
    />
  );
}
