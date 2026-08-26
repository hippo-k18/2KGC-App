import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/** Engagement › Profile Photo Frames. */
export default async function Page() {
  return (
    <GapScreen
      title="Profile Photo Frames"
      lead={<>Not built, and honestly sized rather than promised. The note below is what it would actually take.</>}
      whova={<>Overlays a branded frame on an attendee&rsquo;s profile picture, so the directory looks like one event.</>}
      needs={<>Image compositing, and profile photos. Neither exists: <code>UserDoc.photoURL</code> is a field nothing writes, because nothing uploads.</>}
      size="2–3 days once uploads exist. Almost worthless before then."
      notBuilt={[
        <><strong>No attendee has a photo.</strong> The directory renders initials.</>,
      ]}
    />
  );
}
