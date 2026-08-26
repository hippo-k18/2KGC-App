import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/** Tickets › Campaign Link Tracking. */
export default async function Page() {
  return (
    <GapScreen
      title="Campaign Link Tracking"
      lead={<>Not built, and sized honestly rather than promised. What it would actually take is below.</>}
      whova={<>Wraps links in a campaign so you can see who clicked what.</>}
      needs={<>A redirector, a click log, and a decision about tracking people. The first two are a day; the third is the reason this is not built.</>}
      size="1–2 days technically. The decision is the work."
      notBuilt={[
        <><strong>Adding a tracker is a privacy decision</strong>, not a missing feature — the same note is on the agenda webpage analytics screen.</>,
        <><strong>Adoption is already measured</strong> from who has a profile, which is the outcome rather than a proxy for it.</>,
      ]}
    />
  );
}
