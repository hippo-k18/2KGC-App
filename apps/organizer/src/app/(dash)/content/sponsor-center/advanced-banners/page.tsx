import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/** Content › Sponsor Center › Advanced Banners. */
export default async function Page() {
  return (
    <GapScreen
      title="Advanced Banners"
      lead={<>Sponsor banners have nowhere to render. The app has no banner slots on any screen, so a banner uploaded here would be a file nobody sees.</>}
      whova={<>Lets a sponsor&rsquo;s artwork appear on the app home screen, the agenda, an attendee&rsquo;s profile and the web app, with placement and rotation set per tier — which is a large part of what a platinum package is actually selling.</>}
      needs={<>Two things, and the second is the real one. Storage uploads with server-side resizing, which no screen in this dashboard has. And <strong>rendering slots in the Expo app</strong> — there is no component anywhere that draws a sponsor banner, so there is nothing for a placement setting to place.</>}
      size="4–6 days, most of it the app rather than this console."
      notBuilt={[
        <><strong>Upload.</strong> The same blocker as the Branding Center and document attachments — roughly eighteen screens wait on an image pipeline.</>,
        <><strong>Placement and rotation.</strong> Meaningless until slots exist.</>,
        <><strong>Impression counting.</strong> Sponsors ask for it and it needs a write per view, which at a thousand attendees is a Firestore cost worth thinking about before promising.</>,
      ]}
    />
  );
}
