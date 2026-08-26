import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/** Engagement › Photo Collection. */
export default async function Page() {
  return (
    <GapScreen
      title="Photo Collection"
      lead={<>Not built, and honestly sized rather than promised. The note below is what it would actually take.</>}
      whova={<>A shared album attendees post to from the app, moderated by organizers.</>}
      needs={<>Storage uploads and a moderation queue. Neither exists — <code>tools/moderator-tools/photos</code> is the other half of the same gap.</>}
      size="6–9 days including moderation, and it needs the image pipeline first."
      notBuilt={[
        <><strong>Nothing in the app takes a photo.</strong> Expo Go ships a fixed set of native modules and the camera is not wired.</>,
        <><strong>Moderation before display, not after.</strong> A thousand attendees and an unmoderated public album is a decision, not a feature.</>,
      ]}
    />
  );
}
